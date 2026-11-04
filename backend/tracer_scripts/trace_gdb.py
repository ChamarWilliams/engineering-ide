import json
import os
import re
import sys
import time

import gdb

SRCS = set(os.environ.get("EIDE_SRC", "main.c").split(","))
MAX_STEPS = 1500
MAX_ITEMS = 40
MAX_EVENTS = 4000
MAX_HEAP = 24
BUDGET = 3.5
started = time.perf_counter()

gdb.execute("set pagination off")
gdb.execute("set confirm off")
gdb.execute("set print elements 64")
gdb.execute("set breakpoint pending on")
gdb.execute("set disable-randomization on")

steps, events, stack, retvals = [], [], [], {}
cut = None
heap = {}
pending = []


def hexa(n):
    return "0x%x" % n


def short(name):
    name = (name or "?").split("(")[0]
    for sep in ("::", "."):
        if name.startswith("main" + sep):
            name = name[len("main" + sep):]
    return name


def is_user(frame):
    try:
        sal = frame.find_sal()
    except gdb.error:
        return False
    return sal.symtab is not None and os.path.basename(sal.symtab.filename) in SRCS


def user_frames():
    out = []
    try:
        frame = gdb.newest_frame()
    except gdb.error:
        return out
    while frame is not None:
        if is_user(frame):
            out.append(frame)
        frame = frame.older()
    return out


def fn_name(frame, idx, total):
    name = short(frame.name())
    return "<module>" if idx == total - 1 and name == "main" else name


def type_name(t):
    try:
        return str(t)
    except gdb.error:
        return "?"


def frame_vars(frame):
    found = {}
    try:
        block = frame.block()
        line = frame.find_sal().line
    except (RuntimeError, gdb.error):
        return found
    while block is not None and not block.is_global and not block.is_static:
        for sym in block:
            if not (sym.is_variable or sym.is_argument) or sym.name in found:
                continue
            if sym.name.startswith("~") or (sym.name == "iter" and type_name(sym.type).startswith("core::")):
                continue
            if sym.is_variable and sym.line and sym.line > line:
                continue
            try:
                found[sym.name] = sym.value(frame)
            except (gdb.error, RuntimeError):
                continue
        if block.function is not None:
            break
        block = block.superblock
    return found


def global_vars(frame):
    found = {}
    try:
        statics = frame.block().static_block
        blocks = [b for b in (statics, statics.superblock if statics is not None else None) if b is not None]
        for blk in blocks:
            for sym in blk:
                if sym.is_variable and sym.symtab and os.path.basename(sym.symtab.filename) in SRCS:
                    try:
                        found[sym.name] = sym.value()
                    except (gdb.error, RuntimeError):
                        continue
    except (gdb.error, RuntimeError):
        pass
    return found


class Targets:
    def __init__(self, items):
        self.items = []
        for name, val in items:
            try:
                t = val.type.strip_typedefs()
                addr = int(val.address)
                size = t.sizeof
            except (gdb.error, RuntimeError, TypeError):
                continue
            elem = 0
            if t.code == gdb.TYPE_CODE_ARRAY:
                elem = t.target().sizeof or 1
            self.items.append((name, addr, size, elem, t.code == gdb.TYPE_CODE_ARRAY))

    def find(self, addr):
        for name, base, size, elem, is_arr in self.items:
            if is_arr and base <= addr <= base + size:
                return {"to": name, "i": (addr - base) // elem}
            if not is_arr and base <= addr < base + size:
                return {"to": name}
        return None


def printable(n):
    return 32 <= n < 127


def enc(v, targets, d=0):
    try:
        t = v.type.strip_typedefs()
    except (gdb.error, RuntimeError):
        return {"r": "?"}
    code = t.code
    try:
        if code == gdb.TYPE_CODE_BOOL:
            return bool(v)
        if code in (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_ENUM, gdb.TYPE_CODE_CHAR, gdb.TYPE_CODE_RANGE):
            n = int(v)
            if t.sizeof == 1 and code != gdb.TYPE_CODE_ENUM:
                return {"r": ("'%s' (%d)" % (chr(n), n)) if printable(n) else str(n), "v": n}
            if code == gdb.TYPE_CODE_ENUM:
                return {"r": str(v), "v": n}
            return n
        if code == gdb.TYPE_CODE_FLT:
            f = float(v)
            return f if f == f and abs(f) != float("inf") else {"r": repr(f)}
        if code == gdb.TYPE_CODE_PTR:
            return enc_ptr(v, t, targets, d)
        if code == gdb.TYPE_CODE_ARRAY:
            return enc_array(v, t, targets, d)
        if code in (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION):
            return enc_struct(v, t, targets, d)
        if code == gdb.TYPE_CODE_REF or code == gdb.TYPE_CODE_RVALUE_REF:
            return enc(v.referenced_value(), targets, d)
        return {"r": str(v)[:60]}
    except (gdb.error, RuntimeError, ValueError, OverflowError):
        return {"r": "<unavailable>"}


def enc_array(v, t, targets, d):
    lo, hi = t.range()
    n = hi - lo + 1
    elem = t.target().strip_typedefs()
    if elem.code in (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_CHAR) and elem.sizeof == 1:
        raw = bytes(int(v[i]) & 255 for i in range(min(n, 256)))
        text = raw.split(b"\0")[0].decode("latin-1")
        return {"s": text[:60], "n": n, "k": "char[%d]" % n}
    if d >= 2:
        return {"r": type_name(v.type)}
    items = [enc(v[i], targets, d + 1) for i in range(min(n, MAX_ITEMS))]
    return {"l": items, "n": n, "k": "array", "et": type_name(t.target())}


def enc_cpp(v, t, targets, d):
    name = t.tag or t.name or ""
    if name.startswith("std::vector<") and "bool" not in name.split(",")[0]:
        impl = v["_M_impl"]
        start, finish = impl["_M_start"], impl["_M_finish"]
        n = int(finish - start)
        if n < 0 or n > 1000000:
            return {"l": [], "n": 0, "k": "vector"}
        return {"l": [enc(start[i], targets, d + 1) for i in range(min(n, MAX_ITEMS))], "n": n, "k": "vector"}
    if name.startswith("std::__cxx11::basic_string<") or name.startswith("std::basic_string<"):
        ptr = v["_M_dataplus"]["_M_p"]
        length = int(v["_M_string_length"])
        return {"s": ptr.string(length=min(length, 60)), "n": length, "k": "string"}
    return None


def enc_struct(v, t, targets, d):
    if d >= 3:
        return {"r": "{...}"}
    try:
        special = enc_cpp(v, t, targets, d)
    except (gdb.error, RuntimeError, KeyError):
        special = None
    if special is not None:
        return special
    rows = []
    for field in t.fields():
        if field.name is None or field.is_base_class:
            continue
        try:
            rows.append([field.name, enc(v[field.name], targets, d + 1)])
        except (gdb.error, RuntimeError):
            rows.append([field.name, {"r": "?"}])
    name = t.tag or t.name or "struct"
    return {"d": rows, "n": len(rows), "k": name}


def enc_ptr(v, t, targets, d):
    addr = int(v)
    tname = type_name(v.type)
    target = t.target().strip_typedefs()
    if addr == 0:
        return {"p": {"null": True}, "r": "NULL", "t": tname}
    if target.code == gdb.TYPE_CODE_FUNC:
        return {"r": str(v)[:60], "t": tname}
    if target.code == gdb.TYPE_CODE_INT and target.sizeof == 1:
        try:
            text = v.string(length=60)
            return {"s": text, "t": tname, "p": {"h": hexa(addr)}}
        except (gdb.error, UnicodeDecodeError):
            pass
    hit = targets.find(addr)
    info = {"t": tname, "r": hexa(addr)}
    if hit:
        info["p"] = hit
        return info
    info["p"] = {"h": hexa(addr)}
    key = hexa(addr)
    if key not in heap and len(heap) < MAX_HEAP and target.code != gdb.TYPE_CODE_VOID:
        heap[key] = None
        pending.append((key, v))
    return info


def drain_heap(targets):
    while pending:
        key, ptr = pending.pop(0)
        try:
            heap[key] = enc(ptr.dereference(), targets, 1)
        except (gdb.error, RuntimeError):
            heap[key] = {"r": "?"}


def snap(frames):
    heap.clear()
    pending.clear()
    items = []
    for f in frames:
        items.extend(frame_vars(f).items())
    top = frames[0]
    extra = global_vars(top)
    items.extend(extra.items())
    targets = Targets(items)
    own = frame_vars(top)
    vars_ = {name: enc(val, targets) for name, val in own.items()}
    for name, val in extra.items():
        if name not in vars_:
            vars_[name] = enc(val, targets)
    drain_heap(targets)
    types = {name: type_name(val.type) for name, val in own.items()}
    return vars_, types, dict(heap), targets


def out_size():
    try:
        return os.path.getsize(".prog.out")
    except OSError:
        return 0


class Ret(gdb.FinishBreakpoint):
    def __init__(self, frame, key):
        super().__init__(frame, internal=True)
        self.key = key

    def stop(self):
        try:
            rv = self.return_value
            retvals[self.key] = None if rv is None else enc(rv, Targets([]))
        except (gdb.error, RuntimeError):
            retvals[self.key] = None
        return False

    def out_of_scope(self):
        retvals[self.key] = None


def record_events(frames, vars_, types):
    global stack
    names = [fn_name(f, i, len(frames)) for i, f in enumerate(frames)]
    while len(stack) > len(frames):
        gone = stack.pop()
        key = len(stack) + 1
        if len(events) < MAX_EVENTS:
            events.append({"e": "ret", "fn": gone, "q": gone, "d": len(stack), "value": retvals.pop((key, gone), None), "vars": vars_, "at": len(steps)})
    while len(stack) < len(frames):
        idx = len(frames) - 1 - len(stack)
        stack.append(names[idx])
        frame = frames[idx]
        own = frame_vars(frame)
        targets = Targets(own.items())
        caller = frames[idx + 1] if idx + 1 < len(frames) else None
        if len(events) < MAX_EVENTS:
            saved = (dict(heap), list(pending))
            enc_vars = {n: enc(v, targets) for n, v in own.items()}
            heap.clear()
            heap.update(saved[0])
            pending[:] = saved[1]
            events.append({
                "e": "call", "fn": names[idx], "q": names[idx],
                "caller": {"fn": names[idx + 1], "line": caller.find_sal().line} if caller else None,
                "line": frame.find_sal().line, "d": len(stack) - 1, "vars": enc_vars, "at": len(steps),
                "types": {n: {"t": type_name(v.type), "b": v.type.sizeof} for n, v in own.items()},
            })
        if idx > 0 or len(stack) > 1:
            try:
                Ret(frame, (len(stack), names[idx]))
            except (gdb.error, ValueError, RuntimeError):
                pass


def alive():
    try:
        return gdb.selected_inferior().pid != 0
    except gdb.error:
        return False


crash = []
step_error = ""
SIGNALS = {"SIGSEGV": "Segmentation fault (SIGSEGV)", "SIGFPE": "Arithmetic exception (SIGFPE)",
           "SIGABRT": "Aborted (SIGABRT)", "SIGILL": "Illegal instruction (SIGILL)", "SIGBUS": "Bus error (SIGBUS)"}


def on_stop(event):
    if isinstance(event, gdb.SignalEvent) and event.stop_signal not in ("SIGINT", "SIGTRAP"):
        crash.append(SIGNALS.get(event.stop_signal, event.stop_signal))


gdb.events.stop.connect(on_stop)


def finish(partial=False):
    prog = ""
    try:
        with open(".prog.out", encoding="utf-8", errors="replace") as f:
            prog = f.read(65536)
    except OSError:
        pass
    data = {"steps": steps, "events": events, "stdout": prog, "cut": cut or ("time" if partial else None)}
    if step_error and cut == "stepping":
        data["note"] = step_error[:160]
    if crash:
        data["error"] = crash[0]
    with open(".trace.json", "w", encoding="utf-8") as f:
        json.dump(data, f)


try:
    gdb.execute("tbreak " + os.environ.get("EIDE_BREAK", "main"))
    gdb.execute("run > .prog.out")
    if os.environ.get("EIDE_BREAK", "main") == "main":
        try:
            gdb.execute("call (int)setvbuf(*(void**)&stdout, (void*)0, 2, 0)", to_string=True)
        except gdb.error:
            pass
    while alive() and len(steps) < MAX_STEPS:
        frames = user_frames()
        if frames and not is_user(gdb.newest_frame()):
            try:
                gdb.execute("finish", to_string=True)
            except gdb.error:
                gdb.execute("step", to_string=True)
            continue
        if not frames:
            try:
                gdb.execute("finish", to_string=True)
            except gdb.error:
                gdb.execute("step", to_string=True)
            continue
        vars_, types, heap_now, _ = snap(frames)
        record_events(frames, vars_, types)
        sal = frames[0].find_sal()
        step = {"line": sal.line, "fn": fn_name(frames[0], 0, len(frames)), "d": len(frames) - 1, "vars": vars_, "out": out_size(), "ty": types}
        if heap_now:
            step["heap"] = heap_now
        steps.append(step)
        if len(steps) <= 25 or len(steps) % 25 == 0:
            finish(partial=True)
        if crash:
            break
        if time.perf_counter() - started > BUDGET:
            cut = "time"
            break
        moved = False
        for motion in ("step", "next", "finish", "stepi"):
            try:
                gdb.execute(motion, to_string=True)
                moved = True
                break
            except gdb.error as err:
                step_error = str(err)
        if not moved:
            if alive():
                cut = "stepping"
            break
        if crash:
            frames = user_frames()
            if frames:
                vars_, types, heap_now, _ = snap(frames)
                last = {"line": frames[0].find_sal().line, "fn": fn_name(frames[0], 0, len(frames)), "d": len(frames) - 1,
                        "vars": vars_, "out": out_size(), "ty": types}
                if heap_now:
                    last["heap"] = heap_now
                steps.append(last)
            break
    if os.environ.get("EIDE_TRACE_DEBUG"):
        sys.stderr.write(f"trace end: alive={alive()} steps={len(steps)} cut={cut} err={step_error}\n")
    if alive() and len(steps) >= MAX_STEPS:
        cut = "steps"
    while stack:
        gone = stack.pop()
        if len(events) < MAX_EVENTS:
            events.append({"e": "ret", "fn": gone, "q": gone, "d": len(stack), "value": None, "vars": steps[-1]["vars"] if steps else {}, "at": len(steps)})
except BaseException:
    import traceback

    traceback.print_exc()
finally:
    finish()
    try:
        gdb.execute("kill")
    except gdb.error:
        pass
    gdb.execute("quit")
