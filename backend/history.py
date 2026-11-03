import difflib

MAX_LINES = 5000


def _lines(code):
    return code.splitlines()[:MAX_LINES]


def _opcodes(old, new):
    return difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes()


def summarize(revisions):
    items = []
    for i, rev in enumerate(revisions):
        before = _lines(revisions[i - 1]["code"]) if i else []
        after = _lines(rev["code"])
        added = removed = 0
        for tag, i1, i2, j1, j2 in _opcodes(before, after):
            if tag in ("replace", "insert"):
                added += j2 - j1
            if tag in ("replace", "delete"):
                removed += i2 - i1
        items.append({
            "n": rev["n"], "title": rev["title"], "created_at": rev["created_at"],
            "added": added, "removed": removed, "lines": len(after),
        })
    return list(reversed(items))


def blame(revisions):
    if not revisions:
        return {"latest": 0, "lines": []}
    stamps = {rev["n"]: rev["created_at"] for rev in revisions}
    prev = _lines(revisions[0]["code"])
    origins = [revisions[0]["n"]] * len(prev)
    for rev in revisions[1:]:
        cur = _lines(rev["code"])
        nxt = []
        for tag, i1, i2, j1, j2 in _opcodes(prev, cur):
            if tag == "equal":
                nxt.extend(origins[i1:i2])
            elif tag in ("replace", "insert"):
                nxt.extend([rev["n"]] * (j2 - j1))
        prev, origins = cur, nxt
    return {"latest": revisions[-1]["n"], "lines": [{"n": n, "at": stamps[n]} for n in origins]}
