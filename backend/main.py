import asyncio
import base64
import hmac
import io
import json
import logging
import os
import time
from collections import defaultdict, deque
import re
import secrets
import string
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Header, HTTPException, Request, Response, WebSocket
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import agents, db, graph, history, links, refactor, runner, templates, terminal, tools

Language = Literal[
    "c", "cpp", "lua", "python", "javascript", "typescript", "html", "css", "json", "yaml", "sql",
    "markdown", "shell", "java", "go", "rust", "text", "http", "xml", "properties", "toml",
]
RUNNABLE = {"c", "cpp", "lua", "python", "javascript", "typescript", "shell", "go", "rust", "java"}
ID_RE = re.compile(r"^[A-Za-z0-9-]{1,36}$")
ID_ALPHABET = string.ascii_lowercase + string.digits
ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"
AGENT_FILES = (
    ("agent.py", ROOT / "agent" / "agent.py"),
    ("runner.py", ROOT / "backend" / "runner.py"),
    ("Dockerfile.python", ROOT / "agent" / "Dockerfile.python"),
    ("Dockerfile.native", ROOT / "agent" / "Dockerfile.native"),
    ("requirements-libs.txt", ROOT / "requirements-libs.txt"),
)
MAX_CODE = 200_000
log = logging.getLogger("uvicorn.error")
MAX_LAYOUT = 100_000
FOLDER_PART = re.compile(r"^[A-Za-z0-9 _.-]{1,40}$")

run_slots = asyncio.Semaphore(4)


@asynccontextmanager
async def lifespan(_app):
    db.init()
    yield


app = FastAPI(title="Loopline", lifespan=lifespan)

RUN_PATHS = ("/api/run", "/api/trace")
MULTIUSER = os.environ.get("EIDE_MULTIUSER", "") == "1"
VISITOR_RE = re.compile(r"^[a-f0-9]{24}$")
RUNS_PER_MIN = int(os.environ.get("EIDE_RUNS_PER_MIN", "30"))
_run_hits = defaultdict(deque)


@app.middleware("http")
async def guard(request: Request, call_next):
    password = os.environ.get("EIDE_PASSWORD", "")
    if password and request.url.path != "/healthz":
        sent = request.headers.get("authorization", "")
        ok = False
        if sent.startswith("Basic "):
            try:
                given = base64.b64decode(sent[6:]).decode().partition(":")[2]
                ok = hmac.compare_digest(given, password)
            except ValueError:
                ok = False
        if not ok:
            return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="Loopline"'})
    if request.method == "POST" and request.url.path in RUN_PATHS:
        who = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
        now = time.monotonic()
        hits = _run_hits[who]
        while hits and now - hits[0] > 60:
            hits.popleft()
        if len(hits) >= RUNS_PER_MIN:
            return JSONResponse({"detail": "Too many runs in a minute. Wait a few seconds and run again."}, status_code=429)
        hits.append(now)
    if not MULTIUSER:
        return await call_next(request)
    linked = request.query_params.get("ws", "")
    if request.method == "GET" and request.url.path == "/" and VISITOR_RE.match(linked):
        response = RedirectResponse("/", status_code=303)
        _remember_visitor(request, response, linked)
        return response
    visitor = request.cookies.get("eide_vid", "")
    fresh = not VISITOR_RE.match(visitor)
    if fresh:
        visitor = secrets.token_hex(12)
    token = db.current_owner.set(visitor)
    try:
        response = await call_next(request)
    finally:
        db.current_owner.reset(token)
    if fresh:
        _remember_visitor(request, response, visitor)
    return response


def _remember_visitor(request, response, visitor):
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie("eide_vid", visitor, max_age=60 * 60 * 24 * 365, httponly=True, samesite="lax", secure=secure)


@app.exception_handler(LookupError)
async def not_found(_request: Request, exc: LookupError):
    return JSONResponse({"detail": str(exc) or "Not found"}, status_code=404)


@app.exception_handler(RequestValidationError)
async def bad_input(_request: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", ()) if p != "body")
    return JSONResponse({"detail": f"That input wasn't accepted ({where or 'request'}: {first.get('msg', 'invalid')}). Nothing was changed."}, status_code=422)


@app.exception_handler(Exception)
async def server_error(request: Request, exc: Exception):
    log.error("unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
    detail = f"{type(exc).__name__}: {exc}" if os.environ.get("EIDE_DEBUG") == "1" else "Internal Server Error"
    return JSONResponse({"detail": detail}, status_code=500)


@app.get("/healthz")
def healthz():
    return {"ok": True, "storage": "postgres" if db.IS_PG else "sqlite", "private_workspaces": MULTIUSER}



@app.middleware("http")
async def revalidate_static(request, call_next):
    response = await call_next(request)
    if not request.url.path.startswith(("/api/", "/ws/")):
        response.headers["Cache-Control"] = "no-cache"
    return response


class SessionIn(BaseModel):
    id: str | None = None
    title: str = Field("Untitled", max_length=100)
    language: Language
    code: str = Field(max_length=MAX_CODE)
    layout: dict | None = None
    folder: str | None = None


class FolderIn(BaseModel):
    path: str = Field(max_length=250)


def _folder(raw, depth=6):
    parts = [p.strip() for p in (raw or "").replace("\\", "/").split("/") if p.strip()]
    if len(parts) > depth or any(not FOLDER_PART.match(p) or p in (".", "..") for p in parts):
        raise HTTPException(422, "Folder names may use letters, numbers, spaces, dots, dashes and underscores (6 levels max)")
    return "/".join(parts)


class SourceIn(BaseModel):
    language: Language
    code: str = Field(max_length=MAX_CODE)


class RunIn(BaseModel):
    run_id: str = Field(pattern=r"^[A-Za-z0-9-]{1,64}$")
    runner: str = Field("server", pattern=r"^(server|[a-z0-9]{8})$")
    language: Language
    code: str = Field(max_length=MAX_CODE)
    id: str | None = Field(None, pattern=r"^[A-Za-z0-9]{8}$")


MODULE_EXT = {"python": ".py", "lua": ".lua", "javascript": ".js", "typescript": ".ts"}


def _siblings(body):
    """Other files in the same folder that a program can link against or import."""
    if body.language not in ("c", "cpp", *MODULE_EXT) or not body.id:
        return []
    me = db.get_session(body.id)
    if not me:
        return []
    out, taken = [], set()
    if body.language in MODULE_EXT:
        for f in db.all_codes():
            stem = re.sub(r"[^A-Za-z0-9_-]", "_", f["title"]).strip("_") or "file"
            if f["id"] != body.id and f["language"] == body.language and f["folder"] == me["folder"] and stem != "main" and stem not in taken:
                out.append((stem + MODULE_EXT[body.language], f["code"]))
                taken.add(stem)
        return out[:60]
    if not me["folder"]:
        return []
    for f in db.all_codes():
        if f["id"] == body.id or f["language"] != body.language or f["folder"] != me["folder"]:
            continue
        stem = re.sub(r"[^A-Za-z0-9_-]", "_", f["title"]).strip("_") or "file"
        funcs = [n for n in graph.analyze(body.language, f["code"])["nodes"] if n["kind"] == "function"]
        ext = ".c" if body.language == "c" else ".cpp"
        if stem in ("main", "out") or stem + ".h" in taken or any(n["name"] == "main" for n in funcs) or re.search(r"\bmain\s*\(", f["code"]):
            continue
        if funcs:
            out.append((stem + ext, f["code"]))
            out.append((stem + ".h", _header(stem, f["code"], funcs)))
            taken.add(stem + ".h")
        else:
            out.append((stem + ".h", f["code"]))
            taken.add(stem + ".h")
    return out[:60]


def _header(stem, code, funcs):
    """A prototype header for a source file, so that `#include "<name>.h"` resolves."""
    guard = f"EIDE_{re.sub(r'[^A-Za-z0-9]', '_', stem).upper()}_H"
    includes = [line for line in code.splitlines() if re.match(r"\s*#\s*include\s*<", line)]
    protos = [f"{n['ret']} {n['name']}{n['sig']};" for n in funcs if n["name"] != "main" and n["ret"]]
    return "\n".join([f"#ifndef {guard}", f"#define {guard}", *includes, *protos, "#endif", ""])


def _new_id():
    return "".join(secrets.choice(ID_ALPHABET) for _ in range(8))


def _require(session_id):
    session = db.get_session(session_id) if ID_RE.match(session_id) else None
    if not session:
        raise HTTPException(404, "Session not found")
    return session


@app.get("/api/sessions")
def list_sessions(limit: int = 300):
    return db.list_sessions(max(1, min(limit, 500)))


@app.post("/api/sessions")
def save_session(body: SessionIn):
    session_id = body.id if body.id and ID_RE.match(body.id) else _new_id()
    layout = json.dumps(body.layout) if body.layout is not None else None
    if layout is not None and len(layout) > MAX_LAYOUT:
        raise HTTPException(413, "Layout too large")
    folder = _folder(body.folder) if body.folder is not None else None
    return db.upsert_session(session_id, body.title.strip() or "Untitled", body.language, body.code, layout, folder)


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    session = dict(_require(session_id))
    try:
        session["layout"] = json.loads(session["layout"]) if session.get("layout") else None
    except ValueError:
        session["layout"] = None
    return session


@app.get("/api/tree")
def project_tree():
    files = db.list_sessions(500)
    folders = set(db.list_folders())
    for f in files:
        parts = f["folder"].split("/") if f["folder"] else []
        folders.update("/".join(parts[: i + 1]) for i in range(len(parts)))
    return {"folders": sorted(folders), "files": files, "links": links.build(db.all_codes())}


LANG_EXT = {
    "c": "c", "cpp": "cpp", "lua": "lua", "python": "py", "javascript": "js", "typescript": "ts", "html": "html",
    "css": "css", "json": "json", "yaml": "yaml", "sql": "sql", "markdown": "md", "shell": "sh", "java": "java",
    "go": "go", "rust": "rs", "text": "txt", "http": "http", "xml": "xml", "properties": "properties", "toml": "toml",
}


ENTRY_FILES = ("main.py", "app.py", "manage.py", "index.js", "index.html", "main.c", "main.cpp", "src/main.rs", "main.go", "src/main/java/com/example/Application.java")


class ProjectIn(BaseModel):
    template: str = Field(max_length=30)
    name: str = Field(max_length=40)


class ImportFile(BaseModel):
    path: str = Field(max_length=300)
    content: str = Field(max_length=MAX_CODE)


class ImportIn(BaseModel):
    folder: str = Field("", max_length=300)
    files: list[ImportFile] = Field(max_length=500)


class SyncIn(BaseModel):
    folder: str = Field(max_length=300)


class FeedbackIn(BaseModel):
    kind: Literal["bug", "idea", "other"] = "other"
    message: str = Field(min_length=3, max_length=3000)
    first_name: str = Field("", max_length=60)
    last_name: str = Field("", max_length=60)
    context: str = Field("", max_length=2000)


FEEDBACK_PER_HOUR = 10
_feedback_hits = defaultdict(deque)


@app.post("/api/feedback", status_code=201)
def send_feedback(body: FeedbackIn, request: Request):
    who = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
    now = time.monotonic()
    hits = _feedback_hits[who]
    while hits and now - hits[0] > 3600:
        hits.popleft()
    if len(hits) >= FEEDBACK_PER_HOUR:
        raise HTTPException(429, "You've sent a lot of feedback this hour. Please try again later.")
    hits.append(now)
    name = " ".join(f"{body.first_name} {body.last_name}".split()) or "Anonymous"
    db.add_feedback(_new_id(), body.kind, name, body.message.strip(), body.context.strip())
    return {"ok": True}


@app.get("/api/feedback")
def read_feedback(key: str = ""):
    admin = os.environ.get("EIDE_ADMIN_KEY", "")
    if not admin:
        raise HTTPException(404, "Not found")
    if not hmac.compare_digest(key, admin):
        raise HTTPException(403, "Wrong key")
    return db.list_feedback()


def _store(folder, files):
    made, skipped, first, ids = 0, 0, None, {}
    for path, text in files:
        parts = templates.split_path(path)
        if not parts or len(text) > MAX_CODE:
            skipped += 1
            continue
        sub, title, language = parts
        try:
            target = _folder("/".join(x for x in (folder, sub) if x), 12)
        except HTTPException:
            skipped += 1
            continue
        pieces = target.split("/") if target else []
        clean = text.replace("\r\n", "\n").replace("\x00", "").encode("utf-8", "replace").decode("utf-8")
        try:
            for i in range(len(pieces)):
                db.add_folder("/".join(pieces[: i + 1]))
            row = db.upsert_session(_new_id(), title.replace("\x00", ""), language, clean, None, target)
        except Exception:
            log.exception("import failed for %s", path)
            skipped += 1
            continue
        first = first or row["id"]
        ids[path] = row["id"]
        made += 1
    return made, skipped, first, ids


def _write_workspace(folder, files):
    base = terminal.WORKDIR.resolve()
    root = (base / db.current_owner.get() / folder).resolve()
    if base not in root.parents:
        raise HTTPException(422, "Bad folder")
    for rel, text in files:
        target = (root / rel).resolve()
        if root not in target.parents:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8", newline="\n")


@app.get("/api/templates")
def list_templates():
    return templates.listing()


@app.post("/api/projects", status_code=201)
def create_project(body: ProjectIn):
    name = body.name.strip()
    folder = _folder(name, 12)
    if not folder or "/" in folder:
        raise HTTPException(422, "Give the project a single folder name")
    files = templates.expand(body.template, name)
    if files is None:
        raise HTTPException(404, "Unknown project type")
    if folder in db.list_folders() or db.folder_in_use(folder):
        raise HTTPException(409, f"A folder called {folder} already exists")
    made, _, first, ids = _store(folder, files)
    db.add_folder(folder)
    entry = next((ids[p] for name in ENTRY_FILES for p in ids if p == name), first)
    try:
        _write_workspace(folder, files)
    except OSError:
        pass
    return {"folder": folder, "files": made, "open": entry}


@app.post("/api/import", status_code=201)
def import_files(body: ImportIn):
    folder = _folder(body.folder, 12) if body.folder else ""
    made, skipped, first, _ = _store(folder, [(f.path, f.content) for f in body.files])
    return {"imported": made, "skipped": skipped, "open": first}


@app.post("/api/workspace/sync")
def sync_workspace(body: SyncIn):
    folder = _folder(body.folder, 12)
    if not folder:
        raise HTTPException(422, "Choose a folder")
    files = []
    for f in db.all_codes(2000):
        if f["folder"] == folder or f["folder"].startswith(folder + "/"):
            rel = f["folder"][len(folder):].lstrip("/")
            files.append((f"{rel}/{f['title']}.{LANG_EXT[f['language']]}".lstrip("/"), f["code"]))
    _write_workspace(folder, files)
    return {"folder": folder, "files": len(files), "path": str(terminal.WORKDIR / folder)}


@app.get("/api/folders")
def list_all_folders():
    return db.list_folders()


@app.post("/api/folders", status_code=201)
def create_folder(body: FolderIn):
    path = _folder(body.path)
    if not path:
        raise HTTPException(422, "Folder name required")
    parts = path.split("/")
    for i in range(len(parts)):
        db.add_folder("/".join(parts[: i + 1]))
    return {"path": path}


@app.delete("/api/folders", status_code=204)
def remove_folder(path: str, force: bool = False):
    path = _folder(path)
    if force:
        db.delete_folder_tree(path)
    elif db.folder_in_use(path):
        raise HTTPException(409, "Folder is not empty")
    else:
        db.delete_folder(path)
    return Response(status_code=204)


class FolderRenameIn(BaseModel):
    src: str
    dst: str


@app.put("/api/folders")
def rename_folder(body: FolderRenameIn):
    src, dst = _folder(body.src), _folder(body.dst)
    if not src or not dst:
        raise HTTPException(422, "A folder name is required")
    if dst == src or dst.startswith(src + "/"):
        raise HTTPException(422, "A folder can't be moved into itself")
    parts = dst.split("/")
    for i in range(len(parts) - 1):
        db.add_folder("/".join(parts[: i + 1]))
    db.rename_folder(src, dst)
    return {"path": dst}


class TitleIn(BaseModel):
    title: str = Field(min_length=1, max_length=100)


@app.put("/api/sessions/{session_id}/title")
def rename_session(session_id: str, body: TitleIn):
    _require(session_id)
    title = body.title.strip()
    if not title:
        raise HTTPException(422, "A name is required")
    db.set_title(session_id, title)
    return {"title": title}


class RefactorIn(BaseModel):
    kind: Literal["symbol", "file"]
    id: str = Field(pattern=r"^[A-Za-z0-9]{8}$")
    old: str = Field(min_length=1, max_length=100)
    new: str = Field(min_length=1, max_length=100)
    files: list[str] | None = None


def _refactor_plan(body):
    files = db.all_codes(1000)
    me = next((f for f in files if f["id"] == body.id), None)
    if not me:
        raise HTTPException(404, "Not found")
    try:
        return files, refactor.plan(body.kind, files, me, body.old.strip(), body.new.strip())
    except ValueError as err:
        raise HTTPException(422, str(err))


@app.post("/api/refactor/preview")
async def refactor_preview(body: RefactorIn):
    _, (_, summary) = await asyncio.to_thread(_refactor_plan, body)
    return {"files": summary}


@app.post("/api/refactor/apply")
async def refactor_apply(body: RefactorIn):
    files, (edits, _) = await asyncio.to_thread(_refactor_plan, body)
    wanted = set(body.files) if body.files is not None else set(edits)
    by_id = {f["id"]: f for f in files}
    changed = []
    for file_id, (code, _) in edits.items():
        if file_id in wanted and code != by_id[file_id]["code"]:
            f = by_id[file_id]
            db.upsert_session(file_id, f["title"], f["language"], code)
            changed.append(file_id)
    return {"changed": changed}


@app.get("/api/search")
def search(q: str, case: bool = False, regex: bool = False, word: bool = False):
    if not q or len(q) > 200:
        raise HTTPException(422, "Enter something to search for")
    pattern = re.escape(q) if not regex else q
    if word:
        pattern = rf"\b(?:{pattern})\b"
    try:
        rx = re.compile(pattern, 0 if case else re.IGNORECASE)
    except re.error as err:
        raise HTTPException(422, f"Invalid pattern: {err}")
    hits, files = [], 0
    for f in db.all_codes(1000):
        found = 0
        for n, line in enumerate(f["code"].split("\n"), 1):
            m = rx.search(line[:2000])
            if m:
                found += 1
                if len(hits) < 300:
                    hits.append({"id": f["id"], "title": f["title"], "language": f["language"], "folder": f["folder"],
                                 "line": n, "col": m.start() + 1, "len": max(m.end() - m.start(), 1), "text": line.strip()[:200]})
        files += bool(found)
    return {"hits": hits, "files": files, "truncated": len(hits) >= 300}


@app.put("/api/sessions/{session_id}/folder")
def move_session(session_id: str, body: FolderIn):
    _require(session_id)
    folder = _folder(body.path)
    if folder:
        parts = folder.split("/")
        for i in range(len(parts)):
            db.add_folder("/".join(parts[: i + 1]))
    db.set_folder(session_id, folder)
    return {"folder": folder}


class GraphIn(SourceIn):
    id: str | None = None


def _graph_with_externals(body):
    result = graph.analyze(body.language, body.code)
    result["externals"] = []
    if body.id and ID_RE.match(body.id) and not result["error"]:
        files = [f for f in db.all_codes() if f["id"] != body.id]
        files.append({"id": body.id, "title": "", "language": body.language, "folder": "", "code": body.code})
        mine = db.get_session(body.id)
        if mine:
            files[-1]["title"] = mine["title"]
        result["externals"] = links.externals(files, body.id, result["nodes"])
    return result


@app.post("/api/graph")
async def code_graph(body: GraphIn):
    return await asyncio.to_thread(_graph_with_externals, body)


@app.delete("/api/sessions/{session_id}", status_code=204)
def delete_session(session_id: str):
    _require(session_id)
    db.delete_session(session_id)
    return Response(status_code=204)


@app.get("/api/sessions/{session_id}/revisions")
def list_revisions(session_id: str):
    _require(session_id)
    return history.summarize(db.all_revisions(session_id))


@app.get("/api/sessions/{session_id}/revisions/{n}")
def get_revision(session_id: str, n: int):
    _require(session_id)
    rev = db.get_revision(session_id, n)
    if not rev:
        raise HTTPException(404, "Revision not found")
    return rev


@app.post("/api/sessions/{session_id}/revisions/{n}/restore")
def restore_revision(session_id: str, n: int):
    _require(session_id)
    rev = db.get_revision(session_id, n)
    if not rev:
        raise HTTPException(404, "Revision not found")
    return db.upsert_session(session_id, rev["title"] or "Untitled", rev["language"], rev["code"])


@app.get("/api/sessions/{session_id}/blame")
def blame(session_id: str):
    _require(session_id)
    return history.blame(db.all_revisions(session_id))


@app.get("/api/terminal")
def terminal_status(request: Request):
    return terminal.status(request.headers, request.client.host if request.client else "")


@app.websocket("/ws/terminal")
async def terminal_socket(ws: WebSocket):
    await terminal.handle(ws)


@app.get("/api/tools")
async def tool_status():
    return await asyncio.to_thread(tools.status)


@app.post("/api/format")
async def format_source(body: SourceIn):
    async with run_slots:
        try:
            code, tool = await asyncio.to_thread(tools.format_code, body.language, body.code)
        except tools.ToolError as err:
            raise HTTPException(422, str(err))
    return {"code": code, "tool": tool}


@app.post("/api/lint")
async def lint_source(body: SourceIn):
    async with run_slots:
        try:
            return {"diagnostics": await asyncio.to_thread(tools.lint_code, body.language, body.code)}
        except tools.ToolError as err:
            raise HTTPException(422, str(err))


@app.get("/api/workspace/link")
def workspace_link():
    return {"shared": not MULTIUSER, "token": db.current_owner.get()}


@app.get("/api/runtimes")
def runtimes():
    return {lang: path is not None for lang, path in runner.toolchain().items()}


def _not_runnable(language):
    return {
        "steps": [], "exit_code": None, "timed_out": False, "stopped": False, "truncated": False, "rich": [],
        "time_limit": 0, "duration_ms": 0, "trace": None, "stderr": "",
        "error": f"Running {language} files isn't supported yet. Open a terminal to run it with your own tools.",
    }


@app.post("/api/run")
async def run(body: RunIn, x_owner_key: str | None = Header(None)):
    if body.language not in RUNNABLE:
        return _not_runnable(body.language)
    if body.runner != "server":
        return await agents.dispatch(body.runner, agents.owner_hash(x_owner_key), "run", body.run_id, body.language, body.code)
    async with run_slots:
        return await asyncio.to_thread(runner.run_code, body.run_id, body.language, body.code, None, _siblings(body))


@app.post("/api/trace")
async def trace(body: RunIn, x_owner_key: str | None = Header(None)):
    if body.language not in RUNNABLE:
        return _not_runnable(body.language)
    if body.runner != "server":
        return await agents.dispatch(body.runner, agents.owner_hash(x_owner_key), "trace", body.run_id, body.language, body.code)
    async with run_slots:
        return await asyncio.to_thread(runner.run_trace, body.run_id, body.language, body.code, None, _siblings(body))


@app.post("/api/run/{run_id}/stop", status_code=204)
async def stop_run(run_id: str, x_owner_key: str | None = Header(None)):
    runner.stop(run_id)
    try:
        await agents.stop(run_id, agents.owner_hash(x_owner_key))
    except HTTPException:
        pass
    return Response(status_code=204)


@app.get("/api/agents")
def list_agents(x_owner_key: str | None = Header(None)):
    return agents.list_for(agents.owner_hash(x_owner_key))


@app.post("/api/agents/pair")
def pair_agent(x_owner_key: str | None = Header(None)):
    code, expires_in = agents.create_code(agents.owner_hash(x_owner_key))
    return {"code": code, "expires_in": expires_in}


@app.delete("/api/agents/{agent_id}", status_code=204)
async def remove_agent(agent_id: str, x_owner_key: str | None = Header(None)):
    await agents.revoke(agent_id, agents.owner_hash(x_owner_key))
    return Response(status_code=204)


@app.websocket("/ws/agent")
async def agent_socket(ws: WebSocket):
    await agents.serve(ws)


@app.get("/agent.zip")
def agent_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, path in AGENT_FILES:
            z.write(path, f"eide-agent/{name}")
    return Response(buf.getvalue(), media_type="application/zip", headers={"Content-Disposition": "attachment; filename=eide-agent.zip"})


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
