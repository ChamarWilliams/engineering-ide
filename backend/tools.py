import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from functools import cache
from pathlib import Path

from . import runner

TIMEOUT = 10
CLANG_STYLE = "{BasedOnStyle: LLVM, IndentWidth: 4, ColumnLimit: 100, AllowShortFunctionsOnASingleLine: None}"
ANSI = re.compile(r"\x1b\[[0-9;]*m")
GCC_LINE = re.compile(r"^<stdin>:(\d+):(\d+): (warning|error): (.*)$")


class ToolError(Exception):
    pass


@cache
def _find(name):
    bin_dir = Path(sys.executable).parent
    for candidate in (bin_dir / f"{name}.exe", bin_dir / name):
        if candidate.is_file():
            return str(candidate)
    return shutil.which(name)


def _run(cmd, code, args_ok=(0,)):
    env = {k: v for k, v in os.environ.items() if k.upper() in runner.ENV_KEEP}
    with tempfile.TemporaryDirectory(prefix="eide-fmt-", ignore_cleanup_errors=True) as cwd:
        try:
            done = subprocess.run(cmd, input=code, capture_output=True, text=True, timeout=TIMEOUT, cwd=cwd, env=env, encoding="utf-8")
        except subprocess.TimeoutExpired:
            raise ToolError("The tool took too long.")
    if done.returncode not in args_ok:
        text = ANSI.sub("", done.stderr or done.stdout).strip()
        raise ToolError(text.splitlines()[0] if text else "The tool failed.")
    return done


def _version(path, flag="--version"):
    try:
        out = subprocess.run([path, flag], capture_output=True, text=True, timeout=5).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return None
    match = re.search(r"\d+\.\d+(\.\d+)?", out)
    return match.group(0) if match else out[:20] or None


@cache
def _usable(name):
    path = _find(name)
    return path if path and _version(path) else None


def status():
    return {
        "ruff": _version(_usable("ruff")) if _usable("ruff") else None,
        "clang_format": _version(_usable("clang-format")) if _usable("clang-format") else None,
        "stylua": _version(_usable("stylua")) if _usable("stylua") else None,
        "gcc": bool(runner.toolchain()["c"]),
        "prettier": _version(_usable("prettier")) if _usable("prettier") else None,
    }


PRETTIER_FILES = {
    "javascript": "main.js", "typescript": "main.ts", "html": "main.html", "css": "main.css", "json": "main.json",
    "yaml": "main.yaml", "markdown": "main.md",
}


def format_code(language, code):
    if language == "python":
        tool = _find("ruff")
        if not tool:
            raise ToolError("Ruff is not installed on this server.")
        return _run([tool, "format", "--stdin-filename", "main.py", "-"], code).stdout, "ruff"
    if language in ("c", "cpp"):
        tool = _find("clang-format")
        if not tool:
            raise ToolError("clang-format is not installed on this server.")
        name = "main.c" if language == "c" else "main.cpp"
        return _run([tool, f"--assume-filename={name}", f"--style={CLANG_STYLE}"], code).stdout, "clang-format"
    if language in PRETTIER_FILES:
        tool = _usable("prettier")
        if not tool:
            raise ToolError("Prettier is not installed on this server.")
        return _run([tool, "--stdin-filepath", PRETTIER_FILES[language]], code).stdout, "prettier"
    tool = _usable("stylua")
    if not tool:
        raise ToolError("StyLua is not installed on this server.")
    return _run([tool, "--stdin-filepath", "main.lua", "-"], code).stdout, "stylua"


def lint_code(language, code):
    if language == "python":
        tool = _find("ruff")
        if not tool:
            return []
        done = _run([tool, "check", "--output-format", "json", "--no-cache", "--ignore", "E501", "--select", "E,F,W,B",
                     "--stdin-filename", "main.py", "-"], code, args_ok=(0, 1))
        items = json.loads(done.stdout or "[]")
        return [{
            "line": i["location"]["row"], "column": i["location"]["column"],
            "end_line": i["end_location"]["row"], "end_column": i["end_location"]["column"],
            "severity": "error" if str(i.get("code", "")).startswith(("E9", "F82", "F63", "F7")) else "warning",
            "code": i.get("code"), "message": i["message"],
        } for i in items]
    if language in ("c", "cpp"):
        tool = runner.toolchain()["c" if language == "c" else "cpp"]
        if not tool:
            return []
        done = _run([tool, "-fsyntax-only", "-Wall", "-Wextra", "-fno-diagnostics-show-caret", "-fdiagnostics-plain-output",
                     "-x", "c" if language == "c" else "c++", "-"], code, args_ok=(0, 1))
        out = []
        for line in done.stderr.splitlines():
            m = GCC_LINE.match(line)
            if m:
                out.append({"line": int(m[1]), "column": int(m[2]), "end_line": int(m[1]), "end_column": int(m[2]) + 1,
                            "severity": m[3], "code": None, "message": m[4]})
        return out[:100]
    return []
