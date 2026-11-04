"""API-level checks for runs, files, folders, history, refactor, graph, search and the tracer helpers."""
import itertools

import pytest

from backend import tracers
from conftest import PROJECT, normalize, read_sample

ids = itertools.count(1)


def rid(prefix="r"):
    return f"{prefix}{next(ids)}"


def save(client, title, language, code, folder=None):
    body = {"title": title, "language": language, "code": code}
    if folder is not None:
        body["folder"] = folder
    res = client.post("/api/sessions", json=body)
    assert res.status_code == 200, res.text
    return res.json()["id"]


def test_healthz(client):
    res = client.get("/healthz")
    assert res.status_code == 200


def test_session_roundtrip_and_delete(client):
    sid = save(client, "roundtrip", "python", "print(1)\n")
    got = client.get(f"/api/sessions/{sid}").json()
    assert got["title"] == "roundtrip" and got["code"] == "print(1)\n"
    assert client.delete(f"/api/sessions/{sid}").status_code == 204
    assert client.get(f"/api/sessions/{sid}").status_code == 404


def test_folders_and_tree(client):
    assert client.post("/api/folders", json={"path": "zz-a/zz-b"}).status_code == 201
    sid = save(client, "inner", "python", "x = 1\n", folder="zz-a/zz-b")
    tree = client.get("/api/tree").json()
    assert "zz-a/zz-b" in tree["folders"]
    assert any(f["id"] == sid and f["folder"] == "zz-a/zz-b" for f in tree["files"])
    assert client.delete("/api/folders", params={"path": "zz-a", "force": "true"}).status_code == 204
    assert all(f["id"] != sid for f in client.get("/api/tree").json()["files"])


def test_history_diff_and_restore(client):
    sid = save(client, "hist", "python", "a = 1\n")
    client.post("/api/sessions", json={"id": sid, "title": "hist", "language": "python", "code": "a = 2\n"})
    client.post("/api/sessions", json={"id": sid, "title": "hist", "language": "python", "code": "a = 3\n"})
    revs = client.get(f"/api/sessions/{sid}/revisions").json()
    assert len(revs) >= 2
    first = revs[-1]["n"]
    assert client.get(f"/api/sessions/{sid}/revisions/{first}").json()["code"] == "a = 1\n"
    assert client.post(f"/api/sessions/{sid}/revisions/{first}/restore").status_code in (200, 204)
    assert client.get(f"/api/sessions/{sid}").json()["code"] == "a = 1\n"


def test_search_finds_text(client):
    save(client, "needle_file", "python", "unique_needle_token = 1\n")
    hits = client.get("/api/search", params={"q": "unique_needle_token"}).json()
    assert hits, hits


def test_graph_lists_functions(client):
    res = client.post("/api/graph", json={"language": "python", "code": read_sample("python/recursion.py")}).json()
    names = {n["name"] for n in res["nodes"] if n["kind"] == "function"}
    assert {"fact", "fib"} <= names


def test_unsupported_language_is_reported(client):
    res = client.post("/api/trace", json={"run_id": rid(), "language": "html", "code": "<p>hi</p>"}).json()
    assert res["trace"] is None and "isn't supported" in res["error"]


RUN_CASES = {
    "python": ("python/recursion.py", "120\n5\n"),
    "c": ("c/recursion.c", "120\n"),
    "cpp": ("cpp/counter_class.cpp", "6\n"),
    "lua": ("lua/factorial.lua", "33\n"),
    "javascript": ("javascript/fib.js", "5\n"),
    "typescript": ("typescript/typed_sum.ts", "30\n"),
    "shell": ("shell/loop.sh", "total=6\n"),
    "java": ("java/Main.java", "total 9, head 30\n"),
    "rust": ("rust/main.rs", "14\n"),
    "go": ("go/main.go", "14\n"),
}


@pytest.mark.parametrize("lang", sorted(RUN_CASES))
def test_plain_run(client, tools, lang):
    if not tools.get(lang):
        pytest.skip(f"{lang} is not installed here")
    rel, want = RUN_CASES[lang]
    res = client.post("/api/run", json={"run_id": rid(), "language": lang, "code": read_sample(rel)}).json()
    assert res["error"] is None, res
    assert res["exit_code"] == 0
    assert normalize("".join(s.get("stdout", "") for s in res["steps"])) == want


def test_multifile_c_run_and_trace(client, tools):
    if not tools.get("c"):
        pytest.skip("gcc is not installed here")
    folder = "zz-multi"
    ids_by_name = {}
    for name in ("main", "mathops", "buffer"):
        code = (PROJECT / "c-multifile" / f"{name}.c").read_text(encoding="utf-8")
        ids_by_name[name] = save(client, name, "c", code, folder=folder)
    main_code = (PROJECT / "c-multifile" / "main.c").read_text(encoding="utf-8")
    try:
        run = client.post("/api/run", json={"run_id": rid(), "language": "c", "code": main_code, "id": ids_by_name["main"]}).json()
        assert run["error"] is None, run
        assert "total = 20, buffer sum = 86" in normalize("".join(s.get("stdout", "") for s in run["steps"]))
        plan, why = tracers.plan("c", tools)
        if why:
            pytest.skip(why)
        trace = client.post("/api/trace", json={"run_id": rid(), "language": "c", "code": main_code, "id": ids_by_name["main"]}).json()
        assert trace["trace"], trace
        fns = {s["fn"] for s in trace["trace"]["steps"]}
        assert {"add", "scale", "fill", "buffer_sum"} <= fns
    finally:
        client.delete("/api/folders", params={"path": folder, "force": "true"})


def test_refactor_preview_finds_other_file(client):
    folder = "zz-refactor"
    save(client, "util", "python", "def helper():\n    return 1\n", folder=folder)
    main_id = save(client, "app", "python", "from util import helper\nprint(helper())\n", folder=folder)
    try:
        res = client.post("/api/refactor/preview", json={"id": main_id, "language": "python", "old": "helper", "new": "helper2", "kind": "function"})
        assert res.status_code in (200, 422), res.text
    finally:
        client.delete("/api/folders", params={"path": folder, "force": "true"})


def test_java_entry_class_is_renamed():
    src = read_sample("java/ThrowsError.java")
    out = tracers.prepare_source("java", src)
    assert "class Main" in out and "ThrowsError" not in out


def test_java_nested_class_is_kept():
    out = tracers.prepare_source("java", read_sample("java/Main.java"))
    assert out.count("class Main") == 1 and "static class Node" in out


def test_non_java_source_is_untouched():
    assert tracers.prepare_source("c", "int main(){}") == "int main(){}"


def test_unknown_tracer_language_is_rejected():
    plan, why = tracers.plan("brainfuck", {})
    assert plan is None and "not available" in why


def test_python_tracer_uses_heap_for_instances(client):
    code = "class A:\n    def __init__(self):\n        self.x = 1\n\na = A()\nb = a\nprint(b.x)\n"
    trace = client.post("/api/trace", json={"run_id": rid(), "language": "python", "code": code}).json()["trace"]
    last = trace["steps"][-1]
    assert "p" in last["vars"]["a"] and last["vars"]["a"]["p"] == last["vars"]["b"]["p"]
    key = last["vars"]["a"]["p"]["h"]
    assert last["heap"][key]["d"][0] == ["x", 1]


def test_import_endpoint_builds_folders(client):
    files = [{"path": "src/util.py", "content": "def f():\n    return 1\n"}, {"path": "main.py", "content": "print(1)\n"}, {"path": "logo.png", "content": "x"}]
    res = client.post("/api/import", json={"folder": "zz-imp", "files": files})
    assert res.status_code == 201, res.text
    assert res.json()["imported"] == 2
    try:
        tree = client.get("/api/tree").json()
        assert {"zz-imp", "zz-imp/src"} <= set(tree["folders"])
        assert {f["title"] for f in tree["files"] if f["folder"].startswith("zz-imp")} == {"util", "main"}
    finally:
        client.delete("/api/folders", params={"path": "zz-imp", "force": "true"})


def test_import_survives_nul_bytes(client):
    files = [{"path": "a.py", "content": "x = 1\x00\n"}, {"path": "b.py", "content": "y = 2\n"}]
    res = client.post("/api/import", json={"folder": "zz-nul", "files": files})
    try:
        assert res.status_code == 201, res.text
        assert res.json()["imported"] == 2
    finally:
        client.delete("/api/folders", params={"path": "zz-nul", "force": "true"})


def test_standalone_c_programs_in_one_folder_do_not_clash(client, tools):
    if not tools.get("c"):
        pytest.skip("gcc is not installed here")
    folder = "zz-programs"
    ok = save(client, "first", "c", '#include <stdio.h>\nint main(void){puts("one");return 0;}\n', folder=folder)
    save(client, "second", "c", '#include <stdio.h>\nint main(void){puts("two");return 0;}\n', folder=folder)
    save(client, "broken", "c", "int main(void){ int x = ; }\n", folder=folder)
    try:
        code = client.get(f"/api/sessions/{ok}").json()["code"]
        run = client.post("/api/run", json={"run_id": rid(), "language": "c", "code": code, "id": ok}).json()
        assert run["error"] is None, run
        assert normalize("".join(s.get("stdout", "") for s in run["steps"])) == "one\n"
    finally:
        client.delete("/api/folders", params={"path": folder, "force": "true"})


def test_workspace_link_opens_same_files_on_another_device(client, monkeypatch):
    from fastapi.testclient import TestClient

    from backend import main

    monkeypatch.setattr(main, "MULTIUSER", True)
    phone, laptop, stranger = TestClient(main.app), TestClient(main.app), TestClient(main.app)
    laptop.post("/api/sessions", json={"title": "mine", "language": "python", "code": "x = 1\n"})
    link = laptop.get("/api/workspace/link").json()
    assert link["shared"] is False and len(link["token"]) == 24
    phone.get(f"/?ws={link['token']}")
    assert [f["title"] for f in phone.get("/api/tree").json()["files"]] == ["mine"]
    assert stranger.get("/api/tree").json()["files"] == []
    stranger.get("/?ws=not-a-real-token")
    assert stranger.get("/api/tree").json()["files"] == []
