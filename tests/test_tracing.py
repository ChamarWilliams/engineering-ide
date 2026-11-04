"""Runs every file in samples/loopline-test-project through /api/trace and checks the result.

A language whose tools are missing on this machine is skipped, not failed.
"""
import itertools
import sys

import pytest

from backend import tracers
from conftest import normalize, read_sample

LANGS = {".c": "c", ".cpp": "cpp", ".py": "python", ".js": "javascript", ".ts": "typescript",
         ".lua": "lua", ".sh": "shell", ".java": "java", ".rs": "rust", ".go": "go"}
ids = itertools.count(1)
ON_WINDOWS = sys.platform == "win32"

# path: expectations. out is the exact program output, "stderr" a fragment of stderr.
CASES = {
    "python/recursion.py": {"out": "120\n5\n", "calls": {"fact": 5, "fib": 15}},
    "python/bubble_sort.py": {"out": "[1, 2, 3, 4, 5]\n"},
    "python/linked_list.py": {"out": "30\n", "heap": 3},
    "python/objects_and_dicts.py": {"out_starts": "Ada 175", "heap": 1},
    "python/raises_error.py": {"out": "2.0\n4.0\n", "exit": 1, "stderr": "ZeroDivisionError"},
    "python/step_limit.py": {"cut": "steps", "steps": 1500},
    "c/pointer_array.c": {"out": "0\n3\n40\n", "pointer": ("nPtr", "nums", 4)},
    "c/linked_list.c": {"out": "60\n", "heap": 3},
    "c/recursion.c": {"out": "120\n", "calls": {"fact": 5}},
    "c/bubble_sort.c": {"out": "1 2 3 4 5 \n"},
    "c/reads_input.c": {"out": "n = 7\n"},
    "c/step_limit.c": {"cut": "steps", "steps": 1500},
    "c/crash_segfault.c": {"trace_error": "Segmentation fault"},
    "c/compile_error.c": {"error": "Compile error", "no_trace": True},
    "cpp/vector_sum.cpp": {"out": "total 30\n", "calls": {"square": 4}},
    "cpp/counter_class.cpp": {"out": "6\n", "calls": {"Counter::bump": 3}},
    "java/Main.java": {"out": "total 9, head 30\n", "calls": {"fact": 6}, "heap": 3},
    "java/ThrowsError.java": {"exit": 1, "stderr": "ArithmeticException", "calls": {"div": 1}},
    "javascript/fib.js": {"out": "5\n", "calls": {"fib": 15}},
    "javascript/objects_and_arrays.js": {"out_starts": "{\n  items:", "calls": {"addItem": 2}},
    "javascript/throws_error.js": {"exit": 1, "stderr": "too big", "calls": {"check": 3}},
    "typescript/typed_sum.ts": {"out": "30\n", "calls": {"dist2": 2}},
    "lua/factorial.lua": {"out": "33\n", "calls": {"fact": 9}},
    "shell/loop.sh": {"out": "total=6\n"},
    "rust/main.rs": {"out": "14\n", "calls": {"square": 3}},
    # gdb on Windows runs Go to completion early and sometimes loses its output, so only Linux is exact
    "go/main.go": {"out": "14\n", "calls": {"square": 3}} if not ON_WINDOWS else {"out_any": ("14\n", "")},
}


def call_counts(trace):
    counts = {}
    for ev in trace.get("events", []):
        if ev["e"] == "call":
            counts[ev["fn"]] = counts.get(ev["fn"], 0) + 1
    return counts


@pytest.mark.parametrize("rel", sorted(CASES))
def test_trace(client, tools, rel):
    lang = LANGS["." + rel.rsplit(".", 1)[1]]
    plan, why = tracers.plan(lang, tools) if lang != "python" else (True, None)
    if why:
        pytest.skip(why)
    want = CASES[rel]
    res = client.post("/api/trace", json={"run_id": f"t{next(ids)}", "language": lang, "code": read_sample(rel)}).json()
    trace = res.get("trace")

    if "error" in want:
        assert (res.get("error") or "").startswith(want["error"]), res
    if want.get("no_trace"):
        assert trace is None
        return
    assert trace, res
    if "exit" in want:
        assert res["exit_code"] == want["exit"]
    if "stderr" in want:
        assert want["stderr"] in (res.get("stderr") or "")
    if "trace_error" in want:
        assert want["trace_error"] in (trace.get("error") or "")
    if "out" in want:
        assert normalize(trace["stdout"]) == want["out"]
    if "out_any" in want:
        assert normalize(trace["stdout"]) in want["out_any"]
    if "out_starts" in want:
        assert normalize(trace["stdout"]).startswith(want["out_starts"])
    if "cut" in want:
        assert trace["cut"] == want["cut"]
    else:
        assert trace["cut"] is None
    if "steps" in want:
        assert len(trace["steps"]) == want["steps"]
    else:
        assert len(trace["steps"]) > 0
    for fn, n in want.get("calls", {}).items():
        assert call_counts(trace).get(fn, 0) >= n, (fn, call_counts(trace))
    if "heap" in want:
        biggest = max((len(s.get("heap", {})) for s in trace["steps"]), default=0)
        assert biggest >= want["heap"], biggest
    if "pointer" in want:
        name, target, index = want["pointer"]
        last = trace["steps"][-1]["vars"][name]["p"]
        assert (last["to"], last["i"]) == (target, index)
    for step in trace["steps"]:
        assert {"line", "fn", "d", "vars", "out"} <= set(step)
    for ev in trace["events"]:
        assert ev["e"] in ("call", "ret")
