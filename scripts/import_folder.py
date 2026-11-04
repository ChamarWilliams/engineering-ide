"""Loads a folder of source files into the running IDE (default http://localhost:8000).

Usage: python scripts/import_folder.py <folder> [server-url]
Each subfolder becomes an IDE folder; each file becomes a file named after its stem.
"""
import json
import os
import sys
import urllib.request

LANG = {
    ".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp", ".hpp": "cpp", ".py": "python", ".js": "javascript",
    ".ts": "typescript", ".lua": "lua", ".sh": "shell", ".java": "java", ".rs": "rust", ".go": "go",
    ".html": "html", ".css": "css", ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".sql": "sql",
    ".md": "markdown", ".xml": "xml", ".toml": "toml", ".txt": "text",
}

if len(sys.argv) < 2:
    sys.exit(__doc__)
root = os.path.abspath(sys.argv[1])
base = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:8000"
top = os.path.basename(root)


def call(method, path, body=None):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read() or b"null")


made = set()
count = 0
for folder, dirs, names in os.walk(root):
    dirs.sort()
    rel = os.path.relpath(folder, root)
    ide_folder = top if rel == "." else f"{top}/{rel.replace(os.sep, '/')}"
    for name in sorted(names):
        stem, ext = os.path.splitext(name)
        language = LANG.get(ext.lower())
        if not language:
            continue
        parts = ide_folder.split("/")
        for i in range(1, len(parts) + 1):
            path = "/".join(parts[:i])
            if path not in made:
                call("POST", "/api/folders", {"path": path})
                made.add(path)
        with open(os.path.join(folder, name), encoding="utf-8") as f:
            code = f.read()
        call("POST", "/api/sessions", {"title": stem, "language": language, "code": code, "folder": ide_folder})
        count += 1
print(f"Imported {count} files into folder '{top}' on {base}")
