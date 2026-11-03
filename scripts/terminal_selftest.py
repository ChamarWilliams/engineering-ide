"""Exercises /ws/terminal: a local shell and an SSH session against an in-process test server."""
import asyncio
import json
import sys

import asyncssh
import websockets

URL = "ws://localhost:8000/ws/terminal"


async def drive(first, send, expect, extra=None):
    async with websockets.connect(URL, origin="http://localhost:8000") as ws:
        await ws.send(json.dumps(first))
        out = ""
        deadline = asyncio.get_event_loop().time() + 12
        sent = False
        while asyncio.get_event_loop().time() < deadline:
            msg = json.loads(await asyncio.wait_for(ws.recv(), 12))
            if msg["type"] in ("error", "fingerprint"):
                return msg
            if msg["type"] == "ready" and not sent:
                sent = True
                await ws.send(json.dumps({"type": "input", "data": send}))
            if msg["type"] == "output":
                out += msg["data"]
                if expect in out:
                    return {"type": "ok", "tail": out[-200:]}
        return {"type": "timeout", "tail": out[-300:]}


class Server(asyncssh.SSHServer):
    def begin_auth(self, username):
        return True

    def password_auth_supported(self):
        return True

    def validate_password(self, username, password):
        return username == "tester" and password == "s3cret"


async def shell(process):
    process.stdout.write("welcome tester\r\n$ ")
    while True:
        try:
            line = await process.stdin.readline()
        except asyncssh.TerminalSizeChanged:
            continue
        if not line:
            break
        process.stdout.write(f"ran: {line.strip()}\r\n$ ")
    process.exit(0)


async def main():
    local = await drive({"kind": "local", "cols": 100, "rows": 30}, "echo selftest-local\r\n", "selftest-local")
    print("local:", local)

    key = asyncssh.generate_private_key("ssh-ed25519")
    srv = await asyncssh.create_server(Server, "127.0.0.1", 2299, server_host_keys=[key], process_factory=shell)
    params = {"host": "127.0.0.1", "port": 2299, "user": "tester", "auth": "password", "password": "s3cret"}
    first = await drive({"kind": "ssh", "cols": 80, "rows": 24, "ssh": params}, "x", "never")
    print("ssh first contact:", first)
    params["fingerprint"] = first["fingerprint"]
    good = await drive({"kind": "ssh", "cols": 80, "rows": 24, "ssh": params}, "hello\r\n", "ran: hello")
    print("ssh trusted:", good["type"])
    params["password"] = "wrong"
    bad = await drive({"kind": "ssh", "cols": 80, "rows": 24, "ssh": params}, "x", "never")
    print("ssh bad password:", bad["type"], bad.get("message", ""))
    params["password"] = "s3cret"
    params["fingerprint"] = "SHA256:tampered"
    changed = await drive({"kind": "ssh", "cols": 80, "rows": 24, "ssh": params}, "x", "never")
    print("ssh changed key:", changed["type"], changed.get("changed"))
    srv.close()
    await srv.wait_closed()

    try:
        async with websockets.connect(URL, origin="http://evil.example") as ws:
            await ws.recv()
    except Exception as err:
        print("cross-origin refused:", type(err).__name__)


asyncio.run(main())
sys.exit(0)
