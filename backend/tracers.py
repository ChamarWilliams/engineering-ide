"""Per-language tracing plans. Every tracer writes the same trace shape the Python tracer does:
{"steps": [{"line", "fn", "d", "vars", "out"}], "events": [...], "stdout": str, "cut": None | str}."""
import json
import os
import re
import shutil
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent / "tracer_scripts"
TRACE_TIMEOUT = 8.0
SUPPORTED = ("python", "javascript", "typescript", "lua", "shell", "c", "cpp", "rust", "go", "java")


def _script(name):
    return (SCRIPTS / name).read_text(encoding="utf-8")


def _which(*names):
    for name in names:
        path = shutil.which(name)
        if path:
            return path
    return None


def plan(language, tools):
    """Files to write, optional compile command, the traced run command, extra env, and a post-processor.
    Returns (plan_dict, None) or (None, error_message)."""
    if language not in SUPPORTED:
        return None, f"Tracing is not available for {language} yet."

    if language in ("c", "cpp", "rust", "go"):
        gdb = _which("gdb")
        compiler = tools.get(language)
        if not compiler:
            return None, f"{ {'c': 'gcc', 'cpp': 'g++', 'rust': 'rustc', 'go': 'Go'}[language] } is not installed on this server."
        if not gdb:
            return None, "Tracing compiled languages needs gdb, which is not installed on this server."
        source = {"c": "main.c", "cpp": "main.cpp", "rust": "main.rs", "go": "main.go"}[language]
        compile_cmd = {
            "c": [compiler, "-g", "-O0", "-std=c17", "-fno-omit-frame-pointer", source, "-o", "out.bin", "-lm"],
            "cpp": [compiler, "-g", "-O0", "-std=c++20", "-fno-omit-frame-pointer", source, "-o", "out.bin"],
            "rust": [compiler, "-g", "-C", "opt-level=0", "-o", "out.bin", source],
            "go": [compiler, "build", "-gcflags", "all=-N -l", "-o", "out.bin", source],
        }[language]
        return {
            "source": source,
            "files": {"_trace_gdb.py": _script("trace_gdb.py")},
            "compile": compile_cmd,
            "run": [gdb, "-q", "-batch", "-nx", "-x", "_trace_gdb.py", "./out.bin"],
            "env": {"EIDE_SRC": source, "EIDE_BREAK": {"rust": "main::main", "go": "main.main"}.get(language, "main")},
            "label": "gdb",
            "parse": None,
        }, None

    if language == "java":
        java, javac = _which("java"), _which("javac")
        if not (java and javac):
            return None, "a JDK is not installed on this server."
        return {"source": "Main.java", "files": {"Trace.java": _script("Trace.java")},
                "compile": [javac, "-g", "--add-modules", "jdk.jdi", "-d", ".", "Main.java", "Trace.java"],
                "run": [java, "--add-modules", "jdk.jdi", "-cp", ".", "Trace"], "env": {}, "label": "java", "parse": None}, None

    if language == "lua":
        lua = tools.get("lua")
        if not lua:
            return None, "lua is not installed on this server."
        return {"source": "main.lua", "files": {"_trace.lua": _script("trace.lua")}, "compile": None,
                "run": [lua, "_trace.lua"], "env": {}, "label": "lua", "parse": None}, None

    if language in ("javascript", "typescript"):
        node = tools.get("javascript")
        if not node:
            return None, "Node.js is not installed on this server."
        source = "main.ts" if language == "typescript" else "main.js"
        return {"source": source, "files": {"_trace.js": _script("trace.js")}, "compile": None,
                "run": [node, "--no-warnings", "_trace.js", source], "env": {}, "label": "node", "parse": None}, None

    if language == "shell":
        bash = tools.get("shell")
        if not bash:
            return None, "bash is not installed on this server."
        return {"source": "main.sh", "files": {"_trace.sh": _script("trace.sh")}, "compile": None,
                "run": [bash, "_trace.sh"], "env": {}, "label": "shell", "parse": parse_shell}, None

    return None, f"Tracing is not available for {language} yet."


def read_trace(workdir, parse=None):
    if parse:
        return parse(workdir)
    path = os.path.join(workdir, ".trace.json")
    if os.path.exists(path) and os.path.getsize(path) <= 4 * 1024 * 1024:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return None


_DECL = re.compile(r"^declare -(\S+) ([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$")
_ITEM = re.compile(r'\[((?:[^\]\\]|\\.)*)\]="((?:[^"\\]|\\.)*)"')
_NUM = re.compile(r"^-?\d+(\.\d+)?$")
_SHELL_SKIP = {"BASH_TRAPSIG", "BASH_COMMAND", "BASH_LINENO", "BASH_SOURCE", "FUNCNAME", "PIPESTATUS", "OLDPWD", "SHLVL", "_"}


def _unescape(text):
    return re.sub(r"\\(.)", r"\1", text)


def _scalar(text):
    text = _unescape(text)
    if _NUM.match(text):
        return float(text) if "." in text else int(text)
    return {"s": text[:60]}


def _shell_value(flags, raw):
    if raw is None:
        return None
    raw = raw.strip()
    if "a" in flags and raw.startswith("("):
        items = _ITEM.findall(raw[1:-1])
        return {"l": [_scalar(v) for _, v in items[:40]], "n": len(items), "k": "array"}
    if "A" in flags and raw.startswith("("):
        items = _ITEM.findall(raw[1:-1])
        return {"d": [[_unescape(k)[:30], _scalar(v)] for k, v in items[:40]], "n": len(items)}
    if raw.startswith('"') and raw.endswith('"'):
        return _scalar(raw[1:-1])
    if raw.startswith("$'"):
        return {"s": raw[2:-1][:60]}
    return _scalar(raw)


def parse_shell(workdir):
    raw_path = os.path.join(workdir, ".trace.raw")
    out_path = os.path.join(workdir, ".prog.out")
    if not os.path.exists(raw_path):
        return None
    with open(raw_path, encoding="utf-8", errors="replace") as f:
        lines = f.read().split("\n")
    prog = ""
    if os.path.exists(out_path):
        with open(out_path, encoding="utf-8", errors="replace") as f:
            prog = f.read(80000)
    marks, clean, pos = [], [], 0
    for ch in prog:
        if ch == "\x01":
            marks.append(pos)
        else:
            clean.append(ch)
            pos += 1
    stdout = "".join(clean)[:65536]

    raw_steps, cut, cur = [], None, None
    for line in lines:
        if line.startswith("@@STEP "):
            head, _, names = line[7:].partition("|")
            cur = {"line": int(head) if head.strip().isdigit() else 0, "names": names.split(), "vars": {}}
            raw_steps.append(cur)
        elif line.startswith("@@CUT"):
            cut = "steps"
        elif cur is not None:
            m = _DECL.match(line)
            if m and m.group(2) not in _SHELL_SKIP:
                cur["vars"][m.group(2)] = _shell_value(m.group(1), m.group(3))

    steps, events, stack = [], [], []
    for i, rs in enumerate(raw_steps):
        names = list(rs["names"])
        for tail in ("main", "source"):
            if names and names[-1] == tail:
                names.pop()
        frames = [n for n in reversed(names)]
        chain = ["<module>"] + frames
        while len(stack) > len(chain):
            gone = stack.pop()
            events.append({"e": "ret", "fn": gone, "q": gone, "d": len(stack), "value": None,
                           "vars": steps[-1]["vars"] if steps else {}, "at": len(steps)})
        while len(stack) < len(chain):
            idx = len(stack)
            stack.append(chain[idx])
            events.append({"e": "call", "fn": chain[idx], "q": chain[idx],
                           "caller": {"fn": chain[idx - 1], "line": steps[-1]["line"] if steps else rs["line"]} if idx else None,
                           "line": rs["line"], "d": idx, "vars": rs["vars"] if idx == len(chain) - 1 else {}, "at": len(steps), "types": {}})
        out_at = marks[i] if i < len(marks) else len(stdout)
        steps.append({"line": rs["line"], "fn": chain[-1], "d": len(chain) - 1, "vars": rs["vars"], "out": min(out_at, len(stdout))})
    while stack:
        gone = stack.pop()
        events.append({"e": "ret", "fn": gone, "q": gone, "d": len(stack), "value": None,
                       "vars": steps[-1]["vars"] if steps else {}, "at": len(steps)})
    return {"steps": steps, "events": events, "stdout": stdout, "cut": cut}
