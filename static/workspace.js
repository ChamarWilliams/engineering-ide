const Workspace = (() => {
  const STORE_KEY = 'eide.workspace.v2';
  const NAMES = ['files', 'viz', 'console', 'timeline', 'history'];
  const MIN_EDITOR = 320;

  const LAYOUTS = {
    docked: {
      label: 'Docked',
      docks: ['files', 'viz', 'console'],
      panels: { files: [true, false], viz: [false, false], console: [false, false], history: [false, true] },
      sizes: { side: 240, viz: 340, bottom: 240 },
    },
    split: {
      label: 'Split stage',
      docks: ['files', 'viz', 'console'],
      panels: { files: [false, false], viz: [true, false], console: [true, false], history: [false, true] },
      sizes: { side: 260, viz: null, bottom: 200 },
    },
    focus: {
      label: 'Focus canvas',
      docks: [],
      panels: { files: [false, true], viz: [true, true], console: [false, true], history: [false, true] },
      sizes: { side: 260, viz: 340, bottom: 240 },
    },
    timeline: {
      label: 'Timeline',
      docks: ['files', 'viz', 'console', 'timeline'],
      panels: { files: [false, false], viz: [true, false], console: [false, true], timeline: [true, false], history: [false, true] },
      sizes: { side: 260, viz: 400, bottom: 220 },
    },
  };

  const TIMELINE_H = 64;

  const ws = document.getElementById('workspace');
  const panelEl = Object.fromEntries(NAMES.map((n) => [n, ws.querySelector(`[data-panel="${n}"]`)]));
  let store = { layout: 'docked', byLayout: {} };
  let zTop = 30;

  try { Object.assign(store, JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')); } catch { /* start fresh */ }
  if (!LAYOUTS[store.layout]) store.layout = 'docked';

  const persist = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* storage unavailable */ }
  };
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  function fresh(name) {
    const l = LAYOUTS[name];
    return {
      sizes: { ...l.sizes },
      panels: Object.fromEntries(NAMES.map((n) => {
        const [visible, floating] = l.panels[n] ?? [false, false];
        return [n, { visible, floating, rect: null }];
      })),
    };
  }

  function cur() {
    const state = (store.byLayout[store.layout] ??= fresh(store.layout));
    for (const n of NAMES) state.panels[n] ??= { visible: false, floating: false, rect: null };
    return state;
  }
  const avail = (n) => n in LAYOUTS[store.layout].panels;
  const canDock = (n) => LAYOUTS[store.layout].docks.includes(n);
  const isFloating = (n) => cur().panels[n].floating || !canDock(n);
  const isDocked = (n) => cur().panels[n].visible && avail(n) && !isFloating(n);

  function defaultRect(n) {
    const w = innerWidth;
    const h = innerHeight;
    if (n === 'history') return { x: Math.max(64, w - 360), y: 96, w: 320, h: Math.min(420, h - 200) };
    if (n === 'files') return { x: 64, y: 96, w: 260, h: Math.min(380, h - 200) };
    if (n === 'viz') return { x: Math.max(64, w - 400), y: 110, w: 360, h: Math.min(320, h - 220) };
    const cw = Math.min(780, w - 140);
    return { x: Math.round((w - cw) / 2), y: Math.max(80, h - 290), w: cw, h: 240 };
  }

  function fit(rect) {
    const w = clamp(rect.w, 220, innerWidth - 16);
    const h = clamp(rect.h, 140, innerHeight - 72);
    return { w, h, x: clamp(rect.x, 8, innerWidth - w - 8), y: clamp(rect.y, 48, innerHeight - h - 32) };
  }

  function applyGrid() {
    const { sizes } = cur();
    const cols = [];
    const top = [];
    const bottom = [];
    const hasConsole = isDocked('console');
    const hasViz = isDocked('viz');
    const vizBelow = hasViz && sizes.vizPos === 'bottom';

    if (isDocked('files')) { cols.push(`${sizes.side}px`); top.push('files'); bottom.push('files'); }
    cols.push('minmax(0, 1fr)');
    top.push('editor');
    bottom.push('console');
    if (hasViz && !vizBelow) {
      const avail = ws.clientWidth - (isDocked('files') ? sizes.side : 0);
      const vizW = clamp(sizes.viz ?? avail / 2, 200, avail - MIN_EDITOR);
      cols.push(`${Math.round(vizW)}px`);
      top.push('viz');
      bottom.push('console');
    }

    const rows = [top];
    const heights = ['minmax(0, 1fr)'];
    if (vizBelow) {
      rows.push(top.map((a) => (a === 'files' ? 'files' : 'viz')));
      heights.push(`${clamp(sizes.vizH ?? 340, 160, innerHeight - 260)}px`);
    }
    if (hasConsole) { rows.push(bottom); heights.push(`${sizes.bottom}px`); }
    if (isDocked('timeline')) { rows.push(top.map(() => 'timeline')); heights.push(`${TIMELINE_H}px`); }
    ws.style.gridTemplateColumns = cols.join(' ');
    ws.style.gridTemplateRows = heights.join(' ');
    ws.style.gridTemplateAreas = rows.map((r) => `"${r.join(' ')}"`).join(' ');
  }

  function apply() {
    const state = cur();
    ws.dataset.layout = store.layout;
    panelEl.viz.dataset.pos = state.sizes.vizPos === 'bottom' && isDocked('viz') ? 'bottom' : 'right';
    const posBtn = panelEl.viz.querySelector('[data-viz-pos]');
    if (posBtn) posBtn.title = panelEl.viz.dataset.pos === 'bottom' ? 'Move beside the flow' : 'Move below the flow';

    for (const n of NAMES) {
      const p = state.panels[n];
      const el = panelEl[n];
      const floating = isFloating(n);
      const shown = p.visible && avail(n);
      el.classList.toggle('is-hidden', !shown);
      el.classList.toggle('is-floating', floating && shown);
      if (floating && shown) {
        p.rect = fit(p.rect ?? defaultRect(n));
        Object.assign(el.style, { left: `${p.rect.x}px`, top: `${p.rect.y}px`, width: `${p.rect.w}px`, height: `${p.rect.h}px` });
      } else {
        Object.assign(el.style, { left: '', top: '', width: '', height: '' });
      }
      const toggle = el.querySelector('[data-float]');
      if (toggle) {
        toggle.disabled = !canDock(n);
        toggle.title = floating ? (canDock(n) ? 'Dock' : 'This layout floats panels') : 'Float';
        toggle.firstElementChild.firstElementChild.setAttribute('href', floating ? '#i-dock' : '#i-float');
      }
      const stripeBtn = document.querySelector(`.stripe-btn[data-toggle="${n}"]`);
      stripeBtn.hidden = !avail(n);
      stripeBtn.classList.toggle('active', shown);
    }
    applyGrid();
  }

  function front(n) {
    panelEl[n].style.zIndex = ++zTop;
  }

  function show(n, visible = true) {
    cur().panels[n].visible = visible;
    apply();
    if (visible && isFloating(n)) front(n);
    persist();
  }

  function toggleVizPosition() {
    const state = cur();
    const below = state.sizes.vizPos === 'bottom' && isDocked('viz');
    state.sizes.vizPos = below ? 'right' : 'bottom';
    if (!below && canDock('viz')) state.panels.viz.floating = false;
    state.panels.viz.visible = true;
    apply();
    persist();
  }

  function toggleFloat(n) {
    if (!canDock(n)) return;
    const p = cur().panels[n];
    p.floating = !isFloating(n);
    if (p.floating) p.rect ??= defaultRect(n);
    apply();
    if (p.floating) front(n);
    persist();
  }

  function setLayout(name) {
    store.layout = name;
    apply();
    persist();
  }

  function reset() {
    delete store.byLayout[store.layout];
    apply();
    persist();
  }

  function drag(e, onMove) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev) => onMove(ev.clientX - startX, ev.clientY - startY);
    const up = () => {
      target.removeEventListener('pointermove', move);
      document.body.classList.remove('dragging', 'resizing-x', 'resizing-y');
      persist();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up, { once: true });
    target.addEventListener('pointercancel', up, { once: true });
  }

  function bind() {
    document.querySelectorAll('.stripe-btn').forEach((b) => {
      b.addEventListener('click', () => show(b.dataset.toggle, !cur().panels[b.dataset.toggle].visible));
    });
    document.querySelectorAll('[data-hide]').forEach((b) => b.addEventListener('click', () => show(b.dataset.hide, false)));
    document.querySelectorAll('[data-viz-pos]').forEach((b) => b.addEventListener('click', toggleVizPosition));
    document.querySelectorAll('[data-float]').forEach((b) => b.addEventListener('click', () => toggleFloat(b.dataset.float)));

    for (const n of NAMES) {
      const el = panelEl[n];
      el.addEventListener('pointerdown', () => { if (isFloating(n)) front(n); });

      el.querySelector('.tw-header')?.addEventListener('pointerdown', (e) => {
        if (!isFloating(n) || e.target.closest('button')) return;
        const r = { ...cur().panels[n].rect };
        document.body.classList.add('dragging');
        drag(e, (dx, dy) => {
          cur().panels[n].rect = fit({ ...r, x: r.x + dx, y: r.y + dy });
          apply();
        });
      });

      el.querySelector('.grip')?.addEventListener('pointerdown', (e) => {
        const r = { ...cur().panels[n].rect };
        document.body.classList.add('dragging');
        drag(e, (dx, dy) => {
          cur().panels[n].rect = fit({ ...r, w: r.w + dx, h: r.h + dy });
          apply();
        });
      });

      el.querySelector('.edge')?.addEventListener('pointerdown', (e) => {
        const sizes = cur().sizes;
        const start = { side: sizes.side, viz: sizes.viz ?? panelEl.viz.offsetWidth, bottom: sizes.bottom, vizH: sizes.vizH ?? panelEl.viz.offsetHeight };
        const vertical = n === 'console' || (n === 'viz' && panelEl.viz.dataset.pos === 'bottom');
        document.body.classList.add(vertical ? 'resizing-y' : 'resizing-x');
        drag(e, (dx, dy) => {
          if (n === 'files') sizes.side = clamp(start.side + dx, 180, innerWidth * 0.45);
          if (n === 'viz' && vertical) sizes.vizH = clamp(start.vizH - dy, 160, innerHeight - 260);
          else if (n === 'viz') sizes.viz = clamp(start.viz - dx, 200, innerWidth * 0.7);
          if (n === 'console') sizes.bottom = clamp(start.bottom - dy, 90, innerHeight - 220);
          applyGrid();
        });
      });
    }

    window.addEventListener('resize', apply);
    new ResizeObserver(applyGrid).observe(ws);
    apply();
  }

  const layouts = () => Object.entries(LAYOUTS).map(([id, l]) => ({ id, label: l.label }));

  return { bind, show, setLayout, reset, layouts, current: () => store.layout };
})();
