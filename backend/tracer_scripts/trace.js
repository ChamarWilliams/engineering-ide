const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const inspector = require('inspector');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const MAX_STEPS = 1500;
const MAX_ITEMS = 40;
const MAX_OUT = 65536;
const MAX_EVENTS = 4000;
const BUDGET_MS = 3500;

if (isMainThread) {
  const file = path.resolve(process.argv[2]);
  const flag = new Int32Array(new SharedArrayBuffer(8));
  const worker = new Worker(__filename, { workerData: { file, flag } });
  Atomics.wait(flag, 0, 0, 4000);

  const out = [];
  let outLen = 0;
  const grab = (chunk) => {
    const s = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    if (outLen < MAX_OUT) out.push(s.slice(0, MAX_OUT - outLen));
    outLen += s.length;
    Atomics.store(flag, 1, Math.min(outLen, MAX_OUT));
    return true;
  };
  process.stdout.write = grab;
  process.stderr.write = (chunk) => { fs.writeSync(2, String(chunk)); return true; };

  let source = fs.readFileSync(file, 'utf8');
  let status = 0;
  if (file.endsWith('.ts') && typeof Module.stripTypeScriptTypes === 'function') {
    try { source = Module.stripTypeScriptTypes(source, { mode: 'strip' }); } catch (err) { fs.writeSync(2, String(err.message) + '\n'); }
  }
  try {
    const wrapper = new vm.Script(Module.wrap('debugger;' + source), { filename: file });
    const fn = wrapper.runInThisContext();
    const mod = { exports: {} };
    fn.call(mod.exports, mod.exports, require, mod, file, path.dirname(file));
  } catch (err) {
    status = 1;
    fs.writeSync(2, (err && err.stack ? err.stack : String(err)) + '\n');
  }
  worker.postMessage({ done: true, stdout: out.join('') });
  worker.on('exit', () => process.exit(status));
  setTimeout(() => process.exit(status), 3000);
} else {
  const { file, flag } = workerData;
  const session = new inspector.Session();
  session.connectToMainThread();
  const post = (method, params) => new Promise((resolve, reject) => {
    session.post(method, params || {}, (err, res) => (err ? reject(err) : resolve(res)));
  });

  const steps = [];
  const events = [];
  let cut = null;
  let finished = false;
  let stdoutText = '';
  const stack = [];
  const returns = new Map();
  const lastVars = new Map();
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let seenFirst = false;
  const userScripts = new Set();
  const started = Date.now();
  const SKIP_NAMES = new Set(['exports', 'require', 'module', '__filename', '__dirname']);

  session.on('Debugger.scriptParsed', (m) => {
    const url = m.params.url || '';
    if (url === file || url === require('url').pathToFileURL(file).href) userScripts.add(m.params.scriptId);
  });

  const save = () => {
    if (finished) return;
    finished = true;
    fs.writeFileSync('.trace.json', JSON.stringify({ steps, events, stdout: stdoutText, cut }));
  };

  async function enc(value, depth) {
    if (!value) return null;
    const t = value.type;
    if (t === 'undefined') return { r: 'undefined' };
    if (t === 'number') {
      if (value.value === undefined) return { r: value.unserializableValue || String(value.description) };
      return Number.isFinite(value.value) ? value.value : { r: String(value.value) };
    }
    if (t === 'boolean') return value.value;
    if (t === 'string') return { s: String(value.value).slice(0, 60) };
    if (t === 'bigint') return { r: value.description };
    if (t === 'function' || t === 'symbol') return null;
    if (value.subtype === 'null') return null;
    if (!value.objectId || depth >= 2) return { r: String(value.description || value.className || t).slice(0, 60) };
    if (value.subtype === 'array' || /^(Uint|Int|Float)\d+Array$/.test(value.className || '')) {
      const props = await post('Runtime.getProperties', { objectId: value.objectId, ownProperties: true });
      const items = props.result.filter((p) => /^\d+$/.test(p.name)).slice(0, MAX_ITEMS);
      const lenProp = props.result.find((p) => p.name === 'length');
      const l = [];
      for (const p of items) l.push(await enc(p.value, depth + 1));
      return { l, n: lenProp && lenProp.value ? lenProp.value.value : l.length, k: 'list' };
    }
    if (value.subtype === 'map' || value.subtype === 'set') {
      return { r: String(value.description).slice(0, 60) };
    }
    const props = await post('Runtime.getProperties', { objectId: value.objectId, ownProperties: true });
    const entries = props.result.filter((p) => p.enumerable && p.value && p.value.type !== 'function' && !p.symbol);
    const d = [];
    for (const p of entries.slice(0, MAX_ITEMS)) d.push([p.name, await enc(p.value, depth + 1)]);
    const cls = value.className && value.className !== 'Object' ? value.className : null;
    return { d, n: entries.length, ...(cls ? { k: cls } : {}) };
  }

  async function snap(frame) {
    const vars = {};
    for (const scope of frame.scopeChain) {
      if (scope.type !== 'local' && scope.type !== 'block') continue;
      const props = await post('Runtime.getProperties', { objectId: scope.object.objectId, ownProperties: true });
      for (const p of props.result) {
        if (SKIP_NAMES.has(p.name) || !p.value || p.name in vars) continue;
        if (p.value.type === 'function' || p.value.type === 'symbol') continue;
        if (p.value.type === 'undefined' && p.value.description === undefined) continue;
        vars[p.name] = await enc(p.value, 0);
      }
    }
    return vars;
  }

  const nameOf = (frames, i) => (i === frames.length - 1 ? '<module>' : frames[i].functionName || 'anonymous');

  function typeInfo(vars) {
    const types = {};
    for (const [k, v] of Object.entries(vars)) {
      const t = v === null ? 'null' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : v.s !== undefined ? 'string' : v.l ? 'Array' : v.k || 'Object';
      types[k] = { t };
      if (v && v.n !== undefined) types[k].n = v.n;
    }
    return types;
  }

  async function onPaused(params) {
    try {
      const all = params.callFrames;
      const frames = all.filter((f) => userScripts.has(f.location.scriptId));
      if (!frames.length || !userScripts.has(all[0].location.scriptId)) {
        await post('Debugger.stepOut').catch(() => post('Debugger.resume'));
        return;
      }
      const top = all[0];
      if (!seenFirst) {
        seenFirst = true;
        await post('Debugger.stepInto');
        return;
      }
      const names = frames.map((_, i) => nameOf(frames, i));
      const line = top.location.lineNumber + 1;
      const vars = await snap(top);

      while (stack.length > frames.length) {
        const gone = stack.pop();
        const sent = returns.get(stack.length + 1);
        returns.delete(stack.length + 1);
        if (events.length < MAX_EVENTS) {
          events.push({ e: 'ret', fn: gone, q: gone, d: stack.length, value: sent === undefined ? null : sent, vars: lastVars.get(stack.length + 1) || vars, at: steps.length });
        }
      }
      const ret = /\breturn\b\s*([^;}]*)/.exec(lines[line - 1] || '');
      if (!ret) returns.delete(frames.length);
      else {
        let value = null;
        if (ret[1]) {
          try {
            const res = await post('Debugger.evaluateOnCallFrame', { callFrameId: top.callFrameId, expression: ret[1], throwOnSideEffect: true });
            if (!res.exceptionDetails) value = await enc(res.result, 0);
          } catch (err) { value = null; }
        }
        returns.set(frames.length, value);
      }
      lastVars.set(frames.length, vars);
      while (stack.length < frames.length) {
        const idx = frames.length - 1 - stack.length;
        stack.push(names[idx]);
        if (events.length < MAX_EVENTS) {
          const callerFrame = frames[idx + 1];
          const own = idx === 0 ? vars : {};
          events.push({
            e: 'call', fn: names[idx], q: names[idx],
            caller: callerFrame ? { fn: names[idx + 1], line: callerFrame.location.lineNumber + 1 } : null,
            line: frames[idx].location.lineNumber + 1, d: stack.length - 1, vars: own, at: steps.length, types: typeInfo(own),
          });
        }
      }

      steps.push({ line, fn: names[0], d: frames.length - 1, vars, out: Atomics.load(flag, 1) });
      if (steps.length >= MAX_STEPS) cut = 'steps';
      else if (Date.now() - started > BUDGET_MS) cut = 'time';
      if (cut) {
        save();
        await post('Debugger.evaluateOnCallFrame', { callFrameId: top.callFrameId, expression: 'process.reallyExit(0)' }).catch(() => {});
        return;
      }
      await post('Debugger.stepInto');
    } catch (err) {
      save();
      await post('Debugger.resume').catch(() => {});
    }
  }

  session.on('Debugger.paused', (m) => { onPaused(m.params); });
  parentPort.on('message', (msg) => {
    if (!msg.done) return;
    stdoutText = msg.stdout;
    while (stack.length) {
      const gone = stack.pop();
      if (events.length < MAX_EVENTS) {
        events.push({ e: 'ret', fn: gone, q: gone, d: stack.length, value: null, vars: steps.length ? steps[steps.length - 1].vars : {}, at: steps.length });
      }
    }
    save();
    process.exit(0);
  });

  (async () => {
    await post('Debugger.enable');
    await post('Debugger.setBlackboxPatterns', { patterns: ['^node:.*', '.*node_modules.*'] }).catch(() => {});
    await post('Runtime.enable');
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
  })();
}
