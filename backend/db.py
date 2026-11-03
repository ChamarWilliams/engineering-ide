import contextvars
import os
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path

DATABASE_URL = os.environ.get("DATABASE_URL", "")
IS_PG = DATABASE_URL.startswith(("postgres://", "postgresql://"))
# Owner of the request being served; empty for the single-user local setup.
current_owner = contextvars.ContextVar("current_owner", default="")
SQLITE_PATH = Path(__file__).resolve().parent.parent / "data" / "sessions.db"

SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(36) PRIMARY KEY,
        title VARCHAR(100) DEFAULT 'Untitled',
        language VARCHAR(20) NOT NULL,
        code TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS revisions (
        session_id VARCHAR(36) NOT NULL,
        n INTEGER NOT NULL,
        title VARCHAR(100),
        language VARCHAR(20),
        code TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (session_id, n)
    )
    """,
    "CREATE TABLE IF NOT EXISTS folders (path VARCHAR(250) PRIMARY KEY)",
    "CREATE TABLE IF NOT EXISTS owned_folders (owner VARCHAR(64) NOT NULL, path VARCHAR(250) NOT NULL, PRIMARY KEY (owner, path))",
    """
    CREATE TABLE IF NOT EXISTS agents (
        id VARCHAR(16) PRIMARY KEY,
        name VARCHAR(60) NOT NULL,
        owner VARCHAR(64) NOT NULL,
        token_hash VARCHAR(64) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
)

KEEP_REVISIONS = 200


def _connect():
    if IS_PG:
        import psycopg

        return psycopg.connect(DATABASE_URL, autocommit=True)
    SQLITE_PATH.parent.mkdir(exist_ok=True)
    return sqlite3.connect(SQLITE_PATH)


def _timestamp(value):
    if isinstance(value, datetime):
        return value.isoformat() + ("Z" if value.tzinfo is None else "")
    if isinstance(value, str):
        return value.replace(" ", "T") + "Z"
    return value


def _execute(sql, params=()):
    if IS_PG:
        sql = sql.replace("?", "%s")
    with closing(_connect()) as conn:
        cur = conn.execute(sql, params)
        cols = [c[0] for c in cur.description] if cur.description else []
        rows = cur.fetchall() if cols else []
        conn.commit()
    result = []
    for row in rows:
        item = dict(zip(cols, row))
        for key in ("created_at", "updated_at"):
            if key in item:
                item[key] = _timestamp(item[key])
        result.append(item)
    return result


def init():
    for statement in SCHEMA:
        _execute(statement)
    if IS_PG:
        _execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS layout TEXT")
        _execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS folder VARCHAR(250) DEFAULT ''")
        _execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS owner VARCHAR(64) DEFAULT ''")
    else:
        have = {c["name"] for c in _execute("PRAGMA table_info(sessions)")}
        if "layout" not in have:
            _execute("ALTER TABLE sessions ADD COLUMN layout TEXT")
        if "folder" not in have:
            _execute("ALTER TABLE sessions ADD COLUMN folder VARCHAR(250) DEFAULT ''")
        if "owner" not in have:
            _execute("ALTER TABLE sessions ADD COLUMN owner VARCHAR(64) DEFAULT ''")
    if _execute("SELECT 1 AS x FROM folders LIMIT 1"):
        _execute("INSERT INTO owned_folders (owner, path) SELECT '', path FROM folders WHERE 1 = 1 ON CONFLICT DO NOTHING")
        _execute("DELETE FROM folders")
    _execute("CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner)")


def _me():
    return current_owner.get()


def _owns(session_id):
    return bool(_execute("SELECT 1 AS x FROM sessions WHERE id = ? AND owner = ?", (session_id, _me())))


def list_sessions(limit):
    return _execute(
        "SELECT id, title, language, COALESCE(folder, '') AS folder, LENGTH(code) AS size, created_at, updated_at "
        "FROM sessions WHERE owner = ? ORDER BY updated_at DESC LIMIT ?",
        (_me(), limit),
    )


def get_session(session_id):
    rows = _execute(
        "SELECT id, title, language, code, layout, COALESCE(folder, '') AS folder, created_at, updated_at "
        "FROM sessions WHERE id = ? AND owner = ?",
        (session_id, _me()),
    )
    return rows[0] if rows else None


def upsert_session(session_id, title, language, code, layout=None, folder=None):
    taken = _execute("SELECT owner FROM sessions WHERE id = ?", (session_id,))
    if taken and taken[0]["owner"] != _me():
        raise LookupError("No such file")
    row = _execute(
        "INSERT INTO sessions (id, title, language, code, layout, folder, owner) VALUES (?, ?, ?, ?, ?, COALESCE(CAST(? AS TEXT), ''), ?) "
        "ON CONFLICT (id) DO UPDATE SET title = excluded.title, language = excluded.language, "
        "code = excluded.code, layout = COALESCE(excluded.layout, sessions.layout), "
        "folder = CASE WHEN CAST(? AS TEXT) IS NULL THEN sessions.folder ELSE excluded.folder END, "
        "updated_at = CURRENT_TIMESTAMP "
        "RETURNING id, title, language, created_at, updated_at",
        (session_id, title, language, code, layout, folder, _me(), folder),
    )[0]
    add_revision(session_id, title, language, code)
    return row


def delete_session(session_id):
    if not _owns(session_id):
        return
    _execute("DELETE FROM revisions WHERE session_id = ?", (session_id,))
    _execute("DELETE FROM sessions WHERE id = ? AND owner = ?", (session_id, _me()))


def add_revision(session_id, title, language, code):
    latest = _execute("SELECT n, code FROM revisions WHERE session_id = ? ORDER BY n DESC LIMIT 1", (session_id,))
    if latest and latest[0]["code"] == code:
        return
    n = (latest[0]["n"] if latest else 0) + 1
    _execute(
        "INSERT INTO revisions (session_id, n, title, language, code) VALUES (?, ?, ?, ?, ?)",
        (session_id, n, title, language, code),
    )
    _execute("DELETE FROM revisions WHERE session_id = ? AND n <= ?", (session_id, n - KEEP_REVISIONS))


def all_revisions(session_id):
    if not _owns(session_id):
        return []
    return _execute(
        "SELECT n, title, language, code, created_at FROM revisions WHERE session_id = ? ORDER BY n ASC",
        (session_id,),
    )


def get_revision(session_id, n):
    if not _owns(session_id):
        return None
    rows = _execute(
        "SELECT n, title, language, code, created_at FROM revisions WHERE session_id = ? AND n = ?",
        (session_id, n),
    )
    return rows[0] if rows else None


def add_agent(agent_id, name, owner, token_hash):
    _execute("INSERT INTO agents (id, name, owner, token_hash) VALUES (?, ?, ?, ?)", (agent_id, name, owner, token_hash))


def get_agent(agent_id):
    rows = _execute("SELECT id, name, owner, token_hash, created_at FROM agents WHERE id = ?", (agent_id,))
    return rows[0] if rows else None


def list_agents(owner):
    return _execute("SELECT id, name, created_at FROM agents WHERE owner = ? ORDER BY created_at", (owner,))


def rename_agent(agent_id, name):
    _execute("UPDATE agents SET name = ? WHERE id = ?", (name, agent_id))


def delete_agent(agent_id):
    _execute("DELETE FROM agents WHERE id = ?", (agent_id,))


def list_folders():
    return [r["path"] for r in _execute("SELECT path FROM owned_folders WHERE owner = ? ORDER BY path", (_me(),))]


def add_folder(path):
    _execute("INSERT INTO owned_folders (owner, path) VALUES (?, ?) ON CONFLICT (owner, path) DO NOTHING", (_me(), path))


def folder_in_use(path):
    like = path + "/%"
    files = _execute("SELECT 1 AS x FROM sessions WHERE owner = ? AND (folder = ? OR folder LIKE ?) LIMIT 1", (_me(), path, like))
    subs = _execute("SELECT 1 AS x FROM owned_folders WHERE owner = ? AND path LIKE ? LIMIT 1", (_me(), like))
    return bool(files or subs)


def delete_folder(path):
    _execute("DELETE FROM owned_folders WHERE owner = ? AND path = ?", (_me(), path))


def set_folder(session_id, folder):
    _execute("UPDATE sessions SET folder = ? WHERE id = ? AND owner = ?", (folder, session_id, _me()))


def set_title(session_id, title):
    _execute("UPDATE sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner = ?", (title, session_id, _me()))


def rename_folder(src, dst):
    like, cut = src + "/%", len(src) + 1
    _execute(
        "UPDATE sessions SET folder = ? || substr(folder, ?) WHERE owner = ? AND (folder = ? OR folder LIKE ?)",
        (dst, cut, _me(), src, like),
    )
    _execute(
        "UPDATE owned_folders SET path = ? || substr(path, ?) WHERE owner = ? AND (path = ? OR path LIKE ?)",
        (dst, cut, _me(), src, like),
    )


def delete_folder_tree(path):
    like = path + "/%"
    ids = [r["id"] for r in _execute("SELECT id FROM sessions WHERE owner = ? AND (folder = ? OR folder LIKE ?)", (_me(), path, like))]
    for session_id in ids:
        delete_session(session_id)
    _execute("DELETE FROM owned_folders WHERE owner = ? AND (path = ? OR path LIKE ?)", (_me(), path, like))
    return len(ids)


def all_codes(limit=200):
    return _execute(
        "SELECT id, title, language, COALESCE(folder, '') AS folder, code FROM sessions WHERE owner = ? ORDER BY updated_at DESC LIMIT ?",
        (_me(), limit),
    )
