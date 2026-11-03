"""Engineering IDE runner agent.

Connects out to the IDE over a WebSocket and runs code on this computer, so nothing needs
to be exposed or port-forwarded. Pair once with a code from the IDE, then just start it.
"""
import argparse
import json
import os
import platform
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

try:
    import runner
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
    import runner

try:
    from websockets.sync.client import connect
except ImportError:
    sys.exit("This agent needs the websockets package. Run: pip install websockets")

HERE = Path(__file__).resolve().parent
CONFIG = Path.home() / ".eide-agent.json"
LANGUAGES = ("c", "cpp", "lua", "python")
RUN_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")
MAX_CODE = 200_000
IMAGE_CHOICES = {
    "python": ("eide-python", "python:3.12-slim"),
    "c": ("eide-native", "gcc:14"),
    "cpp": ("eide-native", "gcc:14"),
    "lua": ("eide-native",),
}
BUILDS = (("eide-python", "Dockerfile.python"), ("eide-native", "Dockerfile.native"))


def load_config():
    try:
        return json.loads(CONFIG.read_text())
    except (OSError, ValueError):
        return {}


def save_config(data):
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(json.dumps(data, indent=2))
    try:
        CONFIG.chmod(0o600)
    except OSError:
        pass


def docker_ok():
    try:
        return subprocess.run(["docker", "info"], capture_output=True, timeout=20).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def have_image(name):
    try:
        return subprocess.run(["docker", "image", "inspect", name], capture_output=True, timeout=20).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def build_images():
    for tag, dockerfile in BUILDS:
        print(f"Building {tag} (this downloads base images and can take several minutes)...")
        if subprocess.run(["docker", "build", "-f", str(HERE / dockerfile), "-t", tag, str(HERE)]).returncode:
            sys.exit(f"Building {tag} failed.")
    print("Images are ready. Start the agent with --docker.")


def make_sandbox(args):
    images = {}
    for lang in LANGUAGES:
        found = next((n for n in IMAGE_CHOICES[lang] if have_image(n)), None)
        if found:
            images[lang] = found
    sandbox = runner.DockerSandbox(images, network=args.allow_network, pass_env=args.pass_env, memory=args.memory)
    sandbox.tools = {lang: sandbox.tools[lang] for lang in images}
    return sandbox


def ws_url(server):
    server = server.rstrip("/")
    server = re.sub(r"^http", "ws", server) if server.startswith("http") else f"wss://{server}"
    return server if server.endswith("/ws/agent") else server + "/ws/agent"


def describe(args, sandbox):
    if sandbox:
        tools = {lang: lang in sandbox.images for lang in LANGUAGES}
        return {"mode": "docker", "network": args.allow_network, "tools": tools}
    return {"mode": "native", "network": True, "tools": {lang: bool(p) for lang, p in runner.toolchain().items()}}


def execute(ws, lock, gate, sandbox, msg):
    with gate:
        try:
            lang, code, run_id = msg.get("language"), msg.get("code"), msg.get("run_id")
            if lang not in LANGUAGES or not isinstance(code, str) or len(code) > MAX_CODE or not RUN_ID.match(str(run_id)):
                raise ValueError("bad job")
            fn = runner.run_trace if msg.get("kind") == "trace" else runner.run_code
            result = fn(run_id, lang, code, sandbox)
        except Exception as err:
            result = {"error": f"Agent error: {err}", "steps": [], "rich": [], "trace": None}
    with lock:
        ws.send(json.dumps({"type": "result", "job": msg.get("job"), "result": result}))


def session(args, sandbox, saved):
    name = args.name or platform.node() or "My computer"
    hello = {"type": "hello", "name": name, "info": {**describe(args, sandbox), "platform": platform.platform()}}
    if saved:
        hello.update(agent_id=saved["agent_id"], token=saved["token"])
    else:
        hello["code"] = args.code
    lock, gate = threading.Lock(), threading.Semaphore(2)
    with connect(ws_url(args.server), max_size=2**24, open_timeout=15) as ws:
        ws.send(json.dumps(hello))
        reply = json.loads(ws.recv(timeout=15))
        if reply.get("type") != "welcome":
            print(reply.get("reason", "The IDE refused the connection."))
            return "denied"
        if reply.get("token"):
            data = load_config()
            data[args.server] = {"agent_id": reply["agent_id"], "token": reply["token"]}
            save_config(data)
            print(f"Paired as {reply['name']}.")
        print("Connected. Waiting for jobs. Press Ctrl+C to stop.")
        for raw in ws:
            msg = json.loads(raw)
            if msg.get("type") == "job":
                threading.Thread(target=execute, args=(ws, lock, gate, sandbox, msg), daemon=True).start()
            elif msg.get("type") == "stop":
                runner.stop(str(msg.get("run_id")))
    return "closed"


def main():
    p = argparse.ArgumentParser(description="Run code from the Engineering IDE on this computer.")
    p.add_argument("--server", help="IDE address, for example https://my-ide.replit.app")
    p.add_argument("--code", help="One-time pairing code shown in the IDE")
    p.add_argument("--name", help="Name shown in the IDE")
    p.add_argument("--docker", action="store_true", help="Run every job in a locked-down Docker container")
    p.add_argument("--allow-network", action="store_true", help="With --docker, let programs use the network when they run")
    p.add_argument("--pass-env", action="append", default=[], metavar="NAME", help="Pass this environment variable to programs (repeatable)")
    p.add_argument("--memory", default="256m", help="Docker memory limit per run")
    p.add_argument("--build-images", action="store_true", help="Build the Docker images, then exit")
    p.add_argument("--forget", action="store_true", help="Delete the saved pairing for --server, then exit")
    args = p.parse_args()

    if args.build_images:
        if not docker_ok():
            sys.exit("Docker is not running.")
        return build_images()
    if not args.server:
        p.error("--server is required")
    args.server = args.server.rstrip("/")
    config = load_config()
    if args.forget:
        config.pop(args.server, None)
        save_config(config)
        return print("Forgot the saved pairing.")
    saved = config.get(args.server)
    if not saved and not args.code:
        p.error("This computer is not paired yet. Pass --code with the code shown in the IDE.")

    sandbox = None
    if args.docker:
        if not docker_ok():
            sys.exit("Docker is not running. Start Docker Desktop and try again.")
        sandbox = make_sandbox(args)
        if not sandbox.images:
            sys.exit("No Docker images found. Run: python agent.py --build-images")
        missing = [lang for lang in LANGUAGES if lang not in sandbox.images]
        print(f"Docker mode. Images: {sandbox.images}" + (f" (no image for: {', '.join(missing)})" if missing else ""))
        print("Programs run with no network." if not args.allow_network else "Programs may use the network.")
    else:
        runner.EXTRA_ENV = tuple(args.pass_env)
        print("Native mode: programs run directly on this computer with a time limit but no memory cap and full network access.")
        print("Use --docker for isolation.")

    delay = 2
    while True:
        try:
            if session(args, sandbox, saved) == "denied":
                return
            delay = 2
        except KeyboardInterrupt:
            return print("Stopped.")
        except Exception as err:
            print(f"Connection lost ({err}). Retrying in {delay}s...")
        try:
            time.sleep(delay)
        except KeyboardInterrupt:
            return print("Stopped.")
        delay = min(delay * 2, 30)
        saved = load_config().get(args.server) or saved


if __name__ == "__main__":
    main()
