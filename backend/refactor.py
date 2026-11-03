"""Project-wide refactors: renaming a function or a file and updating the files that use it."""
import io
import re
import tokenize

from . import graph, links

IDENT = re.compile(r"^[A-Za-z_$][\w$]*$")
MAX_FILES = 200


def _mask_python(code):
    """Blanks comments and strings so that names inside them are not touched."""
    out = list(code)
    starts, pos = [], 0
    for line in code.split("\n"):
        starts.append(pos)
        pos += len(line) + 1
    try:
        for tok in tokenize.generate_tokens(io.StringIO(code).readline):
            if tok.type not in (tokenize.STRING, tokenize.COMMENT):
                continue
            a = starts[tok.start[0] - 1] + tok.start[1]
            b = starts[tok.end[0] - 1] + tok.end[1]
            for k in range(a, b):
                if out[k] != "\n":
                    out[k] = " "
    except (tokenize.TokenError, IndentationError, SyntaxError):
        pass
    return "".join(out)


def masked(language, code):
    return _mask_python(code) if language == "python" else graph._mask(code, language)


def _line_text(code, index):
    start = code.rfind("\n", 0, index) + 1
    end = code.find("\n", index)
    return code[start:end if end >= 0 else len(code)].strip()[:160]


def _importers(files, me, old_stem):
    """Files other than `me` that import a file called `old_stem` in the same language."""
    out = []
    for f in files:
        if f["id"] == me["id"] or f["language"] != me["language"]:
            continue
        if any(links._stem(target) == old_stem.lower() for target, _ in links._imports(f["language"], f["code"])):
            out.append(f)
    return out[:MAX_FILES]


def rename_symbol(files, me, old, new):
    """Edits to every file that imports `me` and uses the function `old`."""
    if not IDENT.match(old) or not IDENT.match(new):
        raise ValueError("Names may use letters, digits and underscores, and cannot start with a digit")
    token = re.compile(r"(?<![\w$])" + re.escape(old) + r"(?![\w$])")
    stem = me["title"].lower()
    edits = {}
    for f in _importers(files, me, me["title"]):
        code = f["code"]
        view = masked(f["language"], code)
        spans = []
        for m in token.finditer(view):
            before = view[max(0, m.start() - 1):m.start()]
            if before == ".":
                qualifier = re.search(r"([\w$]+)\.$", view[:m.start()])
                if not qualifier or qualifier.group(1).lower() != stem:
                    continue
            elif view[max(0, m.start() - 2):m.start()] == "->":
                continue
            spans.append((m.start(), m.end()))
        if spans:
            edits[f["id"]] = _apply(code, spans, new)
    return edits


def rename_file(files, me, old, new):
    """Edits to import statements in the files that import the file called `old`."""
    old_stem = old.lower()
    edits = {}
    for f in _importers(files, me, old):
        code = f["code"]
        spans = _import_spans(f["language"], code, old_stem)
        if not spans:
            continue
        changed = _apply(code, spans, new)
        if f["language"] == "python":
            changed = _qualifiers(changed, old, new)
        edits[f["id"]] = changed
    return edits


def _import_spans(language, code, old_stem):
    """(start, end) spans covering the file name inside import statements."""
    spans = []
    if language in ("c", "cpp"):
        for m in links.INCLUDE.finditer(code):
            if links._stem(m.group(1)) == old_stem:
                base = re.split(r"[/\\]", m.group(1))[-1]
                at = m.start(1) + len(m.group(1)) - len(base)
                spans.append((at, at + (len(base.rsplit(".", 1)[0]) if "." in base else len(base))))
    elif language == "lua":
        for m in links.REQUIRE.finditer(code):
            if links._stem(m.group(1)) == old_stem:
                parts = re.split(r"[/\\.]", m.group(1))
                tail = parts[-1]
                end = m.start(1) + len(m.group(1))
                spans.append((end - len(tail), end))
    elif language == "python":
        view = _mask_python(code)
        for m in re.finditer(r"(?m)^[ \t]*(?:from[ \t]+([\w.]+)[ \t]+import\b|import[ \t]+([^\n#]+))", view):
            if m.group(1):
                if m.group(1).split(".")[0].lower() == old_stem:
                    spans.append((m.start(1), m.start(1) + len(m.group(1).split(".")[0])))
            else:
                for part in re.finditer(r"[\w.]+", re.sub(r"\bas\s+\w+", "", m.group(2))):
                    if part.group().split(".")[0].lower() == old_stem:
                        a = m.start(2) + part.start()
                        spans.append((a, a + len(part.group().split(".")[0])))
    return spans


def _qualifiers(edit, old, new):
    """Updates `old.func(...)` uses after a plain `import old` is renamed."""
    code, lines = edit
    plain = re.search(r"(?m)^[ \t]*import[ \t]+(?:[\w.]+[ \t]*,[ \t]*)*" + re.escape(new) + r"\b(?![ \t]+as\b)", code)
    if not plain:
        return edit
    view = _mask_python(code)
    spans = [(m.start(1), m.end(1)) for m in re.finditer(r"(?<![\w.])(" + re.escape(old) + r")\.", view)]
    if not spans:
        return edit
    new_code, extra = _apply(code, spans, new)
    return new_code, sorted(set(lines) | set(extra))


def _apply(code, spans, new):
    """Replaces each span with `new`, right to left. Returns (new code, line numbers touched)."""
    lines = sorted({code.count("\n", 0, a) + 1 for a, _ in spans})
    out = code
    for a, b in sorted(spans, reverse=True):
        out = out[:a] + new + out[b:]
    return out, lines


def plan(kind, files, me, old, new):
    edits = rename_symbol(files, me, old, new) if kind == "symbol" else rename_file(files, me, old, new)
    by_id = {f["id"]: f for f in files}
    return edits, [
        {"id": fid, "title": by_id[fid]["title"], "folder": by_id[fid]["folder"], "language": by_id[fid]["language"],
         "count": len(lines), "lines": [{"line": n, "text": _line_text(by_id[fid]["code"], _offset(by_id[fid]["code"], n))} for n in lines[:6]]}
        for fid, (_, lines) in edits.items()
    ]


def _offset(code, line):
    pos = 0
    for _ in range(line - 1):
        pos = code.find("\n", pos) + 1
    return pos
