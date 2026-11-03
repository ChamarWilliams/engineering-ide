import asyncio
import hashlib
import hmac
import re
import secrets
import time
import uuid
from collections import defaultdict, deque

from fastapi import HTTPException, WebSocket

from . import db

PAIR_TTL = 300
MAX_PENDING = 5
JOB_TIMEOUT = 45
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
OWNER_RE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
LANGUAGES = ("c", "cpp", "lua", "python")

_pairing = {}
_online = {}
_failures = defaultdict(deque)


class Agent:
    def __init__(self, agent_id, name, owner, ws, info):
        self.id = agent_id
        self.name = name
        self.owner = owner
        self.ws = ws
        self.info = info
        self.jobs = {}
        self.runs = {}

    def public(self):
        return {"id": self.id, "name": self.name, "online": True, **self.info}


def _sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def owner_hash(key):
    if not key or not OWNER_RE.match(key):
        raise HTTPException(401, "Missing owner key")
    return _sha(key)


def create_code(owner):
    now = time.time()
    for code, (_, expires) in list(_pairing.items()):
        if expires < now:
            del _pairing[code]
    if sum(1 for o, _ in _pairing.values() if o == owner) >= MAX_PENDING:
        raise HTTPException(429, "Too many pairing codes are open. Wait a few minutes.")
    code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
    _pairing[code] = (owner, now + PAIR_TTL)
    return f"{code[:4]}-{code[4:]}", PAIR_TTL


def list_for(owner):
    online = {a.id: a for a in _online.values() if a.owner == owner}
    result = []
    for row in db.list_agents(owner):
        live = online.get(row["id"])
        result.append(live.public() if live else {"id": row["id"], "name": row["name"], "online": False})
    return result


async def revoke(agent_id, owner):
    row = db.get_agent(agent_id)
    if not row or row["owner"] != owner:
        raise HTTPException(404, "Computer not found")
    db.delete_agent(agent_id)
    live = _online.pop(agent_id, None)
    if live:
        await live.ws.close(code=4401)


def _clean_info(raw):
    raw = raw if isinstance(raw, dict) else {}
    tools = raw.get("tools") if isinstance(raw.get("tools"), dict) else {}
    return {
        "platform": str(raw.get("platform", ""))[:60],
        "mode": "docker" if raw.get("mode") == "docker" else "native",
        "network": bool(raw.get("network")),
        "tools": {lang: bool(tools.get(lang)) for lang in LANGUAGES},
    }


def _throttled(ip):
    now = time.time()
    hits = _failures[ip]
    while hits and hits[0] < now - 60:
        hits.popleft()
    return len(hits) >= 10


def _authenticate(hello, ip):
    if _throttled(ip):
        return None
    name = str(hello.get("name") or "My computer").strip()[:60] or "My computer"
    code = str(hello.get("code") or "").replace("-", "").upper()
    if code:
        pending = _pairing.pop(code, None)
        if pending and pending[1] >= time.time():
            agent_id = "".join(secrets.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(8))
            token = secrets.token_urlsafe(32)
            db.add_agent(agent_id, name, pending[0], _sha(token))
            return agent_id, name, pending[0], token
    else:
        row = db.get_agent(str(hello.get("agent_id") or "")[:16])
        if row and hmac.compare_digest(row["token_hash"], _sha(str(hello.get("token") or ""))):
            return row["id"], row["name"], row["owner"], None
    _failures[ip].append(time.time())
    return None


async def serve(ws: WebSocket):
    await ws.accept()
    agent = None
    try:
        hello = await asyncio.wait_for(ws.receive_json(), 10)
        granted = _authenticate(hello, ws.client.host if ws.client else "?")
        if not granted:
            await ws.send_json({"type": "denied", "reason": "That pairing code or token is not valid."})
            await ws.close(code=4401)
            return
        agent_id, name, owner, token = granted
        previous = _online.pop(agent_id, None)
        if previous:
            await previous.ws.close(code=4000)
        agent = Agent(agent_id, name, owner, ws, _clean_info(hello.get("info")))
        _online[agent_id] = agent
        await ws.send_json({"type": "welcome", "agent_id": agent_id, "name": name, **({"token": token} if token else {})})
        while True:
            msg = await ws.receive_json()
            if msg.get("type") == "result":
                fut = agent.jobs.get(msg.get("job"))
                if fut and not fut.done():
                    fut.set_result(msg.get("result"))
    except Exception:
        pass
    finally:
        if agent:
            if _online.get(agent.id) is agent:
                del _online[agent.id]
            for fut in agent.jobs.values():
                if not fut.done():
                    fut.set_exception(HTTPException(502, "The computer disconnected during the run."))


async def dispatch(agent_id, owner, kind, run_id, language, code):
    agent = _online.get(agent_id)
    if not agent or agent.owner != owner:
        raise HTTPException(409, "That computer is offline. Start the agent and try again.")
    job = uuid.uuid4().hex
    fut = asyncio.get_running_loop().create_future()
    agent.jobs[job] = fut
    agent.runs[run_id] = job
    try:
        await agent.ws.send_json({"type": "job", "job": job, "kind": kind, "run_id": run_id, "language": language, "code": code})
        return await asyncio.wait_for(fut, JOB_TIMEOUT)
    except asyncio.TimeoutError:
        await stop(run_id, owner)
        raise HTTPException(504, "The computer took too long to respond.")
    finally:
        agent.jobs.pop(job, None)
        agent.runs.pop(run_id, None)


async def stop(run_id, owner):
    for agent in list(_online.values()):
        if run_id in agent.runs and agent.owner == owner:
            try:
                await agent.ws.send_json({"type": "stop", "run_id": run_id})
            except Exception:
                pass
