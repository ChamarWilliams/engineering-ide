import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from functools import cache, partial

from . import tracers

RUN_TIMEOUT = 5.0
COMPILE_TIMEOUT = 15.0
MEMORY_LIMIT = 256 * 1024 * 1024
OUTPUT_LIMIT = 64 * 1024
FILE_LIMIT = 1024 * 1024
TRACE_LIMIT = 4 * 1024 * 1024
RICH_LIMIT = 6 * 1024 * 1024
IS_POSIX = os.name == "posix"
ON_REPLIT = bool(os.environ.get("REPL_ID") or os.environ.get("REPLIT_DEPLOYMENT"))  # its runtimes need more address space than RLIMIT_AS allows
BINARY = "out.bin" if IS_POSIX else "out.exe"
EXTRA_ENV = ()
ENV_KEEP = ("PATH", "LANG", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP")

_runs = {}
_runs_lock = threading.Lock()


class _Run:
    def __init__(self):
        self.proc = None
        self.stopped = False
        self.sandbox = None
        self.container = None


def _which(*names):
    for name in names:
        path = shutil.which(name)
        if path:
            return path
    return None


@cache
def toolchain():
    return {
        "c": _which("gcc", "clang"),
        "cpp": _which("g++", "clang++"),
        "lua": _which("lua5.4", "lua", "luajit"),
        "python": sys.executable,
        "javascript": _which("node"),
        "typescript": _which("tsx") or _which("node"),
        "shell": _which("bash", "sh"),
        "go": _which("go"),
        "rust": _which("rustc"),
        "java": _which("java") if _which("javac") else None,
    }


NAMES = {
    "c": "gcc", "cpp": "g++", "lua": "lua", "javascript": "Node.js", "typescript": "Node.js", "shell": "bash",
    "go": "Go", "rust": "rustc", "java": "a JDK",
}
LARGE_VM = {"javascript", "typescript", "go", "java", "gdb", "node"}  # runtimes that reserve more address space than RLIMIT_AS allows
SOURCE_FILES = {"javascript": "main.js", "typescript": "main.ts", "shell": "main.sh", "go": "main.go", "rust": "main.rs", "java": "Main.java"}


@cache
def _node_major(node):
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=10).stdout
        return int(out.strip().lstrip("v").split(".")[0])
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return 0


def _plan(language, tool, workdir, container=False, extra_sources=()):
    out = "out.bin" if container else BINARY
    binary = "/work/out.bin" if container else os.path.join(workdir, BINARY)
    if language == "c":
        return "main.c", [tool, "-O2", "-std=c17", "-Wall", "main.c", *extra_sources, "-o", out, "-lm"], [binary]
    if language == "cpp":
        return "main.cpp", [tool, "-O2", "-std=c++20", "-Wall", "main.cpp", *extra_sources, "-o", out], [binary]
    if language == "javascript":
        return "main.js", None, [tool, "main.js"]
    if language == "typescript":
        if os.path.basename(tool).lower().startswith("tsx"):
            return "main.ts", None, [tool, "main.ts"]
        flags = ["--experimental-strip-types"] if _node_major(tool) < 24 else []
        return "main.ts", None, [tool, *flags, "--no-warnings", "main.ts"]
    if language == "shell":
        return "main.sh", None, [tool, "main.sh"]
    if language == "go":
        return "main.go", [tool, "build", "-o", out, "main.go"], [binary]
    if language == "rust":
        return "main.rs", [tool, "-O", "-o", out, "main.rs"], [binary]
    if language == "java":
        return "Main.java", None, [tool, "Main.java"]
    if language == "lua":
        return "main.lua", None, [tool, "main.lua"]
    return "main.py", None, [tool, "-u", "_run.py"]


def _child_env(workdir):
    # User code never sees server secrets such as DATABASE_URL.
    env = {k: v for k, v in os.environ.items() if k.upper() in ENV_KEEP}
    env.update({k: os.environ[k] for k in EXTRA_ENV if k in os.environ})
    env.update(HOME=workdir, TMPDIR=workdir, PYTHONUNBUFFERED="1", PYTHONDONTWRITEBYTECODE="1",
               MPLBACKEND="Agg", MPLCONFIGDIR=workdir, GOCACHE=os.path.join(workdir, ".gocache"),
               GOPATH=os.path.join(workdir, ".gopath"), GOFLAGS="-mod=mod", CARGO_HOME=workdir)
    return env


def _limit_child(address_space=True, cpu_factor=1):
    import resource

    if address_space:
        resource.setrlimit(resource.RLIMIT_AS, (MEMORY_LIMIT, MEMORY_LIMIT))
    cpu = int(RUN_TIMEOUT) * cpu_factor + 1
    resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
    resource.setrlimit(resource.RLIMIT_FSIZE, (FILE_LIMIT, FILE_LIMIT))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def _peak_kb(proc, before):
    """Peak memory of a finished child in KB, or None when the platform can't tell."""
    try:
        if IS_POSIX:
            import resource

            after = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
            kb = after if sys.platform != "darwin" else after // 1024
            return kb if kb > before else None
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD), ("PeakWorkingSetSize", ctypes.c_size_t),
                        ("WorkingSetSize", ctypes.c_size_t), ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPagedPoolUsage", ctypes.c_size_t), ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaNonPagedPoolUsage", ctypes.c_size_t), ("PagefileUsage", ctypes.c_size_t),
                        ("PeakPagefileUsage", ctypes.c_size_t)]

        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        ok = ctypes.windll.psapi.GetProcessMemoryInfo(wintypes.HANDLE(int(proc._handle)), ctypes.byref(counters), counters.cb)
        return counters.PeakWorkingSetSize // 1024 if ok else None
    except Exception:
        return None


def _children_maxrss():
    if not IS_POSIX:
        return 0
    import resource

    kb = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    return kb if sys.platform != "darwin" else kb // 1024


def _kill(proc):
    try:
        if IS_POSIX:
            os.killpg(proc.pid, signal.SIGKILL)
        else:
            proc.kill()
    except (ProcessLookupError, PermissionError, OSError):
        pass


def _terminate(run, proc):
    if proc:
        _kill(proc)
    if run.sandbox and run.container:
        run.sandbox.kill(run.container)


def _read(path):
    with open(path, "rb") as f:
        data = f.read(OUTPUT_LIMIT + 1)
    return data[:OUTPUT_LIMIT].decode("utf-8", errors="replace"), len(data) > OUTPUT_LIMIT


def _step(run, phase, cmd, workdir, timeout, limited, sandbox=None, language=None, extra_env=None):
    shown = cmd
    env = _child_env(workdir)
    if extra_env:
        env.update(extra_env)
    if sandbox:
        run.sandbox, run.container = sandbox, f"eide-{os.urandom(4).hex()}"
        cmd = sandbox.argv(language, phase, cmd, workdir, run.container)
        env, limited, timeout = os.environ.copy(), False, timeout + sandbox.overhead
    out_path = os.path.join(workdir, f".{phase}.out")
    err_path = os.path.join(workdir, f".{phase}.err")
    kwargs = {}
    if IS_POSIX:
        kwargs["start_new_session"] = True
        if limited:
            big = language in LARGE_VM or ON_REPLIT
            kwargs["preexec_fn"] = partial(_limit_child, not big, 4 if big else 1)
    else:
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP

    started = time.perf_counter()
    timed_out = False
    rss_before = _children_maxrss()
    with open(out_path, "wb") as out, open(err_path, "wb") as err:
        proc = subprocess.Popen(
            cmd, cwd=workdir, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
            env=env, **kwargs,
        )
        run.proc = proc
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            _terminate(run, proc)
            proc.wait()
        finally:
            run.proc = None
            run.container = None

    stdout, out_cut = _read(out_path)
    stderr, err_cut = _read(err_path)
    return {
        "phase": phase,
        "command": " ".join(os.path.basename(c) if i == 0 else c for i, c in enumerate(shown)),
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": proc.returncode,
        "timed_out": timed_out,
        "truncated": out_cut or err_cut,
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "peak_kb": None if sandbox else _peak_kb(proc, rss_before),
    }


def run_code(run_id, language, code, sandbox=None, extras=()):
    result = {
        "steps": [], "exit_code": None, "timed_out": False, "stopped": False,
        "truncated": False, "error": None, "time_limit": RUN_TIMEOUT * (3 if language == "java" else 1), "duration_ms": 0, "rich": [],
    }
    tool = sandbox.tools.get(language) if sandbox else toolchain().get(language)
    if not tool:
        result["error"] = f"{NAMES.get(language, language)} is not installed on this server."
        return result

    run = _Run()
    with _runs_lock:
        _runs[run_id] = run
    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="eide-", ignore_cleanup_errors=True) as workdir:
            extras = [(name, text) for name, text in extras if language in ("c", "cpp", "python", "lua", "javascript", "typescript") and os.path.basename(name) == name]
            sources = [name for name, _ in extras if name.endswith((".c", ".cpp"))]
            filename, compile_cmd, run_cmd = _plan(language, tool, workdir, bool(sandbox), sources)
            for name, text in [(filename, code), *extras]:
                with open(os.path.join(workdir, name), "w", encoding="utf-8", newline="\n") as f:
                    f.write(text)
            if language == "python":
                with open(os.path.join(workdir, "_run.py"), "w", encoding="utf-8", newline="\n") as f:
                    f.write(RUNNER)

            steps = []
            if compile_cmd:
                steps.append(("compile", compile_cmd, COMPILE_TIMEOUT, False))
            steps.append(("run", run_cmd, RUN_TIMEOUT * (3 if language == "java" else 1), True))  # source launcher compiles inside the run

            for phase, cmd, timeout, limited in steps:
                if run.stopped:
                    break
                step = _step(run, phase, cmd, workdir, timeout, limited, sandbox, language)
                result["steps"].append(step)
                result["exit_code"] = step["exit_code"]
                result["timed_out"] = step["timed_out"]
                result["truncated"] |= step["truncated"]
                result["peak_kb"] = max(result.get("peak_kb") or 0, step.get("peak_kb") or 0) or None
                if step["exit_code"] != 0:
                    break

            rich_path = os.path.join(workdir, ".rich.json")
            if os.path.exists(rich_path) and os.path.getsize(rich_path) <= RICH_LIMIT:
                with open(rich_path, encoding="utf-8") as f:
                    result["rich"] = json.load(f)
    finally:
        with _runs_lock:
            _runs.pop(run_id, None)
    result["stopped"] = run.stopped
    result["duration_ms"] = round((time.perf_counter() - started) * 1000)
    return result


RUNNER = r'''
import base64, io, json, sys, traceback, warnings

warnings.filterwarnings("ignore", message=".*non-interactive.*")
MAX_ROWS = 50
MAX_IMAGE = 1500000
rich = []


def cell(v):
    if v is None or isinstance(v, (bool, int, str)):
        return v if not isinstance(v, str) else v[:80]
    try:
        v = v.item()
    except AttributeError:
        pass
    if isinstance(v, float):
        return None if v != v else v
    return v if isinstance(v, (bool, int)) else str(v)[:80]


def display(*objs):
    for obj in objs:
        kind = type(obj).__module__.split(".")[0]
        if kind == "pandas" and (hasattr(obj, "iterrows") or hasattr(obj, "to_frame")):
            frame = obj if hasattr(obj, "iterrows") else obj.to_frame()
            if type(frame.index).__name__ != "RangeIndex":
                frame = frame.reset_index()
            head = frame.head(MAX_ROWS)
            rich.append({"type": "table", "columns": [str(c) for c in head.columns],
                         "rows": [[cell(v) for v in row] for row in head.itertuples(index=False)], "n": len(frame)})
        elif kind == "polars" and hasattr(obj, "rows"):
            head = obj.head(MAX_ROWS)
            rich.append({"type": "table", "columns": list(head.columns),
                         "rows": [[cell(v) for v in row] for row in head.rows()], "n": obj.height})
        else:
            print(obj)


def save_rich():
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is not None:
        for num in plt.get_fignums():
            buf = io.BytesIO()
            plt.figure(num).savefig(buf, format="png", dpi=110, bbox_inches="tight")
            if buf.tell() <= MAX_IMAGE:
                rich.append({"type": "image", "data": base64.b64encode(buf.getvalue()).decode()})
    with open(".rich.json", "w", encoding="utf-8") as f:
        json.dump(rich, f)


status = 0
try:
    with open("main.py", encoding="utf-8") as f:
        code = compile(f.read(), "main.py", "exec")
    exec(code, {"__name__": "__main__", "display": display})
except SystemExit as e:
    status = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
except BaseException as e:
    status = 1
    tb = None if isinstance(e, SyntaxError) else e.__traceback__.tb_next
    traceback.print_exception(type(e), e, tb)
finally:
    try:
        save_rich()
    except BaseException:
        pass
sys.exit(status)
'''

TRACER = r'''
import json, sys, time, types, traceback

MAX_STEPS = 1500
MAX_ITEMS = 40
MAX_OUT = 65536
DEADLINE = time.perf_counter() + 3.5
SKIP = (types.ModuleType, types.FunctionType, types.BuiltinFunctionType, type)

steps = []
events = []
depth = [0]
MAX_EVENTS = 4000
MAX_HEAP = 24
cut = [None]
out_parts = []
out_len = [0]


class Stop(BaseException):
    pass


class Out:
    def write(self, s):
        room = MAX_OUT - out_len[0]
        if room > 0:
            out_parts.append(s[:room])
            out_len[0] += min(len(s), room)
        return len(s)

    def flush(self):
        pass


def enc(v, depth=0):
    if v is None or isinstance(v, (bool, int)):
        return v
    if isinstance(v, float):
        return v if v == v and abs(v) != float("inf") else {"r": repr(v)}
    if isinstance(v, str):
        return {"s": v[:60]}
    if depth < 2 and isinstance(v, (list, tuple, set, frozenset)):
        return {"l": [enc(x, depth + 1) for x in list(v)[:MAX_ITEMS]], "n": len(v), "k": type(v).__name__}
    if depth < 2 and isinstance(v, dict):
        return {"d": [[repr(k)[:30], enc(x, depth + 1)] for k, x in list(v.items())[:MAX_ITEMS]], "n": len(v)}
    if hasattr(v, "__dict__") and not isinstance(v, type) and type(v).__module__ == "__main__":
        return ptr(v)
    return {"r": repr(v)[:60]}


heap = {}
queue = []


def ptr(v):
    key = "@%x" % id(v)
    if key not in heap and len(heap) < MAX_HEAP:
        heap[key] = None
        queue.append((key, v))
    return {"p": {"h": key}, "r": key, "t": type(v).__name__}


def drain():
    while queue:
        key, obj = queue.pop(0)
        items = list(vars(obj).items())[:MAX_ITEMS]
        heap[key] = {"d": [[k, enc(x, 1)] for k, x in items], "n": len(items), "k": type(obj).__name__}


def snap_heap(frame):
    heap.clear()
    queue.clear()
    values = snap(frame)
    drain()
    return values, {k: v for k, v in heap.items() if v is not None}


def kind(v):
    try:
        size = sys.getsizeof(v)
    except TypeError:
        size = None
    info = {"t": type(v).__name__, "b": size}
    if isinstance(v, (list, tuple, set, frozenset, dict, str, bytes)):
        info["n"] = len(v)
    return info


def kinds(frame):
    code = frame.f_code
    names = code.co_varnames[:code.co_argcount + code.co_kwonlyargcount]
    return {k: kind(frame.f_locals[k]) for k in names if k in frame.f_locals}


def snap(frame):
    return {k: enc(v) for k, v in list(frame.f_locals.items()) if not k.startswith("__") and not isinstance(v, SKIP)}


def tracer(frame, event, arg):
    if frame.f_code.co_filename != "<user>":
        return None
    if event == "line":
        if len(steps) >= MAX_STEPS:
            cut[0] = "steps"
            raise Stop
        if time.perf_counter() > DEADLINE:
            cut[0] = "time"
            raise Stop
        values, objects = snap_heap(frame)
        step = {"line": frame.f_lineno, "fn": frame.f_code.co_name, "d": depth[0], "vars": values, "out": out_len[0]}
        if objects:
            step["heap"] = objects
        steps.append(step)
    elif event == "call":
        if len(events) < MAX_EVENTS:
            back = frame.f_back
            caller = {"fn": back.f_code.co_name, "line": back.f_lineno} if back and back.f_code.co_filename == "<user>" else None
            events.append({"e": "call", "fn": frame.f_code.co_name, "q": getattr(frame.f_code, "co_qualname", frame.f_code.co_name),
                           "caller": caller, "line": frame.f_code.co_firstlineno, "d": depth[0], "vars": snap(frame), "at": len(steps),
                           "types": kinds(frame)})
        depth[0] += 1
    elif event == "return":
        depth[0] = max(depth[0] - 1, 0)
        if len(events) < MAX_EVENTS:
            events.append({"e": "ret", "fn": frame.f_code.co_name, "q": getattr(frame.f_code, "co_qualname", frame.f_code.co_name),
                           "d": depth[0], "value": enc(arg), "vars": snap(frame), "at": len(steps), "rtype": kind(arg)})
    return tracer


with open("main.py", encoding="utf-8") as f:
    code = compile(f.read(), "<user>", "exec")

status = 0
sys.stdout = Out()
sys.settrace(tracer)
try:
    exec(code, {"__name__": "__main__", "display": print})
except Stop:
    pass
except SystemExit:
    pass
except BaseException:
    status = 1
    sys.settrace(None)
    traceback.print_exc()
finally:
    sys.settrace(None)
    sys.stdout = sys.__stdout__
    with open(".trace.json", "w", encoding="utf-8") as f:
        json.dump({"steps": steps, "events": events, "stdout": "".join(out_parts), "cut": cut[0]}, f)
sys.exit(status)
'''


def _phase(step):
    return {"phase": step["phase"], "tool": step["command"].split(" ")[0], "ms": step["duration_ms"], "exit_code": step["exit_code"], "timed_out": step["timed_out"]}


def run_trace(run_id, language, code, sandbox=None, extras=()):
    result = {
        "trace": None, "stderr": "", "exit_code": None, "timed_out": False,
        "stopped": False, "error": None, "duration_ms": 0, "phases": [],
    }
    if language != "python":
        return _trace_other(run_id, language, code, sandbox, result, extras)

    run = _Run()
    with _runs_lock:
        _runs[run_id] = run
    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="eide-", ignore_cleanup_errors=True) as workdir:
            modules = [(n, t) for n, t in extras if os.path.basename(n) == n and n.endswith(".py")]
            for name, text in (("main.py", code), ("_tracer.py", TRACER), *modules):
                with open(os.path.join(workdir, name), "w", encoding="utf-8", newline="\n") as f:
                    f.write(text)
            python = sandbox.tools["python"] if sandbox else toolchain()["python"]
            step = _step(run, "trace", [python, "-u", "_tracer.py"], workdir, RUN_TIMEOUT, True, sandbox, "python")
            result["phases"].append(_phase(step))
            result.update(stderr=step["stderr"], exit_code=step["exit_code"], timed_out=step["timed_out"])
            path = os.path.join(workdir, ".trace.json")
            if os.path.exists(path) and os.path.getsize(path) <= TRACE_LIMIT:
                with open(path, encoding="utf-8") as f:
                    result["trace"] = json.load(f)
    finally:
        with _runs_lock:
            _runs.pop(run_id, None)
    result["stopped"] = run.stopped
    result["duration_ms"] = round((time.perf_counter() - started) * 1000)
    return result


def _trace_other(run_id, language, code, sandbox, result, extras=()):
    if sandbox:
        result["error"] = "Tracing in the isolated sandbox is only available for Python."
        return result
    plan, error = tracers.plan(language, toolchain())
    if error:
        result["error"] = error
        return result

    run = _Run()
    with _runs_lock:
        _runs[run_id] = run
    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="eide-", ignore_cleanup_errors=True) as workdir:
            siblings = {n: t for n, t in extras if os.path.basename(n) == n and n not in plan["files"] and n != plan["source"]}
            files = {plan["source"]: tracers.prepare_source(language, code), **plan["files"], **siblings}
            for name, text in files.items():
                with open(os.path.join(workdir, name), "w", encoding="utf-8", newline="\n") as f:
                    f.write(text)
            if plan["compile"]:
                compile_cmd = list(plan["compile"])
                if language in ("c", "cpp"):
                    at = compile_cmd.index(plan["source"]) + 1
                    compile_cmd[at:at] = [n for n in siblings if n.endswith((".c", ".cpp"))]
                built = _step(run, "compile", compile_cmd, workdir, COMPILE_TIMEOUT, False, None, language)
                result["phases"].append(_phase(built))
                if built["exit_code"] != 0:
                    result.update(stderr=built["stderr"] or built["stdout"], exit_code=built["exit_code"], timed_out=built["timed_out"])
                    first = next((ln.strip() for ln in (built["stderr"] or "").splitlines() if "error" in ln.lower()), "")
                    result["error"] = f"Compile error: {first}" if first else "The program did not compile, so there is nothing to trace."
                    return result
            env = dict(plan["env"])
            if "EIDE_SRC" in env and language in ("c", "cpp"):
                env["EIDE_SRC"] = ",".join([plan["source"], *(n for n in siblings if n.endswith((".c", ".cpp")))])
            step = _step(run, "trace", plan["run"], workdir, tracers.TRACE_TIMEOUT, True, None, plan["label"], env)
            result["phases"].append(_phase(step))
            noise = "Error disabling address space randomization"
            quiet = "\n".join(ln for ln in step["stderr"].splitlines() if noise not in ln)
            result.update(stderr=quiet, exit_code=step["exit_code"], timed_out=step["timed_out"])
            result["trace"] = tracers.read_trace(workdir, plan["parse"])
            if result["trace"]:
                result["trace"]["language"] = language
                if step["timed_out"] and not result["trace"].get("cut"):
                    result["trace"]["cut"] = "time"
            elif os.path.exists(os.path.join(workdir, ".trace.json")):
                result["error"] = "The trace was too large to show. Try a shorter run."
            elif not result["stderr"].strip():
                result["error"] = "The tracer produced no steps."
    finally:
        with _runs_lock:
            _runs.pop(run_id, None)
    result["stopped"] = run.stopped
    result["duration_ms"] = round((time.perf_counter() - started) * 1000)
    return result


def stop(run_id):
    with _runs_lock:
        run = _runs.get(run_id)
    if run:
        run.stopped = True
        _terminate(run, run.proc)


class DockerSandbox:
    overhead = 3.0
    tools = {"c": "gcc", "cpp": "g++", "lua": "lua5.4", "python": "python"}  # other languages run natively only

    def __init__(self, images, network=False, pass_env=(), memory="256m"):
        self.images = images
        self.network = network
        self.pass_env = tuple(pass_env)
        self.memory = memory

    def argv(self, language, phase, cmd, workdir, name):
        net = "bridge" if self.network and phase == "run" else "none"
        args = [
            "docker", "run", "--rm", "--name", name, "--network", net,
            "--memory", self.memory, "--memory-swap", self.memory, "--pids-limit", "64", "--cpus", "1",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--mount", f"type=bind,source={workdir},target=/work", "-w", "/work",
            "-e", "HOME=/work", "-e", "MPLBACKEND=Agg", "-e", "MPLCONFIGDIR=/work",
            "-e", "PYTHONUNBUFFERED=1", "-e", "PYTHONDONTWRITEBYTECODE=1",
        ]
        if hasattr(os, "getuid"):
            args += ["--user", f"{os.getuid()}:{os.getgid()}"]
        if phase == "run":
            args += [a for n in self.pass_env if n in os.environ for a in ("-e", n)]
        return args + [self.images[language], *cmd]

    def kill(self, name):
        try:
            subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=15)
        except (OSError, subprocess.TimeoutExpired):
            pass
