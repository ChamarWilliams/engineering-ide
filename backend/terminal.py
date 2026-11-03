"""Interactive terminals over WebSocket: a local PTY shell or an SSH session to a remote host.

Access is fail-closed. Without configuration only direct loopback clients may open a terminal.
Set EIDE_TERMINAL=off to disable it, or EIDE_TERMINAL=token with EIDE_TERMINAL_TOKEN to allow
remote clients that present the token (for a hosted deployment).
"""
import asyncio
import hmac
import json
import os
import shutil
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
WORKDIR = ROOT / "data" / "workspace"
LOOPBACK = {"127.0.0.1", "::1", "localhost"}
MAX_TERMINALS = 4
IDLE_SECONDS = 30 * 60
SECRET_HINTS = ("TOKEN", "SECRET", "PASSWORD", "KEY", "DATABASE_URL", "CREDENTIAL")

try:
    import asyncssh
except ImportError:
    asyncssh = None

try:
    from winpty import PtyProcess as WinPty
except ImportError:
    WinPty = None

_active = 0


def mode():
    return os.environ.get("EIDE_TERMINAL", "local").lower()


def pty_backend():
    if sys.platform == "win32":
        return "winpty" if WinPty else "none"
    return "pty"


def authorize(headers, client_host, query_token):
    setting = mode()
    if setting == "off":
        return False, "Terminals are disabled on this server."
    origin = headers.get("origin")
    host = headers.get("host", "")
    if origin and urlparse(origin).netloc != host:
        return False, "Cross-origin terminal connections are refused."
    if setting == "token":
        expected = os.environ.get("EIDE_TERMINAL_TOKEN", "")
        if expected and query_token and hmac.compare_digest(expected, query_token):
            return True, ""
        return False, "A terminal token is required."
    forwarded = headers.get("x-forwarded-for") or headers.get("forwarded")
    if client_host in LOOPBACK and not forwarded:
        return True, ""
    return False, "Terminals are only available when you open the IDE on localhost. Set EIDE_TERMINAL=token to allow remote use."


def status(headers, client_host):
    ok, reason = authorize(headers, client_host, "")
    token_mode = mode() == "token"
    if token_mode and not ok:
        reason = "Enter the terminal token to connect."
    return {
        "allowed": ok or token_mode,
        "needs_token": token_mode,
        "reason": "" if ok or token_mode else reason,
        "local": pty_backend() != "none",
        "ssh": asyncssh is not None,
        "shell": os.path.basename(_shell()[0]),
    }


def _shell():
    if sys.platform == "win32":
        exe = os.environ.get("EIDE_SHELL") or shutil.which("pwsh") or shutil.which("powershell") or shutil.which("cmd") or "cmd.exe"
        return [exe, "-NoLogo"] if "powershell" in exe.lower() or "pwsh" in exe.lower() else [exe]
    return [os.environ.get("EIDE_SHELL") or os.environ.get("SHELL") or "/bin/bash"]


def _env():
    env = {k: v for k, v in os.environ.items() if not any(h in k.upper() for h in SECRET_HINTS)}
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    return env


class LocalSession:
    def __init__(self):
        self.queue = asyncio.Queue()
        self.exit_code = None
        self._proc = None
        self._fd = None
        self._reader = None

    async def start(self, cols, rows):
        WORKDIR.mkdir(parents=True, exist_ok=True)
        if sys.platform == "win32":
            if not WinPty:
                raise RuntimeError("Install pywinpty to use the local terminal on Windows (pip install pywinpty).")
            self._proc = WinPty.spawn(_shell(), cwd=str(WORKDIR), env=_env(), dimensions=(rows, cols))
            self._reader = asyncio.create_task(self._read_winpty())
            return
        import fcntl
        import pty
        import struct
        import termios

        master, slave = pty.openpty()
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        self._proc = await asyncio.create_subprocess_exec(
            *_shell(), stdin=slave, stdout=slave, stderr=slave, cwd=str(WORKDIR), env=_env(), start_new_session=True,
            preexec_fn=lambda: fcntl.ioctl(0, termios.TIOCSCTTY, 0),
        )
        os.close(slave)
        self._fd = master
        asyncio.get_running_loop().add_reader(master, self._on_readable)

    def _on_readable(self):
        try:
            data = os.read(self._fd, 65536)
        except OSError:
            data = b""
        if data:
            self.queue.put_nowait(data)
        else:
            self._finish()

    async def _read_winpty(self):
        try:
            while self._proc.isalive():
                data = await asyncio.to_thread(self._proc.read, 65536)
                if data:
                    self.queue.put_nowait(data.encode("utf-8", "replace"))
        except (EOFError, OSError):
            pass
        self._finish()

    def _finish(self):
        if self.exit_code is None:
            if sys.platform == "win32":
                self.exit_code = self._proc.exitstatus if self._proc and self._proc.exitstatus is not None else 0
            else:
                self.exit_code = self._proc.returncode if self._proc and self._proc.returncode is not None else 0
            self.queue.put_nowait(None)

    def write(self, data):
        if sys.platform == "win32":
            self._proc.write(data.decode("utf-8", "replace"))
        elif self._fd is not None:
            os.write(self._fd, data)

    def resize(self, cols, rows):
        if sys.platform == "win32":
            self._proc.setwinsize(rows, cols)
            return
        import fcntl
        import struct
        import termios

        if self._fd is not None:
            fcntl.ioctl(self._fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    async def close(self):
        if self._reader:
            self._reader.cancel()
        if sys.platform == "win32":
            try:
                if self._proc and self._proc.isalive():
                    self._proc.terminate(force=True)
            except Exception:
                pass
            return
        if self._fd is not None:
            try:
                asyncio.get_running_loop().remove_reader(self._fd)
                os.close(self._fd)
            except OSError:
                pass
            self._fd = None
        if self._proc and self._proc.returncode is None:
            try:
                self._proc.terminate()
                await asyncio.wait_for(self._proc.wait(), 2)
            except (ProcessLookupError, asyncio.TimeoutError):
                self._proc.kill()


class SshSession:
    def __init__(self, conn, process):
        self.queue = asyncio.Queue()
        self.exit_code = None
        self._conn = conn
        self._process = process
        self._reader = asyncio.create_task(self._read())

    @classmethod
    async def connect(cls, params, cols, rows):
        host = params["host"]
        port = int(params.get("port") or 22)
        key = await asyncio.wait_for(asyncssh.get_server_host_key(host, port), 15)
        fingerprint = key.get_fingerprint("sha256")
        expected = params.get("fingerprint")
        if expected != fingerprint:
            return None, {"fingerprint": fingerprint, "algorithm": key.algorithm.decode(), "changed": bool(expected)}
        pattern = host if port == 22 else f"[{host}]:{port}"
        known = asyncssh.import_known_hosts(f"{pattern} {key.export_public_key('openssh').decode().strip()}")
        options = {"known_hosts": known, "login_timeout": 20, "keepalive_interval": 30}
        auth = params.get("auth", "password")
        if auth == "password":
            options.update(password=params.get("password") or "", client_keys=None, agent_path=None, preferred_auth="password,keyboard-interactive")
        elif auth == "key":
            options.update(client_keys=[asyncssh.import_private_key(params["key"], params.get("passphrase") or None)], agent_path=None, password=None)
        conn = await asyncssh.connect(host, port, username=params.get("user") or None, **options)
        process = await conn.create_process(term_type="xterm-256color", term_size=(cols, rows), encoding=None)
        return cls(conn, process), None

    async def _read(self):
        try:
            while True:
                data = await self._process.stdout.read(65536)
                if not data:
                    break
                self.queue.put_nowait(data)
        except (asyncssh.Error, OSError):
            pass
        await self._process.wait_closed()
        self.exit_code = self._process.exit_status or 0
        self.queue.put_nowait(None)

    def write(self, data):
        self._process.stdin.write(data)

    def resize(self, cols, rows):
        self._process.change_terminal_size(cols, rows)

    async def close(self):
        self._reader.cancel()
        self._conn.close()
        try:
            await asyncio.wait_for(self._conn.wait_closed(), 2)
        except (asyncio.TimeoutError, Exception):
            pass


def _ssh_error(err):
    text = str(err) or err.__class__.__name__
    if asyncssh and isinstance(err, asyncssh.PermissionDenied):
        return "Authentication failed. Check the user name and credentials."
    if isinstance(err, (OSError, asyncio.TimeoutError)):
        return f"Could not reach the server: {text}"
    return text


async def handle(ws):
    global _active
    ok, reason = authorize(ws.headers, ws.client.host if ws.client else "", ws.query_params.get("token", ""))
    if not ok:
        await ws.close(code=4403, reason=reason[:120])
        return
    await ws.accept()
    if _active >= MAX_TERMINALS:
        await ws.send_text(json.dumps({"type": "error", "message": "Too many open terminals."}))
        await ws.close()
        return
    _active += 1
    session = None
    pump = None
    try:
        first = json.loads(await asyncio.wait_for(ws.receive_text(), 30))
        cols = max(10, min(int(first.get("cols", 80)), 500))
        rows = max(2, min(int(first.get("rows", 24)), 200))
        try:
            if first.get("kind") == "ssh":
                if asyncssh is None:
                    raise RuntimeError("Install asyncssh on the server to use SSH (pip install asyncssh).")
                params = first.get("ssh") or {}
                if not params.get("host"):
                    raise RuntimeError("Host is required.")
                session, challenge = await SshSession.connect(params, cols, rows)
                if challenge:
                    await ws.send_text(json.dumps({"type": "fingerprint", "host": params["host"], **challenge}))
                    await ws.close()
                    return
            else:
                session = LocalSession()
                await session.start(cols, rows)
        except Exception as err:
            await ws.send_text(json.dumps({"type": "error", "message": _ssh_error(err) if first.get("kind") == "ssh" else str(err)}))
            await ws.close()
            return
        await ws.send_text(json.dumps({"type": "ready"}))

        async def pump_out():
            while True:
                data = await session.queue.get()
                if data is None:
                    await ws.send_text(json.dumps({"type": "exit", "code": session.exit_code}))
                    return
                await ws.send_text(json.dumps({"type": "output", "data": data.decode("utf-8", "replace")}))

        pump = asyncio.create_task(pump_out())
        while not pump.done():
            recv = asyncio.create_task(ws.receive_text())
            done, _ = await asyncio.wait({recv, pump}, timeout=IDLE_SECONDS, return_when=asyncio.FIRST_COMPLETED)
            if recv not in done:
                recv.cancel()
                break
            msg = json.loads(recv.result())
            kind = msg.get("type")
            if kind == "input":
                session.write(str(msg.get("data", "")).encode("utf-8"))
            elif kind == "resize":
                session.resize(max(10, min(int(msg["cols"]), 500)), max(2, min(int(msg["rows"]), 200)))
            elif kind == "close":
                break
    except Exception:
        pass
    finally:
        _active -= 1
        if pump:
            pump.cancel()
        if session:
            await session.close()
        try:
            await ws.close()
        except Exception:
            pass
