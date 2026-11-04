const ProjectMap = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const LANG_NAMES = { c: 'C', cpp: 'C++', lua: 'Lua', python: 'Python' };
  let deps = null;
  let root = null;
  let ui = {};
  let tree = { folders: [], files: [] };
  let cwd = '';
  let visible = false;
  let dragging = null;
  let frame = 0;

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
  const base = (path) => path.split('/').pop();
  const parent = (path) => path.split('/').slice(0, -1).join('/');
  const inside = (path, dir) => (dir ? path === dir || path.startsWith(`${dir}/`) : true);

  function build() {
    ui = {
      crumbs: make('nav', { className: 'map-crumbs', ariaLabel: 'Folder path' }),
      newFile: make('button', { type: 'button', className: 'mesh-btn primary', textContent: 'New file', title: 'New file in this folder' }),
      newFolder: make('button', { type: 'button', className: 'mesh-btn', textContent: 'New folder', title: 'New folder here' }),
      upload: make('button', { type: 'button', className: 'mesh-btn', textContent: 'Upload', title: 'Upload files, a folder or a zip' }),
      stage: make('div', { className: 'map-stage' }),
      wires: svg('svg', { class: 'map-wires' }),
      rootCol: make('div', { className: 'map-col map-root' }),
      kidCol: make('div', { className: 'map-col map-kids' }),
      empty: make('div', { className: 'map-empty', hidden: true }),
      tip: make('div', { className: 'map-tip', hidden: true }),
    };
    ui.empty.append(make('strong', { textContent: 'This folder is empty' }), make('span', { textContent: 'Create a file, or drag a file here from another folder.' }));
    ui.stage.append(ui.wires, ui.rootCol, ui.kidCol, ui.empty, ui.tip);
    const bar = make('div', { className: 'mesh-bar' }, ui.crumbs, make('span', { className: 'mesh-status' }), ui.upload, ui.newFolder, ui.newFile);
    bar.querySelector('.mesh-status').style.marginLeft = '0';
    ui.crumbs.style.marginRight = 'auto';
    root.append(bar, ui.stage);
    ui.newFile.addEventListener('click', () => deps.newFile(cwd));
    ui.newFolder.addEventListener('click', createFolder);
    ui.upload.addEventListener('click', (e) => deps.importMenu(e, cwd));
    ui.stage.addEventListener('scroll', schedule, { passive: true });
    new ResizeObserver(schedule).observe(ui.stage);
    Prefs.on((key) => { if (visible && (key === 'wireStyle' || key === 'grid')) paint(); });
  }

  async function createFolder() {
    const name = await Modal.prompt({ title: 'New folder', label: 'Folder name', action: 'Create' });
    if (!name?.trim()) return;
    try {
      await deps.api('POST', '/api/folders', { path: cwd ? `${cwd}/${name.trim()}` : name.trim() });
      await refresh();
    } catch (err) {
      deps.toast(err.message);
    }
  }

  async function refresh() {
    try { tree = await deps.api('GET', '/api/tree'); } catch { /* keep previous tree */ }
    if (cwd && !tree.folders.includes(cwd)) cwd = '';
    paint();
  }

  function go(path) {
    cwd = path;
    paint();
  }

  function paintCrumbs() {
    const parts = cwd ? cwd.split('/') : [];
    const items = [{ label: 'Project', path: '' }, ...parts.map((p, i) => ({ label: p, path: parts.slice(0, i + 1).join('/') }))];
    ui.crumbs.replaceChildren(...items.flatMap((it, i) => {
      const b = make('button', { type: 'button', className: 'crumb', textContent: it.label });
      if (i === items.length - 1) b.setAttribute('aria-current', 'page');
      b.addEventListener('click', () => go(it.path));
      b.addEventListener('dragover', (e) => { if (dragging) { e.preventDefault(); b.classList.add('drop'); } });
      b.addEventListener('dragleave', () => b.classList.remove('drop'));
      b.addEventListener('drop', (e) => { e.preventDefault(); b.classList.remove('drop'); moveInto(it.path); });
      return i ? [make('span', { className: 'crumb-sep', textContent: '›' }), b] : [b];
    }));
  }

  async function moveInto(folder) {
    const id = dragging;
    dragging = null;
    if (!id) return;
    try {
      await deps.api('PUT', `/api/sessions/${id}/folder`, { path: folder });
      deps.moved(id, folder);
      await refresh();
    } catch (err) {
      deps.toast(err.message);
    }
  }

  function folderNode(path) {
    const count = tree.files.filter((f) => inside(f.folder, path)).length;
    const subs = tree.folders.filter((f) => parent(f) === path).length;
    const empty = !tree.files.some((f) => inside(f.folder, path)) && !tree.folders.some((f) => f !== path && f.startsWith(`${path}/`));
    const node = make('div', { className: 'map-node folder', tabIndex: 0, role: 'button', ariaLabel: `Open folder ${base(path)}` },
      make('div', { className: 'map-head' }, make('span', { className: 'map-glyph' }), make('strong', { textContent: base(path) })),
      make('div', { className: 'map-sub', textContent: `${count} file${count === 1 ? '' : 's'}${subs ? ` · ${subs} folder${subs === 1 ? '' : 's'}` : ''}` }));
    if (empty) {
      const del = make('button', { type: 'button', className: 'map-del', title: 'Delete empty folder', textContent: '×' });
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await deps.api('DELETE', `/api/folders?path=${encodeURIComponent(path)}`); await refresh(); } catch (err) { deps.toast(err.message); }
      });
      node.append(del);
    }
    node.addEventListener('click', () => go(path));
    node.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(path); });
    node.addEventListener('dragover', (e) => { if (dragging) { e.preventDefault(); node.classList.add('drop'); } });
    node.addEventListener('dragleave', () => node.classList.remove('drop'));
    node.addEventListener('drop', (e) => { e.preventDefault(); node.classList.remove('drop'); moveInto(path); });
    return node;
  }

  function fileNode(f) {
    const flow = make('button', { type: 'button', className: 'map-open', textContent: 'Flow', title: 'Open as a flow' });
    const text = make('button', { type: 'button', className: 'map-open', textContent: 'Text', title: 'Open in the text editor' });
    const kb = f.size >= 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`;
    const node = make('div', { className: 'map-node file', draggable: true, tabIndex: 0, role: 'button', ariaLabel: `Open ${f.title}` },
      make('div', { className: 'map-head' }, make('span', { className: 'map-badge', textContent: LANG_NAMES[f.language] ?? f.language }), make('strong', { textContent: f.title })),
      make('div', { className: 'map-sub', textContent: `${kb} · ${deps.relTime(f.updated_at)}` }),
      make('div', { className: 'map-actions' }, flow, text));
    node.dataset.lang = f.language;
    node.dataset.id = f.id;
    const open = (as) => deps.open(f.id, as ?? Prefs.get('openAs'));
    node.addEventListener('click', () => open());
    node.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    flow.addEventListener('click', (e) => { e.stopPropagation(); open('flow'); });
    text.addEventListener('click', (e) => { e.stopPropagation(); open('text'); });
    node.addEventListener('dragstart', (e) => { dragging = f.id; e.dataTransfer.setData('text/plain', f.id); e.dataTransfer.effectAllowed = 'move'; node.classList.add('dragging'); });
    node.addEventListener('dragend', () => { dragging = null; node.classList.remove('dragging'); });
    return node;
  }

  function paint() {
    paintCrumbs();
    const folders = tree.folders.filter((f) => parent(f) === cwd).sort();
    const files = tree.files.filter((f) => f.folder === cwd).sort((a, b) => a.title.localeCompare(b.title));
    const here = make('div', { className: 'map-node here' },
      make('div', { className: 'map-head' }, make('span', { className: 'map-glyph' }), make('strong', { textContent: cwd ? base(cwd) : 'Project' })),
      make('div', { className: 'map-sub', textContent: cwd || 'All sessions' }));
    ui.rootCol.replaceChildren(here);
    ui.kidCol.replaceChildren(...folders.map(folderNode), ...files.map(fileNode));
    ui.empty.hidden = Boolean(folders.length || files.length);
    ui.stage.classList.toggle('plain', !Prefs.get('grid'));
    schedule();
    if (cwd) {
      const up = make('button', { type: 'button', className: 'map-up', textContent: '↑ Up', title: 'Parent folder' });
      up.addEventListener('click', () => go(parent(cwd)));
      here.append(up);
    }
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; wire(); });
  }

  function wire() {
    ui.wires.replaceChildren();
    const here = ui.rootCol.firstElementChild;
    if (!here || !visible) return;
    const origin = ui.stage.getBoundingClientRect();
    const sx = ui.stage.scrollLeft;
    const sy = ui.stage.scrollTop;
    const h = here.getBoundingClientRect();
    const a = { x: h.right - origin.left + sx, y: h.top + h.height / 2 - origin.top + sy };
    ui.wires.style.width = `${ui.stage.scrollWidth}px`;
    ui.wires.style.height = `${ui.stage.scrollHeight}px`;
    for (const kid of ui.kidCol.children) {
      const r = kid.getBoundingClientRect();
      const b = { x: r.left - origin.left + sx, y: r.top + 22 - origin.top + sy };
      const path = svg('path', { class: `map-wire ${kid.classList.contains('folder') ? 'folder' : ''}`, d: Mesh.wirePath(a, b) });
      ui.wires.append(path);
    }
    drawLinks(origin, sx, sy);
  }

  const bytes = (n) => (n === null || n === undefined ? '' : ` · ${n} B`);

  function describeLink(l, from, to) {
    const rows = [make('div', {}, make('strong', { textContent: from }), ' → ', make('strong', { textContent: to })), make('code', { textContent: l.via })];
    if (!l.calls.length) rows.push(make('div', { className: 'map-sub', textContent: 'Imported, but no calls found' }));
    for (const c of l.calls) {
      rows.push(make('code', { textContent: `${c.name}${c.sig}${c.ret ? ` -> ${c.ret}` : ''}  ×${c.n}` }));
      if (!c.types) continue;
      for (const p of c.types.params) rows.push(make('code', { className: 'dim', textContent: `  sends ${p.name}: ${p.type} → ${p.label}${bytes(p.size)}` }));
      rows.push(make('code', { className: 'dim', textContent: `  returns ${c.types.ret.type} → ${c.types.ret.label}${bytes(c.types.ret.size)}` }));
    }
    if (l.calls.some((c) => c.types)) rows.push(make('div', { className: 'map-sub', textContent: 'Sizes assume a 64-bit target' }));
    return rows;
  }

  function drawLinks(origin, sx, sy) {
    const nodes = new Map([...ui.kidCol.querySelectorAll('.map-node.file')].map((n) => [n.dataset.id, n]));
    let lane = 0;
    for (const l of tree.links ?? []) {
      const a = nodes.get(l.from);
      const b = nodes.get(l.to);
      if (!a || !b) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const p = { x: ra.right - origin.left + sx, y: ra.top + ra.height / 2 - origin.top + sy };
      const q = { x: rb.right - origin.left + sx, y: rb.top + rb.height / 2 - origin.top + sy };
      const bulge = 70 + lane++ * 22;
      const d = `M${p.x},${p.y} C${p.x + bulge},${p.y} ${q.x + bulge},${q.y} ${q.x + 4},${q.y}`;
      const line = svg('path', { class: 'map-link', d });
      const hit = svg('path', { class: 'map-link-hit', d });
      const tip = svg('circle', { cx: q.x + 4, cy: q.y, r: 4, fill: 'var(--accent)' });
      hit.addEventListener('pointerenter', (ev) => {
        line.classList.add('hot');
        ui.tip.replaceChildren(...describeLink(l, a.querySelector('strong').textContent, b.querySelector('strong').textContent));
        ui.tip.hidden = false;
        moveTip(ev);
      });
      hit.addEventListener('pointermove', moveTip);
      hit.addEventListener('pointerleave', () => { line.classList.remove('hot'); ui.tip.hidden = true; });
      ui.wires.style.pointerEvents = 'none';
      hit.style.pointerEvents = 'stroke';
      ui.wires.append(line, tip, hit);
    }
  }

  function moveTip(ev) {
    const r = ui.stage.getBoundingClientRect();
    ui.tip.style.left = `${ev.clientX - r.left + ui.stage.scrollLeft + 14}px`;
    ui.tip.style.top = `${ev.clientY - r.top + ui.stage.scrollTop + 14}px`;
  }

  async function show(on) {
    visible = on;
    if (on) await refresh();
  }

  function setFolder(path) {
    cwd = path || '';
  }

  function init(d) {
    deps = d;
    root = document.getElementById('map');
    build();
  }

  return { init, show, setFolder, refresh };
})();
