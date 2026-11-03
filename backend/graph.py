import ast
import re

COMMENT = {"python": "#", "c": "//", "cpp": "//", "lua": "--", "javascript": "//", "typescript": "//", "java": "//", "go": "//", "rust": "//", "shell": "#"}
SCRIPTY = {"lua", "javascript", "typescript", "shell"}  # languages whose top-level code can call functions
BRACED = {"c", "cpp", "lua", "javascript", "typescript", "java", "go", "rust", "shell"}
JS_FUNC = re.compile(
    r"(?m)^[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(?:async[ \t]+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>(]*>)?\(([^)]*)\)"
    r"\s*(?::\s*([^{]+?))?\s*\{"
)
JS_ARROW = re.compile(
    r"(?m)^[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async[ \t]+)?(?:function\b[^(\n]*)?"
    r"\(([^)]*)\)\s*(?::\s*([^={]+?))?\s*(?:=>\s*)?\{"
)
GO_FUNC = re.compile(r"(?m)^func[ \t]+(?:\([^)]*\)[ \t]*)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\(([^)]*)\)[ \t]*([^{\n]*?)[ \t]*\{")
RUST_FUNC = re.compile(
    r"(?m)^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?(?:const[ \t]+)?(?:async[ \t]+)?(?:unsafe[ \t]+)?fn[ \t]+([A-Za-z_]\w*)\s*(?:<[^>]*>)?"
    r"\(([^)]*)\)\s*(?:->\s*([^{]+?))?\s*(?:where[^{]*)?\{"
)
JAVA_FUNC = re.compile(
    r"(?m)^[ \t]*((?:(?:public|private|protected|static|final|abstract|synchronized|native|default)\s+)*)((?:[\w<>\[\],.?]+\s+)+?)"
    r"([A-Za-z_]\w*)\s*\(([^;{}()]*)\)\s*(?:throws\s+[\w.,\s]+)?\{"
)
SHELL_FUNC = re.compile(r"(?m)^[ \t]*(?:function[ \t]+([A-Za-z_][\w-]*)[ \t]*(?:\(\))?|([A-Za-z_][\w-]*)[ \t]*\(\))[ \t]*\{")
TRANSPARENT = {
    "java": re.compile(r"\b(?:class|interface|enum|record)\s+\w+[^{;]*\{"),
    "rust": re.compile(r"\b(?:impl|mod|trait)\b[^{;]*\{"),
}
PRINTERS = {
    "javascript": re.compile(r"\bconsole\.(?:log|error|info|warn)\s*\(|\bprocess\.stdout\.write\s*\("),
    "typescript": re.compile(r"\bconsole\.(?:log|error|info|warn)\s*\(|\bprocess\.stdout\.write\s*\("),
    "java": re.compile(r"\bSystem\.(?:out|err)\.print(?:ln|f)?\s*\("),
    "go": re.compile(r"\bfmt\.(?:Print|Println|Printf)\s*\("),
    "rust": re.compile(r"\be?print(?:ln)?!\s*\("),
    "shell": re.compile(r"\b(?:echo|printf)\b"),
    "c": re.compile(r"\b(?:printf|puts|putchar|fprintf)\s*\("),
    "cpp": re.compile(r"\b(?:printf|puts|putchar|fprintf)\s*\(|\bstd::c(?:out|err)\b|\bc(?:out|err)\s*<<"),
    "lua": re.compile(r"\bprint\s*\(|\bio\.write\s*\("),
}
C_KEYWORDS = {"if", "for", "while", "switch", "return", "sizeof", "else", "do", "catch"}
C_FUNC = re.compile(
    r"(?m)^[ \t]*((?:[A-Za-z_][\w:<>,*&\s]*?[\s*&]+)?)([A-Za-z_~][\w:]*)\s*"
    r"\(([^;{}()]*(?:\([^;{}()]*\)[^;{}()]*)*)\)\s*"
    r"(?:const\b\s*)?(?:noexcept\b\s*)?(?:override\b\s*)?(?:->\s*[\w:<>,*&\s]+?)?\s*\{"
)
LUA_FUNC = re.compile(r"(?m)^[ \t]*(?:local[ \t]+)?function[ \t]+([A-Za-z_][\w.:]*)[ \t]*\(([^)]*)\)")
LUA_ASSIGN = re.compile(r"(?m)^[ \t]*(?:local[ \t]+)?([A-Za-z_][\w.]*)[ \t]*=[ \t]*function[ \t]*\(([^)]*)\)")
LUA_TOKEN = re.compile(r"\b(function|if|do|repeat|end|until)\b")
MAX_SITE = 120


def analyze(language, code):
    if language != "python" and language not in BRACED:
        return _empty(code)
    try:
        if language == "python":
            return _python(code)
        return _braced(language, code)
    except (RecursionError, ValueError) as err:
        return _empty(code, f"Couldn't analyze this file: {err}")


def _empty(code, error=None):
    return {"nodes": [], "edges": [], "entry": None, "order": [], "tail": code.split("\n"), "error": error}


def _unique(base, taken):
    name, n = base, 2
    while name in taken:
        name, n = f"{base}_{n}", n + 1
    taken.add(name)
    return name


SIZES = {
    "char": 1, "signed char": 1, "unsigned char": 1, "bool": 1, "_Bool": 1, "short": 2, "unsigned short": 2,
    "int": 4, "unsigned": 4, "unsigned int": 4, "signed": 4, "long": 8, "unsigned long": 8, "long long": 8,
    "unsigned long long": 8, "float": 4, "double": 8, "long double": 16, "size_t": 8, "ssize_t": 8, "ptrdiff_t": 8,
    "intptr_t": 8, "uintptr_t": 8, "int8_t": 1, "uint8_t": 1, "int16_t": 2, "uint16_t": 2, "int32_t": 4,
    "uint32_t": 4, "int64_t": 8, "uint64_t": 8,
}
QUALIFIERS = re.compile(r"\b(?:const|volatile|restrict|register|static|inline|extern|struct|enum|union)\b")


def describe(raw, array=False):
    raw = re.sub(r"(?:static|inline|extern)\s+", "", raw)
    text = " ".join(QUALIFIERS.sub(" ", raw).split())
    refs = text.count("&")
    stars = text.count("*") + (1 if array else 0)
    base = " ".join(text.replace("*", " ").replace("&", " ").split())
    if base == "void" and not stars:
        return {"type": raw.strip(), "kind": "void", "label": "no value", "size": 0}
    if stars:
        target = base or "?"
        label = ("pointer to " * stars) + target
        return {"type": raw.strip(), "kind": "pointer", "label": label + (" (string)" if base in ("char", "") and stars == 1 else ""), "size": 8, "pointee": SIZES.get(base)}
    size = SIZES.get(base)
    if base in ("float", "double", "long double"):
        kind, label = "float", f"floating point ({base})"
    elif base in ("bool", "_Bool"):
        kind, label = "boolean", "boolean"
    elif base in ("char", "signed char", "unsigned char"):
        kind, label = "character", f"character ({base})"
    elif size:
        kind, label = "integer", f"integer ({base})"
    else:
        kind, label = "other", base or "unknown"
    if refs:
        label = f"reference to {label}"
    return {"type": raw.strip(), "kind": kind, "label": label, "size": 8 if refs else size}


def _split_params(sig):
    inner = sig.strip()[1:-1]
    parts, depth, cur = [], 0, ""
    for ch in inner:
        if ch in "(<[":
            depth += 1
        elif ch in ")>]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur)
    return [p.strip() for p in parts if p.strip() and p.strip() != "void"]


def _types(language, seg):
    if language not in ("c", "cpp") or seg["kind"] != "function":
        return None
    params = []
    for p in _split_params(seg.get("sig", "()")):
        m = re.match(r"^(.*?)(\w+)\s*((?:\[[^\]]*\])*)\s*$", p, re.S)
        ctype, name, arr = (m.group(1).strip(), m.group(2), m.group(3)) if m and m.group(1).strip() else (p, "", "")
        params.append({"name": name, **describe(ctype, array=bool(arr))})
    return {"params": params, "ret": describe(seg.get("ret", "") or "void")}


def _finish(code, lines, segs, edges, language):
    ids = {s["id"] for s in segs}
    seen, clean = set(), []
    for e in edges:
        if e["from"] == e["to"] or (e["from"], e["to"]) in seen or e["from"] not in ids or e["to"] not in ids:
            continue
        seen.add((e["from"], e["to"]))
        clean.append(e)

    prev_end = 0
    nodes = []
    for s in segs:
        nodes.append({
            "id": s["id"], "name": s["name"], "kind": s["kind"], "sig": s.get("sig", ""), "ret": s.get("ret", ""),
            "start": s["start"], "end": s["end"], "text": "\n".join(lines[s["start"] - 1:s["end"]]),
            "gap": lines[prev_end:s["start"] - 1], "recursive": s.get("recursive", False), "prints": s.get("prints", False),
            "types": _types(language, s),
        })
        prev_end = s["end"]

    entry = next((s["id"] for s in segs if s["kind"] == "entry"), None)
    if entry is None:
        entry = next((s["id"] for s in segs if s["name"] == "main" and s["kind"] == "function"), None)
    if entry is None and (language == "python" or language in SCRIPTY):
        entry = next((s["id"] for s in reversed(segs) if s["kind"] == "script" and any(e["from"] == s["id"] for e in clean)), None)

    order, queue = [], [entry] if entry else []
    while queue:
        cur = queue.pop(0)
        if cur in order:
            continue
        order.append(cur)
        queue.extend(e["to"] for e in sorted((e for e in clean if e["from"] == cur), key=lambda e: e["line"]))
    order.extend(s["id"] for s in segs if s["id"] not in order)
    return {"nodes": nodes, "edges": clean, "entry": entry, "order": order, "tail": lines[prev_end:], "error": None}


def _grab_comments(lines, start, floor, marker):
    while start - 1 > floor and lines[start - 2].lstrip().startswith(marker):
        start -= 1
    return start


# ---------- Python ----------

def _py_calls(code, roots):
    found = {}
    for root in roots:
        for node in ast.walk(root):
            if not isinstance(node, ast.Call):
                continue
            fn = node.func
            name = fn.id if isinstance(fn, ast.Name) else fn.attr if isinstance(fn, ast.Attribute) else None
            if not name:
                continue
            entry = found.setdefault(name, {"n": 0, "line": node.lineno, "site": "", "attr": isinstance(fn, ast.Attribute)})
            entry["n"] += 1
            if node.lineno < entry["line"] or not entry["site"]:
                entry["line"] = min(entry["line"], node.lineno)
                entry["site"] = " ".join((ast.get_source_segment(code, node) or name).split())[:MAX_SITE]
    return found


def _python(code):
    try:
        tree = ast.parse(code)
    except SyntaxError as err:
        return {**_empty(code), "error": f"Line {err.lineno}: {err.msg}"}
    lines = code.split("\n")
    segs, group, taken = [], [], set()
    defs = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)

    def flush():
        if not group:
            return
        start, end = group[0].lineno, max(getattr(s, "end_lineno", s.lineno) for s in group)
        text = "\n".join(lines[start - 1:end])
        simple = all(isinstance(s, (ast.Import, ast.ImportFrom, ast.Assign, ast.AnnAssign)) or
                     (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant)) for s in group)
        if "__main__" in text and any(isinstance(s, ast.If) for s in group):
            kind, base = "entry", "entry"
        elif simple and not any(x["kind"] != "setup" for x in segs):
            kind, base = "setup", "setup"
        else:
            kind, base = "script", "script"
        segs.append({"start": start, "end": end, "kind": kind, "name": base, "id": _unique(base, taken), "roots": list(group)})
        group.clear()

    for stmt in tree.body:
        if isinstance(stmt, defs):
            flush()
            start = min([stmt.lineno] + [d.lineno for d in stmt.decorator_list])
            floor = segs[-1]["end"] if segs else 0
            start = _grab_comments(lines, start, floor, "#")
            is_class = isinstance(stmt, ast.ClassDef)
            if is_class:
                sig = f"({', '.join(ast.unparse(b) for b in stmt.bases)})" if stmt.bases else ""
            else:
                sig = f"({ast.unparse(stmt.args)})"
            segs.append({
                "start": start, "end": stmt.end_lineno, "kind": "class" if is_class else "function", "name": stmt.name,
                "id": _unique(stmt.name, taken), "roots": [stmt], "sig": sig,
                "ret": ast.unparse(stmt.returns) if not is_class and stmt.returns else "",
                "methods": [n.name for n in stmt.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))] if is_class else [],
            })
        else:
            group.append(stmt)
    flush()

    by_name = {s["name"]: s["id"] for s in segs if s["kind"] in ("function", "class")}
    methods = {}
    for s in segs:
        for m in s.get("methods", []):
            methods.setdefault(m, set()).add(s["id"])
    edges = []
    for s in segs:
        if s["kind"] == "setup":
            continue
        for name, info in _py_calls(code, s["roots"]).items():
            if name == "print" and not info["attr"]:
                s["prints"] = True
            target = by_name.get(name) if not info["attr"] else None
            if target is None and info["attr"] and len(methods.get(name, ())) == 1:
                target = next(iter(methods[name]))
            if target is None and info["attr"] and name in by_name:
                target = by_name[name]
            if target == s["id"]:
                s["recursive"] = True
            elif target:
                edges.append({"from": s["id"], "to": target, "n": info["n"], "line": info["line"], "site": info["site"]})
    return _finish(code, lines, segs, edges, "python")


# ---------- C, C++ and Lua ----------

def _mask(code, language):
    out, n, i = list(code), len(code), 0

    def blank(a, b):
        for k in range(a, min(b, n)):
            if out[k] != "\n":
                out[k] = " "

    lua = language == "lua"
    shell = language == "shell"
    slashes = not lua and not shell
    ticks = language in ("javascript", "typescript", "go")
    while i < n:
        c = code[i]
        if shell and c == "#" and (i == 0 or code[i - 1] in " \t\n;"):
            end = code.find("\n", i)
            end = n if end < 0 else end
            blank(i, end)
            i = end
        elif ticks and c == "`":
            end = code.find("`", i + 1)
            end = n if end < 0 else end
            blank(i + 1, end)
            i = end + 1
        elif language == "rust" and c == "'":
            m = re.match(r"'(?:\\.[^']*|[^'\\])'", code[i:])
            if m:
                blank(i + 1, i + m.end() - 1)
                i += m.end()
            else:
                i += 1
        elif lua and code.startswith("--", i):
            m = re.match(r"--\[(=*)\[", code[i:])
            if m:
                end = code.find(f"]{m.group(1)}]", i + m.end())
                end = n if end < 0 else end + len(m.group(1)) + 2
            else:
                end = code.find("\n", i)
                end = n if end < 0 else end
            blank(i, end)
            i = end
        elif lua and c == "[" and re.match(r"\[=*\[", code[i:]):
            m = re.match(r"\[(=*)\[", code[i:])
            end = code.find(f"]{m.group(1)}]", i + m.end())
            end = n if end < 0 else end + len(m.group(1)) + 2
            blank(i, end)
            i = end
        elif slashes and code.startswith("//", i):
            end = code.find("\n", i)
            end = n if end < 0 else end
            blank(i, end)
            i = end
        elif slashes and code.startswith("/*", i):
            end = code.find("*/", i + 2)
            end = n if end < 0 else end + 2
            blank(i, end)
            i = end
        elif c in "\"'":
            j = i + 1
            while j < n and code[j] != c and code[j] != "\n":
                j += 2 if code[j] == "\\" else 1
            blank(i + 1, j)
            i = j + 1
        else:
            i += 1
    text = "".join(out)
    if language in ("c", "cpp"):
        text = re.sub(r"(?m)^[ \t]*#(?:[^\n\\]|\\\n|\\.)*", lambda m: re.sub(r"[^\n]", " ", m.group(0)), text)
    return text


def _depths(masked, language):
    """Block depth at each index, treating namespace and extern braces as transparent."""
    depth = [0] * (len(masked) + 1)
    if language == "lua":
        d, last = 0, 0
        for m in LUA_TOKEN.finditer(masked):
            for k in range(last, m.end()):
                depth[k] = d
            d = max(d + (-1 if m.group(1) in ("end", "until") else 1), 0)
            last = m.end()
        for k in range(last, len(masked) + 1):
            depth[k] = d
        return depth
    pattern = TRANSPARENT.get(language) or re.compile(r"\bnamespace\s*[\w:]*\s*\{|\bextern\s+\{")
    transparent = {m.end() - 1 for m in pattern.finditer(masked)}
    stack, d = [], 0
    for i, c in enumerate(masked):
        depth[i] = d
        if c == "{":
            t = i in transparent
            stack.append(t)
            d += 0 if t else 1
        elif c == "}" and stack:
            d -= 0 if stack.pop() else 1
    depth[len(masked)] = d
    return depth


def _match_brace(masked, open_idx):
    d = 0
    for i in range(open_idx, len(masked)):
        if masked[i] == "{":
            d += 1
        elif masked[i] == "}":
            d -= 1
            if d == 0:
                return i
    return None


def _match_lua_end(masked, start):
    d = 0
    for m in LUA_TOKEN.finditer(masked, start):
        d += -1 if m.group(1) in ("end", "until") else 1
        if d == 0:
            return m.end()
    return None


def _line_of(offsets, idx):
    lo, hi = 0, len(offsets)
    while lo < hi:
        mid = (lo + hi) // 2
        if offsets[mid] <= idx:
            lo = mid + 1
        else:
            hi = mid
    return lo


def _scan_calls(code, masked, base, body_start, body_end, names, short, language):
    if not names:
        return {}
    alt = "|".join(re.escape(short[n]) for n in sorted(names, key=len, reverse=True))
    shell = language == "shell"
    if shell:
        pattern = re.compile(rf"(?:^|[;&|(`]|\$\()[ \t]*({alt})(?![\w-])", re.M)
    else:
        pattern = re.compile(rf"(?<![\w])(?:[\w.]*[.:])?({alt})\s*\(" if language == "lua" else rf"(?<![\w$])({alt})\s*\(")
    found = {}
    for m in pattern.finditer(masked, body_start, body_end):
        name = next(k for k, v in short.items() if v == m.group(1))
        depth, j = 0, m.end() - 1
        if shell:
            j = masked.find("\n", m.end())
            j = body_end if j < 0 else min(j, body_end)
            depth = 0
        while not shell and j < body_end:
            depth += 1 if masked[j] == "(" else -1 if masked[j] == ")" else 0
            j += 1
            if depth == 0:
                break
        line = code.count("\n", 0, m.start()) + 1
        site = " ".join(code[m.start():j].split())[:MAX_SITE]
        info = found.setdefault(name, {"n": 0, "line": line, "site": site})
        info["n"] += 1
    return found


def _brace_matches(language, masked):
    """Yields (name, signature, return type, match) for each candidate function header."""
    out = []
    if language in ("c", "cpp"):
        out = [(m.group(2), m.group(3), m.group(1), m) for m in C_FUNC.finditer(masked)]
    elif language in ("javascript", "typescript"):
        out = [(m.group(1), m.group(2), m.group(3) or "", m) for p in (JS_FUNC, JS_ARROW) for m in p.finditer(masked)]
    elif language == "go":
        out = [(m.group(1), m.group(2), m.group(3), m) for m in GO_FUNC.finditer(masked)]
    elif language == "rust":
        out = [(m.group(1), m.group(2), m.group(3) or "", m) for m in RUST_FUNC.finditer(masked)]
    elif language == "java":
        out = [(m.group(3), m.group(4), m.group(2), m) for m in JAVA_FUNC.finditer(masked)]
    elif language == "shell":
        out = [(m.group(1) or m.group(2), "", "", m) for m in SHELL_FUNC.finditer(masked)]
    return sorted(out, key=lambda t: t[3].start())


def _braced(language, code):
    lines = code.split("\n")
    masked = _mask(code, language)
    depth = _depths(masked, language)
    offsets, pos = [], 0
    for ln in lines:
        pos += len(ln) + 1
        offsets.append(pos)
    funcs = []

    if language == "lua":
        for pattern in (LUA_FUNC, LUA_ASSIGN):
            for m in pattern.finditer(masked):
                if depth[m.start()] != 0 or any(f["a"] <= m.start() < f["b"] for f in funcs):
                    continue
                token = LUA_TOKEN.search(masked, m.start())
                end = _match_lua_end(masked, token.start()) if token else None
                if end is None:
                    continue
                funcs.append({"a": m.start(), "b": end, "body": m.end(), "name": m.group(1), "sig": f"({' '.join(m.group(2).split())})", "ret": ""})
    else:
        for name, sig, ret, m in _brace_matches(language, masked):
            if name in C_KEYWORDS or depth[m.start()] != 0 or any(f["a"] <= m.start() < f["b"] for f in funcs):
                continue
            close = _match_brace(masked, m.end() - 1)
            if close is None:
                continue
            funcs.append({"a": m.start(), "b": close + 1, "body": m.end(), "name": name,
                          "sig": f"({' '.join(sig.split())})", "ret": " ".join(ret.split())})
    funcs.sort(key=lambda f: f["a"])

    segs, taken, cursor = [], set(), 1

    def region(upto):
        a, b = cursor, upto
        while a <= b and not lines[a - 1].strip():
            a += 1
        while b >= a and not lines[b - 1].strip():
            b -= 1
        if a <= b:
            segs.append({"start": a, "end": b, "region": True})

    for f in funcs:
        start = max(_line_of(offsets, f["a"]) + 1, cursor)
        end = max(_line_of(offsets, f["b"] - 1) + 1, start)
        start = _grab_comments(lines, start, cursor - 1, COMMENT[language])
        region(start - 1)
        segs.append({"start": start, "end": end, "kind": "function", "name": f["name"], "id": _unique(f["name"], taken),
                     "sig": f["sig"], "ret": f["ret"], "body": (f["body"], f["b"])})
        cursor = end + 1
    region(len(lines))

    names = {re.split(r"[.:]", f["name"])[-1] for f in funcs}
    first = True
    for s in segs:
        if not s.get("region"):
            continue
        lo = offsets[s["start"] - 2] if s["start"] > 1 else 0
        hi = offsets[s["end"] - 1]
        calls = language in SCRIPTY and any(re.search(r"(?<![\w-])" + re.escape(n) + (r"\b" if language == "shell" else r"\s*\("), masked[lo:hi]) for n in names)
        if language in SCRIPTY:
            kind, base = ("script", "script") if calls else ("setup", "setup")
        else:
            kind, base = ("setup", "setup") if first else ("script", "globals")
        first = False
        s.update(kind=kind, name=base, id=_unique(base, taken))

    fn_segs = [s for s in segs if s["kind"] == "function"]
    short = {s["id"]: re.split(r"[.:]", s["name"])[-1] for s in fn_segs}
    edges = []
    printer = PRINTERS.get(language)
    for s in segs:
        if "body" in s:
            lo, hi = s["body"]
        elif language in SCRIPTY:
            lo = offsets[s["start"] - 2] if s["start"] > 1 else 0
            hi = offsets[s["end"] - 1]
        else:
            lo = hi = 0
        if printer and hi > lo and printer.search(masked, lo, hi):
            s["prints"] = True
        targets = {i: n for i, n in short.items()}
        for tid, info in _scan_calls(code, masked, 0, lo, hi, targets.keys(), short, language).items():
            if tid == s["id"]:
                s["recursive"] = True
            else:
                edges.append({"from": s["id"], "to": tid, "n": info["n"], "line": info["line"], "site": info["site"]})
    return _finish(code, lines, segs, edges, language)
