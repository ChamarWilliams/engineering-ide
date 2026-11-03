import ast
import re

from . import graph

INCLUDE = re.compile(r'#\s*include\s*"([^"]+)"')
REQUIRE = re.compile(r"require\s*\(?\s*[\"']([^\"']+)[\"']")


def _stem(name):
    base = re.split(r"[/\\]", name.strip())[-1]
    return base.rsplit(".", 1)[0].lower() if "." in base else base.lower()


def _imports(language, code):
    if language in ("c", "cpp"):
        return [(m.group(1), f'#include "{m.group(1)}"') for m in INCLUDE.finditer(code)]
    if language == "lua":
        return [(m.group(1), m.group(0)) for m in REQUIRE.finditer(code)]
    if language == "python":
        found = []
        try:
            tree = ast.parse(code)
        except SyntaxError:
            return found
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                found += [(a.name.split(".")[0], f"import {a.name}") for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
                found.append((node.module.split(".")[0], f"from {node.module} import ..."))
        return found
    return []


def build(files):
    by_stem = {}
    for f in files:
        by_stem.setdefault(f["title"].lower(), f)
    analyzed = {}

    def functions(f):
        if f["id"] not in analyzed:
            g = graph.analyze(f["language"], f["code"])
            analyzed[f["id"]] = [n for n in g["nodes"] if n["kind"] == "function"]
        return analyzed[f["id"]]

    links = []
    for f in files:
        seen = set()
        for target, via in _imports(f["language"], f["code"]):
            other = by_stem.get(_stem(target))
            if not other or other["id"] == f["id"] or other["id"] in seen or other["language"] != f["language"]:
                continue
            seen.add(other["id"])
            calls = []
            for fn in functions(other):
                short = re.split(r"[.:]", fn["name"])[-1]
                n = len(re.findall(r"\b" + re.escape(short) + r"\s*\(", f["code"]))
                if n:
                    calls.append({"name": short, "sig": fn["sig"], "ret": fn["ret"], "types": fn["types"], "n": n})
            links.append({"from": f["id"], "to": other["id"], "via": via, "calls": calls})
    return links


def externals(files, file_id, nodes):
    me = next((f for f in files if f["id"] == file_id), None)
    if not me:
        return []
    by_stem = {f["title"].lower(): f for f in files}
    found = []
    seen = set()
    for target, via in _imports(me["language"], me["code"]):
        other = by_stem.get(_stem(target))
        if not other or other["id"] == me["id"] or other["id"] in seen or other["language"] != me["language"]:
            continue
        seen.add(other["id"])
        for fn in graph.analyze(other["language"], other["code"])["nodes"]:
            if fn["kind"] != "function":
                continue
            short = re.split(r"[.:]", fn["name"])[-1]
            pattern = re.compile(r"\b" + re.escape(short) + r"\s*\(([^;\n]*)")
            for node in nodes:
                hit = pattern.search(node["text"])
                if hit:
                    found.append({
                        "id": f"ext:{other['title']}:{short}", "file": other["title"], "file_id": other["id"], "name": short,
                        "sig": fn["sig"], "ret": fn["ret"], "types": fn["types"], "via": via, "from": node["id"],
                        "line": node["start"] + node["text"][:hit.start()].count("\n"),
                        "site": hit.group(0).strip().rstrip(";"), "n": len(pattern.findall(node["text"])),
                    })
    return found
