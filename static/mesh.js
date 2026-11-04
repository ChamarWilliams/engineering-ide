const Mesh = (() => {
  const W = 320;
  const HEAD = 34;
  const LINE = 19;
  const MAX_BODY = 250;
  const SINK = '@stdout';
  const MIN_FIT = 0.62;
  const SPEEDS = [0.5, 1, 2, 4];
  const BASE_MS = 460;
  const NS = 'http://www.w3.org/2000/svg';
  const EXAMPLES = {
    python: `def main():
    numbers = [10, 20, 30, 40, 50]
    total = 0
    print("Entered def main() from script window")

    # Loop calculating cumulative sum
    for num in numbers:
        total += num
        print(f"Inside loop: num = {num}, running total = {total}")

    print("Exiting loop inside def main()")
    return total

print("Script started in main window")
result = main()
print(f"Back in main window! Final result = {result}")
`,
    c: `#include <stdio.h>

static void swap(int *a, int i, int j) {
    int t = a[i];
    a[i] = a[j];
    a[j] = t;
}

static int partition(int *a, int lo, int hi) {
    int pivot = a[hi];
    int i = lo - 1;
    for (int j = lo; j < hi; j++) {
        if (a[j] <= pivot) {
            i++;
            swap(a, i, j);
        }
    }
    swap(a, i + 1, hi);
    return i + 1;
}

static void quicksort(int *a, int lo, int hi) {
    if (lo < hi) {
        int p = partition(a, lo, hi);
        quicksort(a, lo, p - 1);
        quicksort(a, p + 1, hi);
    }
}

int main(void) {
    int data[] = {38, 27, 43, 10, 3, 9};
    quicksort(data, 0, 5);
    for (int i = 0; i < 6; i++) printf("%d ", data[i]);
    printf("\\n");
    return 0;
}
`,
    cpp: `#include <iostream>
#include <utility>
#include <vector>

void swap_at(std::vector<int>& a, int i, int j) {
    std::swap(a[i], a[j]);
}

int partition(std::vector<int>& a, int lo, int hi) {
    int pivot = a[hi];
    int i = lo - 1;
    for (int j = lo; j < hi; ++j) {
        if (a[j] <= pivot) swap_at(a, ++i, j);
    }
    swap_at(a, i + 1, hi);
    return i + 1;
}

void quicksort(std::vector<int>& a, int lo, int hi) {
    if (lo < hi) {
        int p = partition(a, lo, hi);
        quicksort(a, lo, p - 1);
        quicksort(a, p + 1, hi);
    }
}

int main() {
    std::vector<int> data{38, 27, 43, 10, 3, 9};
    quicksort(data, 0, 5);
    for (int v : data) std::cout << v << ' ';
    std::cout << '\\n';
}
`,
    lua: `local function swap(a, i, j)
  a[i], a[j] = a[j], a[i]
end

local function partition(a, lo, hi)
  local pivot = a[hi]
  local i = lo - 1
  for j = lo, hi - 1 do
    if a[j] <= pivot then
      i = i + 1
      swap(a, i, j)
    end
  end
  swap(a, i + 1, hi)
  return i + 1
end

local function quicksort(a, lo, hi)
  if lo < hi then
    local p = partition(a, lo, hi)
    quicksort(a, lo, p - 1)
    quicksort(a, p + 1, hi)
  end
end

local data = {38, 27, 43, 10, 3, 9}
quicksort(data, 1, #data)
print(table.concat(data, " "))
`,
  };
  const STUBS = {
    python: (n) => `def ${n}():\n    pass`,
    c: (n) => `void ${n}(void) {\n}`,
    cpp: (n) => `void ${n}() {\n}`,
    lua: (n) => `local function ${n}()\nend`,
    javascript: (n) => `function ${n}() {\n}`,
    typescript: (n) => `function ${n}(): void {\n}`,
    java: (n) => `static void ${n}() {\n}`,
    go: (n) => `func ${n}() {\n}`,
    rust: (n) => `fn ${n}() {\n}`,
    shell: (n) => `${n}() {\n  :\n}`,
  };

  let deps = null;
  let root = null;
  let ui = {};
  let visible = false;
  let stale = true;
  let graph = null;
  let error = null;
  let pos = {};
  let view = { x: 40, y: 40, k: 1 };
  let fitPending = true;
  let selected = null;
  let editing = null;
  let cellEditor = null;
  let selfEdit = false;
  let seq = 0;
  let analyzeTimer = null;
  let commitTimer = null;
  let touchTimer = null;
  let frame = 0;
  let drag = null;
  let speed = 1;
  let play = null;
  const cells = new Map();
  const wires = new Map();
  const stats = new Map();
  const colorCache = new Map();
  const locked = new Set();
  const guideEls = [];
  let bookmarks = {};
  let clickTimer = null;
  let glideTimer = null;
  let meshVizEnabled = true;
  const LOCK_ON = 'M4 7.5h8v6H4zM5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2';
  const LOCK_OFF = 'M4 7.5h8v6H4zM5.5 7.5V5.5a2.5 2.5 0 0 1 4.8-1';

  const make = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat());
    return n;
  };
  const svg = (tag, attrs = {}) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const icon = (d) => {
    const s = svg('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'currentColor' });
    s.append(svg('path', { d }));
    return s;
  };
  const short = (name) => name.split(/[.:]/).pop();
  const lang = () => deps.language();
  const TRACEABLE = new Set(['python', 'javascript', 'typescript', 'lua', 'shell', 'c', 'cpp', 'rust', 'go', 'java']);

  function build() {
    const button = (cls, label, glyph, title) => make('button', { type: 'button', className: `mesh-btn ${cls}`, title }, glyph ? icon(glyph) : '', label);
    ui = {
      run: button('primary', 'Execute', 'M4 2.5v11l9-5.5z', 'Run the program and replay it on the mesh'),
      step: button('', 'Step', 'M3 2.5v11l7-5.5zM11 2.5h2v11h-2z', 'Advance one call or return'),
      pause: button('', 'Pause', 'M4 2.5h3v11H4zM9 2.5h3v11H9z', 'Pause the replay'),
      reset: button('', 'Reset', 'M8 2.5a5.5 5.5 0 1 0 5.2 3.7l-1.5.5A4 4 0 1 1 8 4v2.2l3.5-3L8 0z', 'Clear the replay'),
      speed: make('div', { className: 'mesh-seg', role: 'group', ariaLabel: 'Replay speed' }),
      viz: button(meshVizEnabled ? 'active' : '', 'Loop Visualizer', 'M3.5 13V8.5M6.5 13V4M9.5 13V7M12.5 13V2.5', 'Step into functions and visualize loops in the Visualizer window'),
      undo: button('', 'Undo', '', 'Undo the last change (Ctrl+Z)'),
      redo: button('', 'Redo', '', 'Redo (Ctrl+Shift+Z)'),
      fit: button('', 'Fit', '', 'Fit all cells in view'),
      layout: button('', 'Auto layout', '', 'Arrange cells by call depth'),
      add: button('', 'New cell', '', 'Add a function'),
      exporter: button('', 'Export', '', 'Save the canvas as a PNG or SVG image'),
      status: make('span', { className: 'mesh-status' }),
      view: make('div', { className: 'mesh-view' }),
      world: make('div', { className: 'mesh-world' }),
      wires: svg('svg', { class: 'mesh-wires', width: 1, height: 1 }),
      badge: make('div', { className: 'mesh-badge', hidden: true }),
      empty: make('div', { className: 'mesh-empty', hidden: true }),
      float: make('div', { className: 'mesh-float', hidden: true }),
      floatTitle: make('strong'),
      floatSig: make('span', { className: 'cell-sig' }),
      floatBody: make('div', { className: 'float-body' }),
      menu: make('div', { className: 'mesh-menu', role: 'menu', hidden: true }),
    };
    const close = make('button', { type: 'button', className: 'float-close', title: 'Close (Esc)', textContent: '×' });
    close.addEventListener('click', endEdit);
    ui.float.append(make('div', { className: 'float-panel', role: 'dialog', ariaLabel: 'Edit cell' },
      make('div', { className: 'float-head' }, ui.floatTitle, ui.floatSig, close), ui.floatBody));
    ui.float.addEventListener('pointerdown', (e) => { if (e.target === ui.float) endEdit(); });
    for (const s of SPEEDS) {
      const b = make('button', { type: 'button', textContent: `${s}x` });
      b.dataset.speed = s;
      b.setAttribute('aria-pressed', String(s === speed));
      b.addEventListener('click', () => setSpeed(s));
      ui.speed.append(b);
    }
    ui.world.append(ui.wires);
    ui.view.append(ui.world, ui.badge, ui.empty, ui.float, ui.menu);
    ui.menu.addEventListener('keydown', (e) => {
      const items = [...ui.menu.querySelectorAll('button')];
      const at = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length].focus(); }
      if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); }
    });
    document.addEventListener('pointerdown', (e) => { if (!ui.menu.hidden && !ui.menu.contains(e.target)) closeMenu(); }, true);
    ui.empty.append(
      make('strong', { textContent: 'Nothing to map yet' }),
      make('span', { textContent: 'Each function becomes a cell, and every call between them becomes a wire.' }),
    );
    const example = make('button', { type: 'button', className: 'mesh-btn primary', textContent: 'Load example' });
    example.addEventListener('click', () => commitCode(EXAMPLES[lang()] ?? FILE_TYPES[lang()]?.template ?? EXAMPLES.python, true));
    ui.empty.append(example);
    const bar = make('div', { className: 'mesh-bar' },
      ui.run, ui.step, ui.pause, ui.reset, ui.speed, make('span', { className: 'mesh-sep' }),
      ui.viz, make('span', { className: 'mesh-sep' }),
      ui.undo, ui.redo, ui.fit, ui.layout, ui.add, ui.exporter, ui.status);
    root.append(bar, ui.view);

    ui.run.addEventListener('click', execute);
    ui.step.addEventListener('click', () => stepOnce());
    ui.pause.addEventListener('click', pause);
    ui.reset.addEventListener('click', reset);
    ui.viz.addEventListener('click', () => {
      meshVizEnabled = !meshVizEnabled;
      ui.viz.classList.toggle('active', meshVizEnabled);
      if (meshVizEnabled && typeof Workspace !== 'undefined') {
        Workspace.show('viz', true);
      }
      deps.toast?.(`Loop Visualizer inspection ${meshVizEnabled ? 'enabled' : 'disabled'}`);
    });
    ui.undo.addEventListener('click', () => { endEdit(); deps.history('undo'); });
    ui.redo.addEventListener('click', () => { endEdit(); deps.history('redo'); });
    ui.fit.addEventListener('click', () => fit(true));
    ui.layout.addEventListener('click', () => autoLayout(true));
    ui.add.addEventListener('click', addCell);
    ui.exporter.addEventListener('click', (e) => showMenu(e, [
      { label: 'PNG image', run: exportPng },
      { label: 'SVG vector', run: exportSvg },
    ]));
    bindViewport();
    syncControls();
  }

  function bindViewport() {
    ui.view.addEventListener('pointerdown', (e) => {
      if (e.target !== ui.view && e.target !== ui.world && e.target !== ui.wires) return;
      select(null);
      endEdit();
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      ui.view.setPointerCapture(e.pointerId);
      ui.view.classList.add('panning');
    });
    ui.view.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (drag.kind === 'pan') {
        view.x = drag.vx + e.clientX - drag.sx;
        view.y = drag.vy + e.clientY - drag.sy;
        applyView();
      } else if (drag.kind === 'rewire') {
        moveRewire(e);
      } else {
        const dx = (e.clientX - drag.sx) / view.k;
        const dy = (e.clientY - drag.sy) / view.k;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (locked.has(drag.id)) return;
        const at = snapDrag(drag.id, drag.ox + dx, drag.oy + dy, e.altKey);
        drag.snapped = at.hit;
        pos[drag.id] = { x: at.x, y: at.y };
        placeCell(drag.id);
        scheduleWires();
      }
    });
    const release = () => {
      if (!drag) return;
      if (drag.kind === 'rewire') {
        const done = drag;
        drag = null;
        finishRewire(done);
        return;
      }
      if (drag.kind === 'cell') {
        const step = Prefs.get('fineGrid') ? 4 : 8;
        const p = pos[drag.id];
        if (!locked.has(drag.id) && !drag.snapped) pos[drag.id] = { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
        showGuides();
        placeCell(drag.id);
        scheduleWires();
        cells.get(drag.id)?.el.classList.remove('dragging');
        if (!drag.moved) { const id = drag.id; drag = null; clearTimeout(clickTimer); clickTimer = setTimeout(() => beginEdit(id), 260); }
      }
      ui.view.classList.remove('panning');
      drag = null;
      touch();
    };
    ui.view.addEventListener('pointerup', release);
    ui.view.addEventListener('pointercancel', release);
    ui.view.addEventListener('wheel', (e) => {
      if (e.target.closest('.cell-editor, .cell-code')) {
        const body = e.target.closest('.cell-code');
        if (!e.ctrlKey && !e.metaKey && (!body || body.scrollHeight > body.clientHeight)) return;
      }
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = ui.view.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const k = Math.min(Math.max(view.k * Math.exp(-e.deltaY * 0.0018), 0.25), 1.6);
        view.x = mx - ((mx - view.x) / view.k) * k;
        view.y = my - ((my - view.y) / view.k) * k;
        view.k = k;
      } else {
        view.x -= e.deltaX;
        view.y -= e.deltaY;
      }
      applyView();
      touch();
    }, { passive: false });
    new ResizeObserver(() => { if (visible && fitPending) fit(false); }).observe(ui.view);
  }

  function applyView() {
    ui.world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    ui.view.style.backgroundPosition = `${view.x}px ${view.y}px`;
    ui.view.style.backgroundSize = `${24 * view.k}px ${24 * view.k}px`;
  }

  function touch() {
    clearTimeout(touchTimer);
    touchTimer = setTimeout(() => { if (graph?.nodes.length) deps.touch(); }, 600);
  }

  function setSpeed(s) {
    speed = s;
    for (const b of ui.speed.children) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s));
  }

  function syncControls() {
    const busy = Boolean(play?.fetching);
    const running = Boolean(play?.timer);
    ui.run.disabled = busy || running || !graph?.nodes.length;
    ui.run.lastChild.textContent = play?.units && play.i > 0 && play.i < play.units.length && !running ? 'Resume' : 'Execute';
    ui.step.disabled = busy || running || !graph?.nodes.length;
    ui.pause.disabled = !running;
    ui.reset.disabled = !play;
    ui.status.textContent = statusText();
    ui.status.classList.toggle('bad', Boolean(error));
  }

  function statusText() {
    if (play?.fetching) return 'Running…';
    if (play?.units) {
      const where = `${Math.min(play.i, play.units.length)} / ${play.units.length}`;
      return `${play.note ? `${play.note} · ` : ''}${where}`;
    }
    if (error) return `Syntax error: ${error} · showing last valid map`;
    if (!graph?.nodes.length) return '';
    return `${graph.nodes.length} cells · ${graph.edges.length} calls · scroll to pan, Ctrl+scroll to zoom`;
  }

  async function analyze() {
    if (!deps) return;
    const mine = ++seq;
    let result;
    try {
      result = await deps.api('POST', '/api/graph', { language: lang(), code: deps.code(), id: deps.sessionId() });
    } catch (err) {
      if (mine === seq) { error = err.message; syncControls(); }
      return;
    }
    if (mine !== seq) return;
    stale = false;
    if (result.error) {
      error = result.error;
      if (!graph) graph = { nodes: [], edges: [], entry: null, order: [], tail: [] };
      syncControls();
      return;
    }
    error = null;
    adopt(result);
  }

  function adopt(next) {
    if (graph) {
      const prev = graph.nodes;
      const ids = new Set(next.nodes.map((n) => n.id));
      const old = new Set(prev.map((n) => n.id));
      if (prev.length === next.nodes.length) {
        next.nodes.forEach((n, i) => {
          const was = prev[i].id;
          if (was !== n.id && !ids.has(was) && !old.has(n.id)) renameNode(was, n.id);
        });
      }
    }
    if (editing) {
      const mine = next.nodes.find((n) => n.id === editing);
      if (mine && cellEditor) mine.text = cellEditor.getValue();
    }
    next.externals ??= [];
    graph = next;
    if (next.nodes.length) {
      const fresh = next.nodes.filter((n) => !pos[n.id]);
      if (fresh.length === next.nodes.length) autoLayout(false);
      else for (const n of fresh) pos[n.id] = nearFree(n.id);
      for (const id of Object.keys(pos)) if (id !== SINK && !next.nodes.some((n) => n.id === id) && !extIds().includes(id)) delete pos[id];
      for (const id of extIds()) if (!pos[id]) pos[id] = extSlot(id);
    }
    render();
    if (fitPending && visible) fit(false);
  }

  function renameNode(from, to) {
    if (pos[from]) { pos[to] = pos[from]; delete pos[from]; }
    const cell = cells.get(from);
    if (cell) { cells.delete(from); cells.set(to, cell); cell.el.dataset.id = to; }
    if (editing === from) editing = to;
    if (selected === from) selected = to;
  }

  function nearFree(id) {
    const last = Object.values(pos).reduce((m, p) => ({ x: Math.max(m.x, p.x), y: Math.max(m.y, p.y) }), { x: 0, y: 0 });
    return { x: last.x, y: last.y + 220 };
  }

  function hasSink() {
    return Boolean(graph?.nodes.some((n) => n.prints));
  }

  const extIds = () => [...new Set(graph.externals.map((x) => x.id))];
  const extOf = (id) => graph.externals.find((x) => x.id === id);

  function extSlot(id) {
    const right = Math.max(...graph.nodes.map((n) => pos[n.id]?.x ?? 0));
    const used = extIds().filter((x) => pos[x]).length;
    return { x: right + W + 80, y: used * 150 };
  }

  function allEdges() {
    const list = graph.edges.map((e) => ({ ...e, key: `${e.from}>${e.to}` }));
    for (const x of graph.externals) list.push({ from: x.from, to: x.id, n: x.n, line: x.line, site: x.site, key: `${x.from}>${x.id}`, external: true });
    if (hasSink()) for (const n of graph.nodes) if (n.prints) list.push({ from: n.id, to: SINK, n: 1, line: n.start, site: 'writes to standard output', key: `${n.id}>${SINK}`, sink: true });
    return list;
  }

  function render() {
    ui.empty.hidden = Boolean(graph?.nodes.length);
    ui.world.hidden = !graph?.nodes.length;
    const live = new Set(graph.nodes.map((n) => n.id));
    if (hasSink()) live.add(SINK);
    for (const id of extIds()) live.add(id);
    for (const [id, cell] of cells) if (!live.has(id)) { cell.el.remove(); cells.delete(id); }
    for (const node of graph.nodes) paintCell(node);
    for (const id of extIds()) paintExternal(id);
    if (hasSink()) paintSink();
    drawWires(true);
    applyView();
    syncControls();
    afterRender();
  }

  function colorize(text) {
    const key = `${lang()}\0${text}`;
    if (colorCache.has(key)) return Promise.resolve(colorCache.get(key));
    return monaco.editor.colorize(text, lang(), { tabSize: 4 }).then((html) => {
      if (colorCache.size > 200) colorCache.clear();
      colorCache.set(key, html);
      return html;
    });
  }

  function bodyHeight(text) {
    return Math.min(text.split('\n').length * LINE + 14, MAX_BODY);
  }

  function ensureCell(id) {
    let cell = cells.get(id);
    if (cell) return cell;
    const el = make('div', { className: 'cell' });
    el.dataset.id = id;
    const head = make('div', { className: 'cell-head' });
    const pinIn = make('i', { className: 'pin in' });
    const pinOut = make('i', { className: 'pin out' });
    const title = make('span', { className: 'cell-title' });
    const sig = make('span', { className: 'cell-sig' });
    const tag = make('span', { className: 'cell-tag' });
    const edit = make('button', { type: 'button', className: 'cell-edit', title: 'Edit this cell' }, icon('M11.5 1.5l3 3-8.8 8.8-3.7.7.7-3.7zM10 3l3 3'));
    const lockPath = svg('path');
    const lockIcon = svg('svg', { viewBox: '0 0 16 16', width: 13, height: 13 });
    lockIcon.append(lockPath);
    const lock = make('button', { type: 'button', className: 'cell-lock' }, lockIcon);
    head.append(title, sig, tag, lock, edit);
    const body = make('div', { className: 'cell-code', tabIndex: 0 });
    const mem = make('div', { className: 'cell-mem', hidden: true });
    el.append(pinIn, pinOut, head, body, mem);
    ui.world.append(el);
    cell = { el, head, title, sig, tag, body, mem, lock, lockPath, text: null };
    cells.set(id, cell);
    el.classList.toggle('collapsed', collapsed.has(id));
    paintLock(id);
    lock.addEventListener('click', () => toggleLock(id));
    head.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      clearTimeout(clickTimer);
      endEdit();
      toggleCollapse(id);
    });
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.stopPropagation();
      select(id);
      const p = pos[id];
      drag = { kind: 'cell', id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y };
      el.classList.add('dragging');
      ui.view.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointerdown', (e) => { if (e.button === 0 && !e.target.closest('.cell-head')) { e.stopPropagation(); select(id); } });
    el.addEventListener('contextmenu', (e) => cellMenu(id, e));
    edit.addEventListener('click', () => beginEdit(id));
    body.addEventListener('click', () => beginEdit(id));
    body.addEventListener('keydown', (e) => { if (e.key === 'Enter') beginEdit(id); });
    return cell;
  }

  function paintCell(node) {
    const cell = ensureCell(node.id);
    cell.el.dataset.kind = node.kind;
    cell.el.classList.toggle('entry', node.id === graph.entry);
    cell.title.textContent = node.kind === 'function' ? short(node.name) : node.name;
    cell.sig.textContent = node.kind === 'function' ? node.sig : '';
    const tags = [node.id === graph.entry ? 'entry' : '', node.recursive ? '↻ recursive' : '', node.ret && node.ret !== 'void' ? `→ ${node.ret}` : ''].filter(Boolean);
    cell.tag.textContent = tags.join(' · ');
    if (editing !== node.id && cell.text !== node.text) {
      cell.text = node.text;
      cell.body.style.height = `${bodyHeight(node.text)}px`;
      colorize(node.text).then((html) => { if (cell.text === node.text && editing !== node.id) cell.body.innerHTML = html; });
    }
    placeCell(node.id);
  }

  function paintExternal(id) {
    const x = extOf(id);
    const cell = ensureCell(id);
    cell.el.dataset.kind = 'external';
    cell.title.textContent = x.name;
    cell.sig.textContent = x.sig;
    cell.tag.textContent = x.file;
    cell.el.querySelector('.cell-edit').hidden = true;
    const t = x.types;
    const lines = t
      ? [...t.params.map((p) => `${p.name}: ${p.type}  ${p.size ? `${p.size} B` : ''}`), `returns ${t.ret.type}  ${t.ret.size ? `${t.ret.size} B` : ''}`]
      : [x.ret ? `returns ${x.ret}` : `from ${x.file}`];
    cell.body.classList.add('sink-body');
    cell.body.style.height = '';
    cell.body.textContent = lines.join('\n');
    cell.text = '';
    placeCell(id);
  }

  function paintSink() {
    const cell = ensureCell(SINK);
    cell.el.dataset.kind = 'sink';
    cell.title.textContent = 'stdout';
    cell.sig.textContent = '';
    cell.tag.textContent = 'sink';
    cell.el.querySelector('.cell-edit').hidden = true;
    cell.body.classList.add('sink-body');
    cell.body.style.height = '';
    if (cell.text === null) { cell.text = ''; cell.body.textContent = ''; }
    if (!pos[SINK]) {
      const right = Math.max(...graph.nodes.map((n) => pos[n.id]?.x ?? 0));
      const first = graph.nodes.find((n) => n.prints);
      pos[SINK] = { x: right + W + 110, y: pos[first.id]?.y ?? 0 };
    }
    placeCell(SINK);
  }

  function placeCell(id) {
    const cell = cells.get(id);
    const p = pos[id];
    if (!cell || !p) return;
    cell.el.style.left = `${p.x}px`;
    cell.el.style.top = `${p.y}px`;
  }

  function pinPoint(id, side) {
    const p = pos[id];
    return { x: p.x + (side === 'out' ? W : 0), y: p.y + HEAD / 2 };
  }

  function wirePath(a, b) {
    const style = Prefs.get('wireStyle');
    if (style === 'straight') return `M${a.x},${a.y} L${b.x},${b.y}`;
    if (style === 'step') {
      const mx = a.x + Math.max(30, (b.x - a.x) / 2);
      return `M${a.x},${a.y} H${mx} V${b.y} H${b.x}`;
    }
    const dx = Math.max(70, Math.abs(b.x - a.x) * 0.5);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  }

  function drawWires(rebuild) {
    const list = allEdges().filter((e) => e.from !== e.to && pos[e.from] && pos[e.to]);
    if (rebuild) {
      const keys = new Set(list.map((e) => e.key));
      for (const [key, w] of wires) if (!keys.has(key)) { w.group.remove(); wires.delete(key); }
      for (const e of list) {
        if (wires.has(e.key)) { wires.get(e.key).edge = e; continue; }
        const group = svg('g', { class: `wire${e.sink ? ' sink' : ''}` });
        const path = svg('path', { class: 'wire-line' });
        const hit = svg('path', { class: 'wire-hit' });
        const end = svg('circle', { class: 'wire-end', r: 8 });
        group.append(path, hit, end);
        ui.wires.append(group);
        const w = { group, path, hit, end, edge: e };
        end.addEventListener('pointerdown', (ev) => { if (ev.button === 0) { ev.stopPropagation(); startRewire(w, ev); } });
        hit.addEventListener('pointerenter', (ev) => showBadge(w, ev));
        hit.addEventListener('pointermove', (ev) => moveBadge(ev));
        hit.addEventListener('pointerleave', () => { ui.badge.hidden = true; });
        wires.set(e.key, w);
      }
    }
    for (const e of list) {
      const w = wires.get(e.key);
      const d = wirePath(pinPoint(e.from, 'out'), pinPoint(e.to, 'in'));
      w.path.setAttribute('d', d);
      w.hit.setAttribute('d', d);
      const tip = pinPoint(e.to, 'in');
      w.end.setAttribute('cx', tip.x);
      w.end.setAttribute('cy', tip.y);
      w.end.classList.toggle('off', !(isFunction(e.from) && isFunction(e.to)));
    }
    paintFocus();
  }

  function scheduleWires() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; drawWires(false); });
  }

  function paintFocus() {
    const linked = new Set();
    if (selected) {
      linked.add(selected);
      for (const e of allEdges()) if (e.from === selected || e.to === selected) { linked.add(e.from); linked.add(e.to); }
    }
    ui.view.classList.toggle('focusing', Boolean(selected));
    for (const [id, cell] of cells) {
      cell.el.classList.toggle('selected', id === selected);
      cell.el.classList.toggle('related', linked.has(id));
    }
    for (const w of wires.values()) w.group.classList.toggle('related', Boolean(selected) && (w.edge.from === selected || w.edge.to === selected));
  }

  function select(id) {
    selected = id;
    paintFocus();
  }

  function fmt(v, depth = 0) {
    if (v === null) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    if (typeof v !== 'object') return String(v);
    if ('s' in v) return JSON.stringify(v.s);
    if ('r' in v) return v.r;
    if ('l' in v) {
      const items = v.l.map((x) => fmt(x, depth + 1)).join(', ');
      return `[${items}${v.n > v.l.length ? `, … ${v.n} items` : ''}]`;
    }
    if ('d' in v) return `{${v.d.map(([k, x]) => `${k}: ${fmt(x, depth + 1)}`).join(', ')}}`;
    return '?';
  }

  function showBadge(w, ev) {
    const e = w.edge;
    const label = (id) => (id === SINK ? 'stdout' : extOf(id) ? `${extOf(id).file}.${extOf(id).name}` : short(graph.nodes.find((n) => n.id === id)?.name ?? id));
    const from = label(e.from);
    const to = label(e.to);
    const rows = [make('div', { className: 'badge-title' }, make('strong', { textContent: from }), ' → ', make('strong', { textContent: to }))];
    rows.push(make('code', { className: 'badge-site', textContent: e.site }));
    rows.push(make('div', { className: 'badge-meta', textContent: e.sink ? `line ${e.line}` : `line ${e.line}${e.n > 1 ? ` · ${e.n} call sites` : ''}` }));
    rows.push(...typeRows(e));
    const s = stats.get(e.key);
    if (s) {
      rows.push(make('div', { className: 'badge-run' },
        make('span', { textContent: `${s.count} call${s.count === 1 ? '' : 's'}` }),
        s.args ? make('span', { textContent: `last args  ${s.args}` }) : '',
        s.ret !== undefined ? make('span', { textContent: `last return  ${s.ret}` }) : ''));
    }
    ui.badge.replaceChildren(...rows);
    ui.badge.hidden = false;
    moveBadge(ev);
  }

  const bytes = (n) => (n === null || n === undefined ? '' : ` · ${n} B`);

  function typeRows(e) {
    if (e.sink) return [];
    const callee = graph.nodes.find((n) => n.id === e.to) ?? extOf(e.to);
    const rows = [];
    if (callee?.types) {
      const t = callee.types;
      const line = (name, info) => `${name ? `${name}: ` : ''}${info.type} → ${info.label}${bytes(info.size)}`;
      if (t.params.length) rows.push(make('div', { className: 'badge-types' }, make('span', { className: 'badge-h', textContent: 'sends' }), ...t.params.map((p) => make('code', { textContent: line(p.name, p) }))));
      rows.push(make('div', { className: 'badge-types' }, make('span', { className: 'badge-h', textContent: 'returns' }), make('code', { textContent: line('', t.ret) })));
      rows.push(make('div', { className: 'badge-meta', textContent: 'sizes assume a 64-bit target' }));
      return rows;
    }
    const s = stats.get(e.key);
    if (s?.types) {
      const line = (name, k) => `${name ? `${name}: ` : ''}${k.t}${k.n !== undefined ? ` · ${k.n} item${k.n === 1 ? '' : 's'}` : ''}${bytes(k.b)}`;
      rows.push(make('div', { className: 'badge-types' }, make('span', { className: 'badge-h', textContent: 'sent (last call)' }), ...Object.entries(s.types).map(([k, v]) => make('code', { textContent: line(k, v) }))));
      if (s.rtype) rows.push(make('div', { className: 'badge-types' }, make('span', { className: 'badge-h', textContent: 'returned' }), make('code', { textContent: line('', s.rtype) })));
    } else if (callee) {
      rows.push(make('div', { className: 'badge-meta', textContent: 'Run the program to see the exact types and sizes' }));
    }
    return rows;
  }

  function moveBadge(ev) {
    const rect = ui.view.getBoundingClientRect();
    const x = Math.min(ev.clientX - rect.left + 14, rect.width - ui.badge.offsetWidth - 8);
    const y = Math.min(ev.clientY - rect.top + 14, rect.height - ui.badge.offsetHeight - 8);
    ui.badge.style.transform = `translate(${Math.max(x, 8)}px, ${Math.max(y, 8)}px)`;
  }

  function autoLayout(announce) {
    const depth = new Map();
    const start = graph.entry ?? graph.nodes[0]?.id;
    const queue = start ? [start] : [];
    if (start) depth.set(start, 0);
    while (queue.length) {
      const cur = queue.shift();
      for (const e of graph.edges) if (e.from === cur && !depth.has(e.to)) { depth.set(e.to, depth.get(cur) + 1); queue.push(e.to); }
    }
    for (const n of graph.nodes) if (!depth.has(n.id)) depth.set(n.id, 0);
    const columns = [];
    for (const n of graph.nodes) (columns[depth.get(n.id)] ??= []).push(n);
    const gapX = 80;
    columns.forEach((col, ci) => {
      if (!col) return;
      let y = 0;
      for (const n of col) {
        if (!locked.has(n.id) || !pos[n.id]) pos[n.id] = { x: ci * (W + gapX), y };
        y += HEAD + bodyHeight(n.text) + 64;
      }
    });
    const exts = extIds();
    exts.forEach((id, i) => { if (!locked.has(id) || !pos[id]) pos[id] = { x: columns.length * (W + gapX), y: i * 150 }; });
    if (hasSink() && !(locked.has(SINK) && pos[SINK])) {
      const first = graph.nodes.find((n) => n.prints);
      pos[SINK] = { x: (columns.length + (exts.length ? 1 : 0)) * (W + gapX), y: pos[first.id].y };
    }
    if (announce) {
      for (const id of cells.keys()) placeCell(id);
      drawWires(false);
      fit(true);
      touch();
    }
  }

  function fit(animate) {
    const ids = [...cells.keys()].filter((id) => pos[id]);
    if (!ids.length || !ui.view.clientWidth) return;
    fitPending = false;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const id of ids) {
      const c = cells.get(id).el;
      x1 = Math.min(x1, pos[id].x);
      y1 = Math.min(y1, pos[id].y);
      x2 = Math.max(x2, pos[id].x + W);
      y2 = Math.max(y2, pos[id].y + (c.offsetHeight || 200));
    }
    const pad = 48;
    const vw = ui.view.clientWidth;
    const vh = ui.view.clientHeight;
    const wanted = Math.min((vw - pad * 2) / (x2 - x1), (vh - pad * 2) / (y2 - y1));
    const k = Math.min(Math.max(wanted, MIN_FIT), 1);
    const cropped = wanted < MIN_FIT;
    view = {
      k,
      x: cropped ? pad - x1 * k : (vw - (x2 - x1) * k) / 2 - x1 * k,
      y: cropped ? pad - y1 * k : Math.max((vh - (y2 - y1) * k) / 2, pad / 2) - y1 * k,
    };
    ui.world.classList.toggle('smooth', animate);
    applyView();
    if (animate) setTimeout(() => ui.world.classList.remove('smooth'), 320);
    touch();
  }

  function assemble() {
    const lines = [];
    for (const n of graph.nodes) lines.push(...n.gap, ...n.text.split('\n'));
    lines.push(...graph.tail);
    return lines.join('\n');
  }

  function commitCode(code, reload = false) {
    selfEdit = true;
    try { deps.applyCode(code); } finally { selfEdit = false; }
    if (reload) { fitPending = true; pos = {}; graph = null; stale = true; }
    clearTimeout(analyzeTimer);
    analyzeTimer = setTimeout(analyze, reload ? 0 : 700);
  }

  function ensureCellEditor() {
    if (cellEditor) return cellEditor;
    const host = make('div', { className: 'cell-editor' });
    cellEditor = monaco.editor.create(host, {
      model: null, theme: `eide-${Themes.current()}`, automaticLayout: true, fontFamily: "'JetBrains Mono', Consolas, monospace",
      fontSize: Prefs.get('fontSize'), lineHeight: 22, tabSize: Prefs.get('tabSize'), insertSpaces: true, minimap: { enabled: false },
      lineNumbers: Prefs.get('lineNumbers') ? 'on' : 'off', wordWrap: Prefs.get('wordWrap') ? 'on' : 'off',
      renderWhitespace: Prefs.get('whitespace') ? 'all' : 'none', bracketPairColorization: { enabled: Prefs.get('bracketColors') },
      glyphMargin: false, folding: true, lineNumbersMinChars: 3, scrollBeyondLastLine: false, fontLigatures: Prefs.get('ligatures'),
      overviewRulerLanes: 0, renderLineHighlight: 'all', padding: { top: 10, bottom: 10 },
      scrollbar: { verticalScrollbarSize: 10, useShadows: false }, fixedOverflowWidgets: true,
    });
    cellEditor.host = host;
    Prefs.on((key) => {
      const opts = {
        fontSize: { fontSize: Prefs.get('fontSize') }, tabSize: { tabSize: Prefs.get('tabSize') }, ligatures: { fontLigatures: Prefs.get('ligatures') },
        wordWrap: { wordWrap: Prefs.get('wordWrap') ? 'on' : 'off' }, lineNumbers: { lineNumbers: Prefs.get('lineNumbers') ? 'on' : 'off' },
        whitespace: { renderWhitespace: Prefs.get('whitespace') ? 'all' : 'none' }, bracketColors: { bracketPairColorization: { enabled: Prefs.get('bracketColors') } },
      }[key];
      if (opts) cellEditor.updateOptions(opts);
    });
    cellEditor.onKeyDown((e) => { if (e.keyCode === monaco.KeyCode.Escape && !cellEditor.getContribution('editor.contrib.suggestController')?.model?.state) endEdit(); });
    return cellEditor;
  }

  function beginEdit(id) {
    if (id === SINK || id.startsWith('ext:') || editing === id) return;
    endEdit();
    const node = graph.nodes.find((n) => n.id === id);
    if (!node || !cells.get(id)) return;
    editing = id;
    const ed = ensureCellEditor();
    const model = monaco.editor.createModel(node.text, deps.monacoLanguage());
    ed.setModel(model);
    ui.floatTitle.textContent = node.kind === 'function' ? short(node.name) : node.name;
    ui.floatSig.textContent = node.kind === 'function' ? node.sig : '';
    ui.floatBody.replaceChildren(ed.host);
    ui.float.hidden = false;
    cells.get(id).el.classList.add('editing');
    model.onDidChangeContent(() => {
      const target = graph.nodes.find((n) => n.id === editing);
      if (!target) return;
      target.text = model.getValue();
      clearTimeout(commitTimer);
      commitTimer = setTimeout(() => commitCode(assemble()), 300);
    });
    requestAnimationFrame(() => { ed.layout(); ed.focus(); });
  }

  function endEdit() {
    if (!editing) return;
    const id = editing;
    editing = null;
    clearTimeout(commitTimer);
    ui.float.hidden = true;
    const model = cellEditor?.getModel();
    const text = model?.getValue();
    cellEditor?.setModel(null);
    model?.dispose();
    const cell = cells.get(id);
    const node = graph?.nodes.find((n) => n.id === id);
    if (cell) {
      cell.el.classList.remove('editing');
      cell.text = null;
      if (node && text !== undefined) { node.text = text; commitCode(assemble()); }
      if (node) paintCell(node);
    }
  }

  const collapsed = new Set();

  function closeMenu() {
    ui.menu.hidden = true;
    ui.menu.replaceChildren();
  }

  function showMenu(ev, items) {
    ev.preventDefault();
    ev.stopPropagation();
    ui.menu.replaceChildren(...items.map((item) => {
      if (item === '-') return make('div', { className: 'menu-sep', role: 'separator' });
      const b = make('button', { type: 'button', className: `menu-item${item.danger ? ' danger' : ''}`, role: 'menuitem' },
        make('span', { textContent: item.label }), item.hint ? make('kbd', { textContent: item.hint }) : '');
      b.addEventListener('click', () => { closeMenu(); item.run(); });
      return b;
    }));
    ui.menu.hidden = false;
    const rect = ui.view.getBoundingClientRect();
    const x = Math.min(ev.clientX - rect.left, rect.width - ui.menu.offsetWidth - 8);
    const y = Math.min(ev.clientY - rect.top, rect.height - ui.menu.offsetHeight - 8);
    ui.menu.style.transform = `translate(${Math.max(x, 8)}px, ${Math.max(y, 8)}px)`;
    ui.menu.querySelector('button')?.focus();
  }

  function cellMenu(id, ev) {
    select(id);
    const node = graph.nodes.find((n) => n.id === id);
    const ext = extOf(id);
    const copy = (text, what) => navigator.clipboard?.writeText(text).then(() => deps.toast(`Copied ${what}`), () => deps.toast('Copy is not available here'));
    const focus = { label: selected === id ? 'Highlight connections' : 'Highlight connections', run: () => select(id) };
    if (id === SINK) {
      showMenu(ev, [
        { label: 'Copy output', run: () => copy(cells.get(SINK).body.textContent, 'output') },
        { label: 'Clear output', run: () => { cells.get(SINK).body.textContent = ''; if (play) play.shown = 0; } },
      ]);
      return;
    }
    if (ext) {
      showMenu(ev, [
        { label: `Open ${ext.file} as flow`, run: () => deps.openFile(ext.file_id, 'flow') },
        { label: `Open ${ext.file} as text`, run: () => deps.openFile(ext.file_id, 'text') },
        '-',
        { label: 'Copy signature', run: () => copy(`${ext.name}${ext.sig}`, 'signature') },
        focus,
      ]);
      return;
    }
    if (!node) return;
    const isFn = node.kind === 'function';
    const isCollapsed = collapsed.has(id);
    const items = [
      { label: 'Edit code', hint: 'Click', run: () => beginEdit(id) },
      ...(isFn ? [{ label: 'Rename…', run: () => renameCell(id) }, { label: 'Duplicate', run: () => duplicateCell(id) }] : []),
      '-',
      { label: 'Copy code', run: () => copy(node.text, 'code') },
      ...(isFn ? [{ label: 'Copy name', run: () => copy(short(node.name), 'name') }] : []),
      '-',
      focus,
      { label: isCollapsed ? 'Expand' : 'Collapse', hint: 'Dbl-click', run: () => toggleCollapse(id) },
      { label: locked.has(id) ? 'Unlock position' : 'Lock position', run: () => toggleLock(id) },
      '-',
      { label: isFn ? 'Delete…' : 'Remove section…', hint: 'Del', danger: true, run: () => deleteCell(id) },
    ];
    showMenu(ev, items);
  }

  function toggleCollapse(id) {
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    cells.get(id)?.el.classList.toggle('collapsed', collapsed.has(id));
    touch();
  }

  function toggleLock(id) {
    if (locked.has(id)) locked.delete(id);
    else locked.add(id);
    paintLock(id);
    touch();
  }

  function paintLock(id) {
    const cell = cells.get(id);
    if (!cell) return;
    const on = locked.has(id);
    cell.el.classList.toggle('locked', on);
    cell.lock.title = on ? 'Unlock position' : 'Lock position';
    cell.lock.setAttribute('aria-pressed', String(on));
    cell.lockPath.setAttribute('d', on ? LOCK_ON : LOCK_OFF);
  }

  async function renameCell(id) {
    const node = graph.nodes.find((n) => n.id === id);
    const old = short(node.name);
    const next = await Modal.prompt({ title: 'Rename function', label: `New name for ${old}`, value: old, action: 'Rename' });
    if (!next || next === old) return;
    if (!/^[A-Za-z_]\w*$/.test(next)) { deps.toast('Names may use letters, digits and underscores, and cannot start with a digit'); return; }
    if (graph.nodes.some((n) => short(n.name) === next)) { deps.toast(`${next} already exists`); return; }
    const word = new RegExp(`\\b${old}\\b`, 'g');
    for (const n of graph.nodes) n.text = n.text.replace(word, next);
    commitCode(assemble());
    deps.refactor?.({ kind: 'symbol', old, to: next });
  }

  function duplicateCell(id) {
    const i = graph.nodes.findIndex((n) => n.id === id);
    const node = graph.nodes[i];
    const old = short(node.name);
    const taken = new Set(graph.nodes.map((n) => short(n.name)));
    let name = `${old}_copy`;
    for (let n = 2; taken.has(name); n++) name = `${old}_copy${n}`;
    const text = node.text.replace(new RegExp(`\\b${old}\\b`, 'g'), name);
    const gap = lang() === 'python' ? ['', ''] : [''];
    graph.nodes.splice(i + 1, 0, { ...node, id: name, name, text, gap, recursive: false, prints: node.prints });
    const p = pos[id];
    pos[name] = { x: p.x + 40, y: p.y + 40 };
    commitCode(assemble());
  }

  async function deleteCell(id) {
    const node = graph.nodes.find((n) => n.id === id);
    const callers = graph.edges.filter((e) => e.to === id).map((e) => e.from);
    const note = callers.length ? ` It is called from ${callers.join(', ')}, which will break.` : '';
    const isFn = node.kind === 'function';
    const what = isFn ? `function ${short(node.name)}` : `the ${node.name} section (lines ${node.start}-${node.end})`;
    if (!(await Modal.confirm({ title: isFn ? 'Delete function' : 'Remove section', message: `Remove ${what} from the file?${note}`, action: 'Remove' }))) return;
    graph.nodes = graph.nodes.filter((n) => n.id !== id);
    delete pos[id];
    commitCode(assemble());
  }

  function addCell() {
    if (!graph) return;
    endEdit();
    const taken = new Set(graph.nodes.map((n) => n.id));
    let n = 1;
    while (taken.has(`new_cell_${n}`)) n++;
    const name = `new_cell_${n}`;
    const stub = (STUBS[lang()] ?? STUBS.python)(name);
    const code = deps.code();
    const joiner = lang() === 'python' ? '\n\n\n' : '\n\n';
    commitCode(`${code.replace(/\s+$/, '')}${joiner}${stub}\n`);
    const rect = ui.view.getBoundingClientRect();
    pos[name] = { x: (rect.width / 2 - view.x) / view.k - W / 2, y: (rect.height / 2 - view.y) / view.k - 60 };
    pendingEdit = name;
  }

  let pendingEdit = null;

  function nodeFor(fn, units) {
    if (fn === '<module>') return units.module;
    return units.byName.get(fn) ?? null;
  }

  function prepare(trace) {
    const byName = new Map();
    for (const n of graph.nodes) if (n.kind === 'function') byName.set(short(n.name), n.id);
    const module = graph.nodes.find((n) => n.kind === 'entry')?.id
      ?? graph.nodes.find((n) => n.kind === 'script')?.id ?? graph.nodes.find((n) => n.kind === 'setup')?.id ?? null;
    const lookup = { byName, module };
    const stack = [];
    const units = [];
    const evs = trace.events ?? [];
    for (let k = 0; k < evs.length; k++) {
      const ev = evs[k];
      const id = nodeFor(ev.fn, lookup);
      if (!id) continue;
      const segEnd = evs[k + 1]?.at ?? trace.steps.length;
      const at = ev.at < trace.steps.length ? trace.steps[ev.at].out : trace.stdout.length;
      if (ev.e === 'call') {
        const from = ev.caller ? nodeFor(ev.caller.fn, lookup) : null;
        units.push({ t: 'call', id, fn: ev.fn, from, vars: ev.vars, types: ev.types, at, depth: ev.d, eventAt: ev.at, segEnd });
        stack.push({ id, from, fn: ev.fn, callerFn: ev.caller?.fn, callUnitIdx: units.length - 1 });
      } else {
        const top = stack.pop();
        if (top && units[top.callUnitIdx]) {
          units[top.callUnitIdx].retAt = ev.at;
        }
        units.push({ t: 'ret', id, fn: ev.fn, to: top?.from ?? null, value: ev.value, rtype: ev.rtype, vars: ev.vars, at, depth: ev.d, eventAt: ev.at, segEnd, callerFn: top?.callerFn });
      }
    }
    return { units, stdout: trace.stdout, i: 0, active: new Map(), shown: 0, note: '', timer: null, fetching: false, mode: 'run' };
  }

  function prepareStatic(result) {
    const units = [];
    const seen = new Set();
    const parent = new Map();
    for (const e of graph.edges) if (!parent.has(e.to) && e.from !== e.to) parent.set(e.to, e.from);
    for (const id of graph.order) {
      if (seen.has(id)) continue;
      seen.add(id);
      units.push({ t: 'call', id, from: parent.get(id) ?? null, vars: {}, at: 0, depth: 0 });
    }
    const stdout = result.steps?.map((s) => s.stdout ?? '').join('') ?? '';
    units.push({ t: 'out', at: stdout.length });
    return { units, stdout, i: 0, active: new Map(), shown: 0, note: 'call order (static)', timer: null, fetching: false };
  }

  async function load() {
    if (!graph?.nodes.length) return false;
    if (stale || error) await analyze();
    const token = {};
    clearReplay();
    play = { fetching: true, token, units: null, i: 0, active: new Map(), timer: null, shown: 0 };
    syncControls();
    const runId = deps.uid();
    play.runId = runId;
    try {
      let traced = null;
      if (TRACEABLE.has(lang())) {
        const r = await deps.api('POST', '/api/trace', { run_id: runId, language: lang(), code: deps.code(), runner: deps.runner() });
        if (play?.token !== token) return false;
        if (r.trace || lang() === 'python') {
          deps.output({ kind: 'trace', result: r });
          if (!r.trace) { play = null; toastErr(r); syncControls(); return false; }
          traced = r.trace;
        }
      }
      if (traced) {
        stats.clear();
        play = { ...prepare(traced), token, rawTrace: traced, mode: 'run' };
        play.note = traced.cut ? `trace cut (${traced.cut === 'stepping' ? 'debugger stopped' : `${traced.cut} limit`})` : '';
      } else {
        const r = await deps.api('POST', '/api/run', { run_id: runId, language: lang(), code: deps.code(), runner: deps.runner(), id: deps.sessionId() });
        if (play?.token !== token) return false;
        deps.output({ kind: 'run', result: r });
        if (r.error) { play = null; syncControls(); return false; }
        stats.clear();
        play = { ...prepareStatic(r), token, mode: 'run' };
      }
    } catch (err) {
      if (play?.token === token) { play = null; deps.toast(`Couldn't run: ${err.message}`); }
      syncControls();
      return false;
    }
    syncControls();
    return true;
  }

  function toastErr(r) {
    deps.toast(r.error ?? 'The program produced no trace.');
  }

  async function execute() {
    if (play?.units && play.i < play.units.length) { play.mode = 'run'; start(); return; }
    if (await load()) { play.mode = 'run'; start(); }
  }

  function start() {
    if (!play?.units || play.timer) return;
    const tick = () => {
      if (!play) return;
      if (play.i >= play.units.length) { play.timer = null; finish(); return; }
      const ms = playUnit(play.units[play.i++]);
      syncControls();
      if (play.hold) { play.timer = null; return; }
      play.timer = setTimeout(tick, ms);
    };
    play.timer = setTimeout(tick, 0);
    syncControls();
  }

  async function stepOnce() {
    if (!play?.units) { if (!(await load())) return; }
    play.mode = 'step';
    if (play.hold || play.timer || play.i >= play.units.length) return;
    playUnit(play.units[play.i++]);
    if (play.i >= play.units.length) finish();
    syncControls();
  }

  function pause() {
    if (!play?.timer) return;
    clearTimeout(play.timer);
    play.timer = null;
    syncControls();
  }

  function finish() {
    for (const cell of cells.values()) cell.el.classList.remove('active');
    play.active.clear();
    syncControls();
  }

  function isVisualizerActive() {
    if (!meshVizEnabled || typeof Visualizer === 'undefined') return false;
    return true;
  }

  function resumeFromVisualizer() {
    if (!play) return;
    play.hold = false;
    if (play.mode === 'run') {
      start();
    } else {
      syncControls();
    }
  }

  function clearReplay() {
    if (typeof Visualizer !== 'undefined') Visualizer.stopInspection?.();
    if (play?.timer) clearTimeout(play.timer);
    if (play?.runId && play.fetching) deps.api('POST', `/api/run/${play.runId}/stop`).catch(() => {});
    play = null;
    for (const cell of cells.values()) {
      cell.el.classList.remove('active', 'returning');
      cell.mem.replaceChildren();
      cell.mem.hidden = true;
    }
    const sink = cells.get(SINK);
    if (sink) sink.body.textContent = '';
    for (const p of ui.wires.querySelectorAll('.pulse')) p.remove();
    for (const w of wires.values()) w.group.classList.remove('hot');
  }

  function reset() {
    clearReplay();
    stats.clear();
    syncControls();
  }

  function handoff(fnName, from, to, ms) {
    if (!isVisualizerActive() || !play?.rawTrace || to - from < 2) return false;
    play.hold = true;
    ui.status.textContent = `Inside ${fnName}()`;
    setTimeout(() => {
      if (!play?.hold) return;
      Visualizer.inspectFunction({
        trace: play.rawTrace,
        funcName: fnName,
        startIdx: from,
        endIdx: to,
        speed,
        onComplete: () => {
          ui.status.textContent = '';
          resumeFromVisualizer();
        },
      });
    }, ms * 0.9);
    return true;
  }

  function playUnit(u) {
    const ms = BASE_MS / speed;
    if (u.t === 'call') {
      const key = u.from ? `${u.from}>${u.id}` : null;
      if (key && wires.has(key)) {
        const s = stats.get(key) ?? { count: 0 };
        s.count++;
        s.types = u.types;
        s.args = Object.entries(u.vars ?? {}).slice(0, 4).map(([k, v]) => `${k}=${fmt(v)}`).join(', ');
        stats.set(key, s);
        pulse(wires.get(key), false, ms * 0.85, clip(`${nameOf(u.id)}(${s.args})`));
      }
      const cell = cells.get(u.id);
      play.active.set(u.id, (play.active.get(u.id) ?? 0) + 1);
      cell?.el.classList.add('active');
      showMem(u.id, u.vars, false);
      follow(u.id);

      if (handoff(u.fn || nameOf(u.id), u.eventAt, u.segEnd, ms)) return ms;
    } else if (u.t === 'ret') {
      const key = u.to ? `${u.to}>${u.id}` : null;
      const s = key ? stats.get(key) : null;
      if (s) { s.ret = fmt(u.value); s.rtype = u.rtype; }
      if (key && wires.has(key)) pulse(wires.get(key), true, ms * 0.85, clip(`→ ${fmt(u.value)}`));
      showMem(u.id, u.vars, true);
      const left = (play.active.get(u.id) ?? 1) - 1;
      play.active.set(u.id, left);
      const cell = cells.get(u.id);
      cell?.el.classList.add('returning');
      setTimeout(() => cell?.el.classList.remove('returning'), ms * 0.8);
      if (left <= 0) setTimeout(() => { if (!play?.active.get(u.id)) cell?.el.classList.remove('active'); }, ms * 0.8);
      if (u.callerFn && handoff(u.callerFn, u.eventAt, u.segEnd, ms)) return ms;
    }
    if (u.at > play.shown) {
      const sink = cells.get(SINK);
      if (sink) {
        sink.body.textContent = play.stdout.slice(0, u.at);
        sink.body.scrollTop = sink.body.scrollHeight;
        const src = u.id && wires.get(`${u.id}>${SINK}`);
        if (src) pulse(src, false, ms * 0.85, 'print');
      }
      play.shown = u.at;
    }
    return ms;
  }

  const nameOf = (id) => short(graph.nodes.find((n) => n.id === id)?.name ?? id);
  const clip = (text) => (text.length > 38 ? `${text.slice(0, 37)}…` : text);

  function follow(id) {
    const p = pos[id];
    if (!p) return;
    const x = p.x * view.k + view.x;
    const y = p.y * view.k + view.y;
    const vw = ui.view.clientWidth;
    const vh = ui.view.clientHeight;
    if (x > 0 && y > 0 && x + W * view.k < vw && y + 120 * view.k < vh) return;
    view.x += (vw / 2 - (x + (W * view.k) / 2)) * 0.9;
    view.y += (vh / 3 - y) * 0.9;
    ui.world.classList.add('smooth');
    applyView();
    setTimeout(() => ui.world.classList.remove('smooth'), 320);
  }

  function pulse(w, reverse, duration, label = '') {
    if (!Prefs.get('pulses')) return;
    const kind = reverse ? ' back' : '';
    const path = w.path;
    const len = path.getTotalLength();
    const trailLen = Math.min(len * 0.45, 170);
    const trail = svg('path', { class: `comet-trail${kind}`, d: path.getAttribute('d') });
    trail.style.strokeDasharray = `${trailLen} ${len + trailLen}`;
    const halo = svg('circle', { class: `comet-halo${kind}`, r: 11 });
    const head = svg('circle', { class: `comet-head${kind}`, r: 5 });
    ui.wires.append(trail, halo, head);
    w.group.classList.add('hot');
    const chip = label ? make('div', { className: `comet-chip${kind}`, textContent: label }) : null;
    if (chip) ui.view.append(chip);
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min((now - t0) / duration, 1);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
      const at = len * (reverse ? 1 - eased : eased);
      const pt = path.getPointAtLength(at);
      head.setAttribute('cx', pt.x);
      head.setAttribute('cy', pt.y);
      halo.setAttribute('cx', pt.x);
      halo.setAttribute('cy', pt.y);
      trail.style.strokeDashoffset = reverse ? `${-at}` : `${trailLen - at}`;
      if (chip) chip.style.transform = `translate(${view.x + pt.x * view.k + 12}px, ${view.y + pt.y * view.k - 34}px)`;
      if (t < 1) { requestAnimationFrame(step); return; }
      head.remove();
      halo.remove();
      trail.classList.add('fade');
      setTimeout(() => trail.remove(), 420);
      if (chip) { chip.classList.add('out'); setTimeout(() => chip.remove(), 360); }
      setTimeout(() => w.group.classList.remove('hot'), 160);
    };
    requestAnimationFrame(step);
  }

  function showMem(id, vars, animate) {
    const cell = cells.get(id);
    if (!cell) return;
    const entries = Object.entries(vars ?? {}).filter(([k]) => !k.startsWith('_')).slice(0, 5);
    cell.mem.hidden = entries.length === 0;
    if (!animate) cell.mem.replaceChildren();
    const rows = new Map([...cell.mem.children].map((r) => [r.dataset.name, r]));
    for (const [name, value] of entries) {
      let row = rows.get(name);
      if (!row) {
        row = make('div', { className: 'mem-row' }, make('span', { className: 'mem-name', textContent: name }), make('span', { className: 'mem-val' }));
        row.dataset.name = name;
        cell.mem.append(row);
      }
      paintVar(row, value, animate);
    }
  }

  function paintVar(row, value, animate) {
    const box = row.lastChild;
    const next = value && typeof value === 'object' && 'l' in value ? value.l.map((x) => fmt(x)) : null;
    if (!next) {
      const text = fmt(value);
      if (box.textContent !== text) {
        box.className = 'mem-val';
        box.textContent = text;
        if (animate) flash(box);
      }
      row._items = null;
      return;
    }
    const prev = row._items;
    row._items = next;
    if (!prev || prev.length !== next.length || !box.classList.contains('chips')) {
      box.className = 'mem-val chips';
      box.replaceChildren(...next.map(chip));
      if (value.n > next.length) box.append(make('span', { className: 'chip more', textContent: `+${value.n - next.length}` }));
      return;
    }
    const diff = [];
    next.forEach((v, i) => { if (v !== prev[i]) diff.push(i); });
    if (!diff.length) return;
    const nodes = [...box.children];
    const swapped = diff.length === 2 && prev[diff[0]] === next[diff[1]] && prev[diff[1]] === next[diff[0]];
    if (swapped && animate) {
      const [i, j] = diff;
      const dist = nodes[j].offsetLeft - nodes[i].offsetLeft;
      nodes[i].textContent = next[i];
      nodes[j].textContent = next[j];
      springSwap(nodes[i], dist);
      springSwap(nodes[j], -dist);
    } else {
      for (const i of diff) { nodes[i].textContent = next[i]; if (animate) flash(nodes[i]); }
    }
  }

  const chip = (text) => make('span', { className: 'chip', textContent: text });

  function springSwap(node, dist) {
    node.animate([
      { transform: `translateX(${dist}px) scale(1.18)`, zIndex: 2, offset: 0 },
      { transform: 'translateX(0) scale(1.18)', zIndex: 2, offset: 0.7 },
      { transform: 'translateX(0) scale(1)', zIndex: 2, offset: 1 },
    ], { duration: 520 / speed, easing: 'cubic-bezier(.34, 1.56, .64, 1)' });
    flash(node);
  }

  function flash(node) {
    node.classList.remove('changed');
    void node.offsetWidth;
    node.classList.add('changed');
  }

  function show(on) {
    visible = on;
    if (!on) return;
    applyView();
    if (stale || !graph) analyze();
    else if (fitPending) fit(false);
  }

  function invalidate() {
    if (!deps) return;
    if (selfEdit) return;
    stale = true;
    if (editing) return;
    if (visible) {
      clearTimeout(analyzeTimer);
      analyzeTimer = setTimeout(analyze, 600);
    }
  }

  function layout() {
    if (!graph?.nodes.length) return null;
    const nodes = {};
    for (const n of graph.nodes) if (pos[n.id]) nodes[n.id] = { x: Math.round(pos[n.id].x), y: Math.round(pos[n.id].y) };
    for (const id of extIds()) if (pos[id]) nodes[id] = { x: Math.round(pos[id].x), y: Math.round(pos[id].y) };
    if (pos[SINK]) nodes[SINK] = { x: Math.round(pos[SINK].x), y: Math.round(pos[SINK].y) };
    const saved = { version: 1, nodes, view: { x: Math.round(view.x), y: Math.round(view.y), k: Number(view.k.toFixed(3)) } };
    if (locked.size) saved.locked = [...locked];
    if (collapsed.size) saved.collapsed = [...collapsed];
    if (Object.keys(bookmarks).length) saved.bookmarks = bookmarks;
    return saved;
  }

  function setLayout(saved) {
    clearReplay();
    endEdit();
    pos = saved?.nodes ? { ...saved.nodes } : {};
    view = saved?.view ? { ...saved.view } : { x: 40, y: 40, k: 1 };
    locked.clear();
    collapsed.clear();
    for (const id of saved?.locked ?? []) locked.add(id);
    for (const id of saved?.collapsed ?? []) collapsed.add(id);
    bookmarks = { ...(saved?.bookmarks ?? {}) };
    fitPending = !saved?.view;
    graph = null;
    stale = true;
    error = null;
    for (const cell of cells.values()) cell.el.remove();
    cells.clear();
    for (const w of wires.values()) w.group.remove();
    wires.clear();
    stats.clear();
    selected = null;
    if (ui.world) { ui.empty.hidden = true; applyView(); }
    if (visible) analyze();
  }

  function init(d) {
    deps = d;
    root = document.getElementById('mesh');
    build();
    ui.view.classList.toggle('plain', !Prefs.get('grid'));
    document.addEventListener('keydown', (e) => {
      if (!visible || e.target.closest?.('input, textarea, .monaco-editor')) return;
      const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
      const digit = /^Digit([1-4])$/.exec(e.code);
      if (mod && e.code === 'KeyF' && !e.shiftKey) { e.preventDefault(); Palette.open('symbols'); return; }
      if (mod && digit) { e.preventDefault(); (e.shiftKey ? bookmarkSave : bookmarkGo)(Number(digit[1])); return; }
      if (e.key === 'Escape') { endEdit(); select(null); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected && graph?.nodes.some((n) => n.id === selected)) { e.preventDefault(); deleteCell(selected); }
    });
  }

  function afterRender() {
    if (pendingEdit && graph?.nodes.some((n) => n.id === pendingEdit)) {
      const id = pendingEdit;
      pendingEdit = null;
      select(id);
      beginEdit(id);
    }
  }

  Prefs.on((key) => {
    if (!deps) return;
    if (key === 'wireStyle' && graph) drawWires(false);
    if (key === 'grid') ui.view.classList.toggle('plain', !Prefs.get('grid'));
  });

  function glide(target) {
    ui.world.classList.add('smooth');
    view = { ...target };
    applyView();
    clearTimeout(glideTimer);
    glideTimer = setTimeout(() => ui.world.classList.remove('smooth'), 340);
  }

  function reveal(id) {
    const p = pos[id];
    const cell = cells.get(id);
    if (!p || !cell) return;
    const k = Math.min(Math.max(view.k, 0.85), 1.6);
    const h = cell.el.offsetHeight || 120;
    glide({ k, x: ui.view.clientWidth / 2 - (p.x + W / 2) * k, y: ui.view.clientHeight / 2 - (p.y + h / 2) * k });
    select(id);
    cell.el.classList.add('found');
    setTimeout(() => cell.el.classList.remove('found'), 1400);
    touch();
  }

  function bookmarkSave(n) {
    if (!graph?.nodes.length) return;
    bookmarks[n] = { x: Math.round(view.x), y: Math.round(view.y), k: Number(view.k.toFixed(3)) };
    deps.toast(`Saved view bookmark ${n}`);
    touch();
  }

  function bookmarkGo(n) {
    const b = bookmarks[n];
    if (!b) { deps.toast(`Bookmark ${n} is empty. Ctrl+Shift+${n} saves the current view`); return; }
    glide(b);
    touch();
  }

  function snapDrag(id, x, y, free) {
    if (free || !Prefs.get('snapGuides')) { showGuides(); return { x, y, hit: false }; }
    const h = cells.get(id).el.offsetHeight;
    const tol = 8 / view.k;
    const others = [...cells].filter(([oid]) => oid !== id && pos[oid]).map(([oid, c]) => ({ x: pos[oid].x, y: pos[oid].y, h: c.el.offsetHeight }));
    const marks = (lo, size) => [lo, lo + size / 2, lo + size];
    let dx = null;
    let dy = null;
    for (const o of others) {
      for (const a of marks(x, W)) for (const b of marks(o.x, W)) if (Math.abs(b - a) <= tol && (dx === null || Math.abs(b - a) < Math.abs(dx))) dx = b - a;
      for (const a of marks(y, h)) for (const b of marks(o.y, o.h)) if (Math.abs(b - a) <= tol && (dy === null || Math.abs(b - a) < Math.abs(dy))) dy = b - a;
    }
    const nx = x + (dx ?? 0);
    const ny = y + (dy ?? 0);
    const vertical = [];
    const horizontal = [];
    for (const o of others) {
      for (const a of marks(nx, W)) for (const b of marks(o.x, W)) if (dx !== null && Math.abs(b - a) < 0.5) vertical.push({ at: b, from: Math.min(ny, o.y) - 16, to: Math.max(ny + h, o.y + o.h) + 16 });
      for (const a of marks(ny, h)) for (const b of marks(o.y, o.h)) if (dy !== null && Math.abs(b - a) < 0.5) horizontal.push({ at: b, from: Math.min(nx, o.x) - 16, to: Math.max(nx + W, o.x + W) + 16 });
    }
    showGuides(vertical, horizontal);
    return { x: nx, y: ny, hit: dx !== null || dy !== null };
  }

  function showGuides(vertical = [], horizontal = []) {
    const px = 1 / view.k;
    const lines = [
      ...vertical.map((l) => ({ left: l.at, top: l.from, width: px, height: l.to - l.from })),
      ...horizontal.map((l) => ({ left: l.from, top: l.at, width: l.to - l.from, height: px })),
    ];
    while (guideEls.length < lines.length) {
      const g = make('div', { className: 'snap-guide' });
      ui.world.append(g);
      guideEls.push(g);
    }
    guideEls.forEach((g, i) => {
      const l = lines[i];
      g.hidden = !l;
      if (l) Object.assign(g.style, { left: `${l.left}px`, top: `${l.top}px`, width: `${l.width}px`, height: `${l.height}px` });
    });
  }

  const isFunction = (id) => graph?.nodes.some((n) => n.id === id && n.kind === 'function') ?? false;

  function startRewire(w, ev) {
    drag = { kind: 'rewire', edge: w.edge, w, target: null, temp: svg('path', { class: 'wire-temp' }) };
    ui.wires.append(drag.temp);
    ui.badge.hidden = true;
    w.group.classList.add('rewiring');
    ui.view.setPointerCapture(ev.pointerId);
    moveRewire(ev);
  }

  function moveRewire(ev) {
    const rect = ui.view.getBoundingClientRect();
    const tip = { x: (ev.clientX - rect.left - view.x) / view.k, y: (ev.clientY - rect.top - view.y) / view.k };
    const over = document.elementsFromPoint(ev.clientX, ev.clientY).map((n) => n.closest?.('.cell')).find(Boolean);
    const id = over?.dataset.id;
    drag.target = id && id !== drag.edge.from && id !== drag.edge.to && isFunction(id) ? id : null;
    for (const [cid, c] of cells) c.el.classList.toggle('rewire-target', cid === drag.target);
    drag.temp.setAttribute('d', wirePath(pinPoint(drag.edge.from, 'out'), drag.target ? pinPoint(drag.target, 'in') : tip));
  }

  function finishRewire(done) {
    done.temp.remove();
    done.w.group.classList.remove('rewiring');
    for (const c of cells.values()) c.el.classList.remove('rewire-target');
    if (done.target) rewireCall(done.edge, done.target);
  }

  async function rewireCall(edge, targetId) {
    const source = graph.nodes.find((n) => n.id === edge.from);
    const oldNode = graph.nodes.find((n) => n.id === edge.to);
    const newNode = graph.nodes.find((n) => n.id === targetId);
    if (!source || !oldNode || !newNode) return;
    const oldName = short(oldNode.name);
    const newName = short(newNode.name);
    const ok = await Modal.confirm({
      title: 'Reroute call',
      message: `In ${short(source.name)}, call ${newName}${newNode.sig} instead of ${oldName}${oldNode.sig}? Every call to ${oldName} inside ${short(source.name)} is renamed and its arguments are left as written.`,
      action: 'Reroute',
    });
    if (!ok) return;
    const word = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const text = source.text.replace(new RegExp(`(?<![\\w.$])${word}(?=\\s*\\()`, 'g'), newName);
    if (text === source.text) { deps.toast(`No call to ${oldName} found in ${short(source.name)}`); return; }
    source.text = text;
    commitCode(assemble());
  }

  function canvasSvg() {
    const ids = [...cells.keys()].filter((id) => pos[id]);
    if (!ids.length) return null;
    const rootStyle = getComputedStyle(document.documentElement);
    const tone = (name, fallback) => rootStyle.getPropertyValue(name).trim() || fallback;
    const paint = {
      bg: getComputedStyle(document.body).backgroundColor || '#ffffff',
      panel: tone('--bg-panel', '#1e1e1e'),
      line: tone('--line-soft', '#444444'),
      text: tone('--text', '#e6e6e6'),
      muted: tone('--text-muted', '#9a9a9a'),
      accent: tone('--accent', '#4f9cf9'),
      green: tone('--green', '#4ade80'),
      warn: tone('--warn', '#f59e0b'),
    };
    const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
    const boxes = ids.map((id) => ({ id, x: pos[id].x, y: pos[id].y, h: cells.get(id).el.offsetHeight || 120 }));
    const pad = 40;
    const x1 = Math.min(...boxes.map((b) => b.x)) - pad;
    const y1 = Math.min(...boxes.map((b) => b.y)) - pad;
    const width = Math.round(Math.max(...boxes.map((b) => b.x + W)) + pad - x1);
    const height = Math.round(Math.max(...boxes.map((b) => b.y + b.h)) + pad - y1);
    const mono = 'Consolas, Menlo, monospace';
    const sans = 'Segoe UI, system-ui, sans-serif';
    const parts = [];
    for (const e of allEdges().filter((x) => x.from !== x.to && pos[x.from] && pos[x.to])) {
      parts.push(`<path d="${wirePath(pinPoint(e.from, 'out'), pinPoint(e.to, 'in'))}" fill="none" stroke="${e.sink ? paint.muted : paint.accent}" stroke-width="2" stroke-linecap="round"${e.sink ? ' stroke-dasharray="5 5"' : ''} opacity="0.8"/>`);
    }
    for (const b of boxes) {
      const cell = cells.get(b.id);
      const folded = collapsed.has(b.id);
      const h = folded ? HEAD : b.h;
      const dot = b.id === SINK ? paint.muted : cell.el.classList.contains('entry') ? paint.green : cell.el.dataset.kind === 'setup' || cell.el.dataset.kind === 'script' ? paint.warn : paint.accent;
      const title = cell.title.textContent;
      parts.push(`<g transform="translate(${b.x},${b.y})">`,
        `<rect width="${W}" height="${h}" rx="10" fill="${paint.panel}" stroke="${cell.el.classList.contains('selected') ? paint.accent : paint.line}"/>`,
        `<circle cx="14" cy="${HEAD / 2}" r="4" fill="${dot}"/>`,
        `<text x="26" y="${HEAD / 2 + 4}" font-family="${sans}" font-size="13" font-weight="600" fill="${paint.text}">${esc(title)}</text>`,
        `<text x="${W - 12}" y="${HEAD / 2 + 4}" text-anchor="end" font-family="${sans}" font-size="11" fill="${paint.muted}">${esc(cell.tag.textContent)}</text>`,
        `<circle cx="0" cy="${HEAD / 2}" r="5" fill="${paint.panel}" stroke="${paint.accent}" stroke-width="2"/>`,
        `<circle cx="${W}" cy="${HEAD / 2}" r="5" fill="${paint.accent}"/>`);
      if (!folded) {
        parts.push(`<line x1="0" x2="${W}" y1="${HEAD}" y2="${HEAD}" stroke="${paint.line}"/>`);
        const source = cell.text || cell.body.textContent || '';
        const rows = Math.max(0, Math.floor((h - HEAD - 12) / LINE));
        source.replace(/\t/g, '    ').split('\n').slice(0, rows).forEach((row, i) => {
          const shown = row.length > 41 ? `${row.slice(0, 40)}…` : row;
          parts.push(`<text x="14" y="${HEAD + 18 + i * LINE}" font-family="${mono}" font-size="12" fill="${paint.text}" xml:space="preserve">${esc(shown)}</text>`);
        });
      }
      parts.push('</g>');
    }
    const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${paint.bg}"/><g transform="translate(${-x1},${-y1})">${parts.join('')}</g></svg>`;
    return { xml, width, height };
  }

  function download(blob, name) {
    const a = make('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function exportSvg() {
    const out = canvasSvg();
    if (!out) { deps.toast('Nothing to export yet'); return; }
    download(new Blob([out.xml], { type: 'image/svg+xml' }), 'flow.svg');
  }

  function exportPng() {
    const out = canvasSvg();
    if (!out) { deps.toast('Nothing to export yet'); return; }
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(2, 8000 / Math.max(out.width, out.height));
      const canvas = make('canvas', { width: Math.round(out.width * scale), height: Math.round(out.height * scale) });
      const g = canvas.getContext('2d');
      g.scale(scale, scale);
      g.drawImage(img, 0, 0, out.width, out.height);
      canvas.toBlob((blob) => (blob ? download(blob, 'flow.png') : deps.toast('PNG export failed')));
    };
    img.onerror = () => deps.toast('PNG export failed');
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(out.xml)}`;
  }

  const nodes = () => (graph?.nodes ?? []).map((n) => ({ id: n.id, name: n.name, sig: n.sig }));
  const renameFunction = async () => {
    const pick = await Modal.prompt({ title: 'Rename function', label: `Function name (${nodes().filter((n) => n.sig !== '').map((n) => n.name).join(', ')})`, action: 'Next' });
    const node = graph?.nodes.find((n) => short(n.name) === pick);
    if (node) renameCell(node.id);
    else if (pick) deps.toast(`No function called ${pick}`);
  };
  const actions = { exportPng, exportSvg, bookmarkGo, bookmarkSave, renameFunction, execute, fit: () => fit(true), autoLayout: () => autoLayout(true), addCell, reset, step: stepOnce };

  return { init, show, invalidate, layout, setLayout, wirePath, examples: EXAMPLES, nodes, reveal, actions };
})();
