const MONACO_VS = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs';
const AUTOSAVE_MS = 1500;

const LANGS = {
  c: {
    label: 'C', ext: 'c', monaco: 'c', badge: 'C', color: '#4a86c7',
    template: Mesh.examples.c,
  },
  cpp: {
    label: 'C++', ext: 'cpp', monaco: 'cpp', badge: 'C++', color: '#6a5fc7',
    template: Mesh.examples.cpp,
  },
  lua: {
    label: 'Lua', ext: 'lua', monaco: 'lua', badge: 'Lua', color: '#3b4cb8',
    template: Mesh.examples.lua,
  },
  python: {
    label: 'Python', ext: 'py', monaco: 'python', badge: 'Py', color: '#3d7ab8',
    template: Mesh.examples.python,
  },
};

for (const [key, type] of Object.entries(FILE_TYPES)) LANGS[key] = type;
for (const [key, meta] of Object.entries(TYPE_META)) Object.assign(LANGS[key], meta);
const RUNNABLE = new Set(Object.keys(LANGS).filter((k) => LANGS[k].runnable));
const isFlowable = (lang) => Boolean(LANGS[lang]?.flowable);

const $ = (sel) => document.querySelector(sel);
const el = {
  language: $('#language'), configBadge: $('#configBadge'), configName: $('#configName'),
  runBtn: $('#runBtn'), stopBtn: $('#stopBtn'), rerunBtn: $('#rerunBtn'), stopBtn2: $('#stopBtn2'),
  clearBtn: $('#clearBtn'), shareBtn: $('#shareBtn'), treeNewBtn: $('#treeNewBtn'),
  tree: $('#tree'), tabList: $('#tabList'), tabNew: $('#tabNew'),
  editor: $('#editor'), console: $('#console'),
  runBadge: $('#runBadge'), runTab: $('#runTab'), runMeta: $('#runMeta'), statusPath: $('#statusPath'),
  saveState: $('#saveState'), cursorPos: $('#cursorPos'), statusLang: $('#statusLang'), toast: $('#toast'),
};

const state = {
  id: null, tabKey: null, title: 'Untitled', folder: '', language: 'c', dirty: false, gen: 0,
  runId: null, runtimes: {}, sessions: [], folders: [],
};
const collapsedFolders = new Set();

let editor;
let applying = false;
let saveTimer = null;
let saving = null;
let saveAgain = false;

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...Runner.headers() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); if (typeof j.detail === 'string') msg = j.detail; } catch { /* non-JSON */ }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

function uid() {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function svgUse(id, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (cls) svg.setAttribute('class', cls);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

function paintBadge(node, lang) {
  node.textContent = LANGS[lang].badge;
  node.style.background = LANGS[lang].color;
}

function makeBadge(lang) {
  const b = document.createElement('span');
  b.className = 'lang-badge';
  paintBadge(b, lang);
  return b;
}

const fileName = (title = state.title, lang = state.language) => `${title}.${LANGS[lang].ext}`;

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.toast.classList.remove('show'), 2600);
}

function relTime(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const TABS_KEY = 'eide.tabs';
let tabs = [];
let tabSeq = 0;
let renaming = false;
let dragKey = null;

const currentTab = () => tabs.find((t) => t.key === state.tabKey);

function addTab(session = null) {
  const tab = {
    key: `t${++tabSeq}`, id: session?.id ?? null,
    title: session?.title ?? 'Untitled', language: session?.language ?? state.language,
  };
  tabs.push(tab);
  return tab;
}

function syncTab() {
  const tab = currentTab();
  if (tab) Object.assign(tab, { id: state.id, title: state.title, language: state.language });
}

function savedTabs() {
  try { return { ids: [], active: null, ...JSON.parse(localStorage.getItem(TABS_KEY)) }; } catch { return { ids: [], active: null }; }
}

function startRename(label) {
  renaming = true;
  const input = Object.assign(document.createElement('input'), { className: 'title-input', value: state.title, spellcheck: false });
  label.replaceWith(input);
  input.focus();
  input.select();
  const finish = (commit) => {
    if (!renaming) return;
    renaming = false;
    const title = input.value.trim().replace(/\.([A-Za-z0-9]{1,5})$/, (m, ext) => (EXT_LANG[ext.toLowerCase()] ? '' : m)).slice(0, 100) || 'Untitled';
    const old = state.title;
    if (commit && title !== state.title) { state.title = title; markDirty(); }
    renderChrome();
    if (commit && title !== old && state.id) Refactor.offer({ kind: 'file', id: state.id, old, to: title });
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); editor.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); editor.focus(); }
  });
}

function moveTab(key, targetKey, after) {
  const moving = tabs.find((t) => t.key === key);
  if (!moving || key === targetKey) return;
  tabs = tabs.filter((t) => t !== moving);
  const at = tabs.findIndex((t) => t.key === targetKey);
  tabs.splice(at + (after ? 1 : 0), 0, moving);
  renderTabs();
}

function renderTabs() {
  if (renaming) return;
  const dirty = ['modified', 'saving', 'error'].includes(el.saveState.dataset.state);
  const clearDrop = () => el.tabList.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
  el.tabList.replaceChildren(...tabs.map((tab) => {
    const active = tab.key === state.tabKey;
    const node = document.createElement('div');
    node.className = `tab${active ? ' active' : ''}`;
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-selected', String(active));
    node.tabIndex = active ? 0 : -1;
    node.draggable = true;

    const label = Object.assign(document.createElement('span'), { className: 'tab-label', textContent: fileName(tab.title, tab.language) });
    const mark = Object.assign(document.createElement('span'), { className: 'tab-dirty', hidden: !(active && dirty) });
    const close = Object.assign(document.createElement('button'), { type: 'button', className: 'tab-close', title: 'Close (Alt+W)' });
    close.setAttribute('aria-label', `Close ${label.textContent}`);
    close.tabIndex = -1;
    close.append(svgUse('i-close'));
    node.append(makeBadge(tab.language), label, mark, close);

    node.addEventListener('click', () => switchTab(tab.key));
    node.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.key); } });
    node.addEventListener('dblclick', () => { if (active) startRename(label); });
    node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(tab.key); } });
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.key); });

    node.addEventListener('dragstart', (e) => {
      dragKey = tab.key;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tab.key);
      node.classList.add('dragging');
    });
    node.addEventListener('dragend', () => { dragKey = null; node.classList.remove('dragging'); clearDrop(); });
    node.addEventListener('dragover', (e) => {
      if (!dragKey || dragKey === tab.key) return;
      e.preventDefault();
      const r = node.getBoundingClientRect();
      clearDrop();
      node.classList.add(e.clientX > r.left + r.width / 2 ? 'drop-after' : 'drop-before');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-before', 'drop-after'));
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragKey) moveTab(dragKey, tab.key, node.classList.contains('drop-after'));
    });
    return node;
  }));
  el.tabList.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  try { localStorage.setItem(TABS_KEY, JSON.stringify({ ids: tabs.filter((t) => t.id).map((t) => t.id), active: state.id })); } catch { /* storage unavailable */ }
}

async function switchTab(key) {
  const tab = tabs.find((t) => t.key === key);
  if (tab?.id && key !== state.tabKey) await openSession(tab.id);
}

async function closeTab(key) {
  const i = tabs.findIndex((t) => t.key === key);
  if (i < 0) return;
  if (key !== state.tabKey) { tabs.splice(i, 1); renderTabs(); return; }
  await flushSave();
  syncTab();
  tabs.splice(i, 1);
  const next = tabs[i] ?? tabs[i - 1];
  state.tabKey = null;
  if (next?.id) await openSession(next.id);
  else await showEmpty();
}

async function restoreTabs(saved) {
  await refreshTree();
  const known = new Map(state.sessions.map((s) => [s.id, s]));
  const current = currentTab();
  const ordered = saved.ids.filter((id) => known.has(id)).map((id) => (id === current?.id ? current : addTabFrom(known.get(id))));
  if (current && !ordered.includes(current)) ordered.push(current);
  tabs = ordered;
  renderTabs();
}

function addTabFrom(session) {
  return { key: `t${++tabSeq}`, id: session.id, title: session.title, language: session.language };
}

function renderChrome() {
  const lang = LANGS[state.language];
  const name = fileName();
  [el.configBadge, el.runBadge].forEach((b) => paintBadge(b, state.language));
  el.configName.textContent = name;
  el.language.value = state.language;
  el.runTab.textContent = name;
  syncFlowable();
  Qol.visit(state.tabKey);
  el.statusLang.textContent = lang.label;
  document.title = document.body.classList.contains('no-file') ? 'Loopline' : `${name} – Loopline`;

  const parts = [['folder', 'Loopline'], ['folder', 'sessions'], ['file', name]];
  const target = el.statusPath;
  target.replaceChildren();
  parts.forEach(([, text], i) => {
    if (i) target.append(svgUse('i-chevron-right'));
    const crumb = document.createElement('span');
    crumb.className = 'crumb';
    crumb.append(text);
    target.append(crumb);
  });
  syncTab();
  renderTabs();
  renderTree();
}

let forcedText = false;

function syncFlowable() {
  const ok = isFlowable(state.language);
  const flowBtn = document.querySelector('.view-toggle [data-view="flow"]');
  if (flowBtn) { flowBtn.disabled = !ok; flowBtn.title = ok ? 'Flow view (Alt+M)' : 'Flow is not available for this file type'; }
  el.runBtn.disabled = el.rerunBtn.disabled = !RUNNABLE.has(state.language);
  if (!editor) return;
  if (!ok && currentView === 'flow') { forcedText = true; setView('text'); }
  else if (ok && forcedText && currentView === 'text') { forcedText = false; setView('flow'); }
}

function toggleZen(on = !document.body.classList.contains('zen')) {
  document.body.classList.toggle('zen', on);
  if (on) toast('Zen mode: Alt+Z or Esc to leave');
  window.dispatchEvent(new Event('resize'));
}

const SHORTCUTS = [
  ['Ctrl+Tab', 'Cycle tabs, most recent first'], ['Alt+Q', 'Previous tab'], ['Ctrl+D', 'Select next match (multi-cursor)'], ['Alt+Click', 'Add a cursor'],
  ['Ctrl+Shift+F', 'Find in files'], ['Alt+Z', 'Zen mode'], ['Right-click a file or folder', 'Rename, move, duplicate, delete'],
  ['Ctrl+P', 'Go to file'], ['Ctrl+Shift+P', 'Command palette'], ['Ctrl+Shift+O', 'Go to cell'], ['Alt+N', 'New file'], ['Ctrl+S', 'Save'],
  ['Shift+F10', 'Run'], ['Ctrl+F2', 'Stop'], ['Alt+M', 'Cycle Map, Flow, Text'], ['Ctrl+Z / Ctrl+Shift+Z', 'Undo or redo script history'],
  ['Ctrl+= / Ctrl+- / Ctrl+0', 'Editor font size'], ['Alt+W', 'Close tab'], ['F1', 'This list'],
];

function showShortcuts() {
  const body = document.createElement('div');
  body.className = 'sc-list';
  for (const [keys, what] of SHORTCUTS) {
    const row = document.createElement('div');
    row.className = 'sc-row';
    row.append(Object.assign(document.createElement('span'), { textContent: what }), Object.assign(document.createElement('kbd'), { textContent: keys }));
    body.append(row);
  }
  Modal.open({ title: 'Keyboard shortcuts', body, actions: [{ label: 'Done', primary: true }] });
}

function paletteFiles() {
  return state.sessions.map((s) => ({ label: s.title, detail: s.folder || '', run: () => openFromMap(s.id) }));
}

function paletteCommands() {
  const flow = (fn) => () => { setView('flow'); Mesh.actions[fn](); };
  const toggle = (key, label) => ({ label, run: () => Prefs.set(key, !Prefs.get(key)) });
  return [
    { label: 'New file…', keys: 'Alt+N', run: () => newFileDialog() },
    { label: 'New project…', run: () => Projects.open() },
    { label: 'Upload files…', run: () => Projects.importFiles(state.folder || '') },
    { label: 'Upload folder…', run: () => Projects.importFolder() },
    { label: 'Upload zip…', run: () => Projects.importZip() },
    { label: 'Write project to terminal workspace', run: syncProject },
    { label: 'Save', keys: 'Ctrl+S', run: save },
    { label: 'Close tab', keys: 'Alt+W', run: () => closeTab(state.tabKey) },
    { label: 'Switch to previous tab', keys: 'Alt+Q', run: () => { const prev = tabs.find((t) => t.key !== state.tabKey && t.key === Qol.previous?.()); if (prev) switchTab(prev.key); } },
    { label: 'Add missing imports', run: () => Qol.offerImports(false) },
    { label: 'Toggle follow system theme', run: () => Prefs.set('themeSync', !Prefs.get('themeSync')) },
    { label: 'Toggle completion chime', run: () => Prefs.set('chime', !Prefs.get('chime')) },
    { label: 'Find in files', keys: 'Ctrl+Shift+F', run: () => Search.open() },
    { label: 'Toggle zen mode', keys: 'Alt+Z', run: () => toggleZen() },
    { label: 'Rename current file…', run: renameCurrent },
    { label: 'Refactor: rename function everywhere…', run: () => { setView('flow'); Mesh.actions.renameFunction(); } },
    { label: 'Run file', keys: 'Shift+F10', run },
    { label: 'Stop', keys: 'Ctrl+F2', run: stop },
    { label: 'View: Flow', run: () => setView('flow') },
    { label: 'View: Project map', run: () => setView('map') },
    { label: 'View: Text editor', run: () => setView('text') },
    { label: 'Flow: Find a cell', keys: 'Ctrl+F', run: () => { setView('flow'); Palette.open('symbols'); } },
    { label: 'Flow: Export canvas as PNG', run: () => { setView('flow'); Mesh.actions.exportPng(); } },
    { label: 'Flow: Export canvas as SVG', run: () => { setView('flow'); Mesh.actions.exportSvg(); } },
    ...[1, 2, 3, 4].flatMap((n) => [
      { label: `Flow: Go to view bookmark ${n}`, keys: `Ctrl+${n}`, run: () => { setView('flow'); Mesh.actions.bookmarkGo(n); } },
      { label: `Flow: Save view bookmark ${n}`, keys: `Ctrl+Shift+${n}`, run: () => { setView('flow'); Mesh.actions.bookmarkSave(n); } },
    ]),
    toggle('snapGuides', 'Flow: Toggle alignment guides'),
    toggle('fineGrid', 'Flow: Toggle fine snap grid'),
    { label: 'Flow: Execute and replay', run: flow('execute') },
    { label: 'Flow: Step', run: flow('step') },
    { label: 'Flow: Reset replay', run: flow('reset') },
    { label: 'Flow: Fit to screen', run: flow('fit') },
    { label: 'Flow: Auto layout', run: flow('autoLayout') },
    { label: 'Flow: New cell', run: flow('addCell') },
    { label: 'Terminal: New terminal', run: () => Terminals.openLocal() },
    { label: 'Terminal: SSH connection…', run: () => Terminals.openSsh() },
    { label: 'Terminal: Clear remembered output', run: () => { Terminals.clearHistory(); toast('Terminal history cleared'); } },
    toggle('wordWrap', 'Toggle word wrap'),
    toggle('minimap', 'Toggle minimap'),
    toggle('lineNumbers', 'Toggle line numbers'),
    toggle('whitespace', 'Toggle whitespace'),
    toggle('stickyScroll', 'Toggle sticky scroll'),
    toggle('bracketColors', 'Toggle bracket colors'),
    toggle('pulses', 'Toggle run animation'),
    toggle('grid', 'Toggle dot grid'),
    { label: 'Editor: Increase font size', keys: 'Ctrl+=', run: () => Prefs.set('fontSize', Math.min(28, Prefs.get('fontSize') + 1)) },
    { label: 'Editor: Decrease font size', keys: 'Ctrl+-', run: () => Prefs.set('fontSize', Math.max(9, Prefs.get('fontSize') - 1)) },
    { label: 'Editor: Reset font size', keys: 'Ctrl+0', run: () => Prefs.set('fontSize', Prefs.DEFAULTS.fontSize) },
    ...Themes.list().map((t) => ({ label: `Theme: ${t.label}`, run: () => Themes.choose(t.id) })),
    { label: 'Open settings', run: () => document.getElementById('settingsBtn').click() },
    { label: 'Keyboard shortcuts', keys: 'F1', run: showShortcuts },
  ];
}

function setSaveState(kind) {
  const labels = { new: 'New file', modified: 'Modified', saving: 'Saving…', saved: 'Saved', error: 'Save failed' };
  el.saveState.dataset.state = kind;
  el.saveState.textContent = labels[kind];
  $('.tab.active .tab-dirty')?.toggleAttribute('hidden', !(kind === 'modified' || kind === 'saving' || kind === 'error'));
}

function setCode(text) {
  applying = true;
  editor.setValue(text);
  applying = false;
  Timeline.invalidate();
  Mesh.invalidate();
}

function setModelLanguage() {
  monaco.editor.setModelLanguage(editor.getModel(), LANGS[state.language].monaco);
}

function markDirty() {
  state.dirty = true;
  setSaveState('modified');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, AUTOSAVE_MS);
}

function save() {
  clearTimeout(saveTimer);
  if (saving) { saveAgain = true; return saving; }
  if (!state.dirty) return Promise.resolve();

  const model = editor.getModel();
  if (Prefs.get('normalizeEol') && model.getEOL() !== '\n') model.setEOL(monaco.editor.EndOfLineSequence.LF);
  const gen = state.gen;
  const payload = { id: state.id, title: state.title, language: state.language, code: editor.getValue(), layout: Mesh.layout(), folder: state.folder };
  state.dirty = false;
  setSaveState('saving');

  saving = (async () => {
    try {
      const row = await api('POST', '/api/sessions', payload);
      if (gen === state.gen) {
        if (state.id !== row.id) {
          state.id = row.id;
          syncTab();
          renderTabs();
          history.pushState({ id: row.id }, '', `?id=${row.id}`);
        }
        if (!state.dirty) setSaveState('saved');
      }
      refreshTree();
      History.refresh();
    } catch (err) {
      if (gen === state.gen) {
        state.dirty = true;
        setSaveState('error');
        toast(`Couldn't save: ${err.message}`);
      }
    } finally {
      saving = null;
      if (saveAgain) { saveAgain = false; save(); }
    }
  })();
  return saving;
}

async function flushSave() {
  for (let i = 0; i < 3 && (saving || state.dirty); i++) await (saving ?? save());
}

async function newFile({ push = true, language = state.language, folder = '' } = {}) {
  await flushSave();
  syncTab();
  const blank = currentTab() && state.id === null && !state.dirty && editor.getValue().trim() === '';
  state.gen++;
  document.body.classList.remove('no-file');
  Object.assign(state, { id: null, title: 'Untitled', folder, language, dirty: false });
  if (!blank) state.tabKey = addTab().key;
  setModelLanguage();
  Mesh.setLayout(null);
  setCode('');
  setSaveState('new');
  renderChrome();
  History.clear();
  if (push) history.pushState({}, '', location.pathname);
  editor.focus();
}

async function showEmpty() {
  await flushSave();
  state.gen++;
  Object.assign(state, { id: null, tabKey: null, title: 'Untitled', folder: '', dirty: false });
  tabs = [];
  Mesh.setLayout(null);
  setCode('');
  setSaveState('new');
  renderChrome();
  History.clear();
  history.pushState({}, '', location.pathname);
  document.body.classList.add('no-file');
  document.title = 'Loopline';
  renderTree();
}

async function openSession(id, { push = true } = {}) {
  if (id === state.id && !document.body.classList.contains('no-file')) return;
  document.body.classList.remove('no-file');
  await flushSave();
  let session;
  try {
    session = await api('GET', `/api/sessions/${encodeURIComponent(id)}`);
  } catch (err) {
    toast(`Couldn't open session: ${err.message}`);
    if (!push) {
      const all = await api('GET', '/api/sessions').catch(() => null);
      if (all && !all.length) await showEmpty();
      else await newFile({ push: false });
    }
    return;
  }
  const leaving = currentTab();
  if (leaving && leaving.id === null && !state.dirty) tabs = tabs.filter((t) => t !== leaving);
  state.tabKey = (tabs.find((t) => t.id === session.id) ?? addTab(session)).key;
  state.gen++;
  Object.assign(state, { id: session.id, title: session.title, folder: session.folder || '', language: session.language, dirty: false });
  setModelLanguage();
  Mesh.setLayout(session.layout);
  setCode(session.code);
  setSaveState('saved');
  renderChrome();
  History.refresh();
  if (push) history.pushState({ id }, '', `?id=${id}`);
}

function showMenu(x, y, items) {
  document.querySelector('.term-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'term-menu';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    if (item === '-') { menu.append(Object.assign(document.createElement('hr'), { className: 'menu-sep' })); continue; }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'term-menu-item';
    b.append(Object.assign(document.createElement('span'), { textContent: item.label }));
    b.addEventListener('click', () => { menu.remove(); item.run(); });
    menu.append(b);
  }
  Object.assign(menu.style, { left: `${Math.min(x, innerWidth - 240)}px`, top: `${Math.min(y, innerHeight - items.length * 32 - 16)}px` });
  document.body.append(menu);
  const off = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true));
}

async function renameSession(session) {
  const next = await Modal.prompt({ title: 'Rename file', label: 'Name', value: session.title, action: 'Rename' });
  if (!next || next === session.title) return;
  try {
    await api('PUT', `/api/sessions/${encodeURIComponent(session.id)}/title`, { title: next.slice(0, 100) });
  } catch (err) {
    toast(`Couldn't rename: ${err.message}`);
    return;
  }
  const tab = tabs.find((t) => t.id === session.id);
  if (tab) tab.title = next.slice(0, 100);
  if (session.id === state.id) { state.title = next.slice(0, 100); renderChrome(); }
  renderTabs();
  refreshTree();
  ProjectMap.refresh?.();
  await Refactor.offer({ kind: 'file', id: session.id, old: session.title, to: next.slice(0, 100) });
}

async function renameCurrent() {
  if (state.id) return renameSession({ id: state.id, title: state.title });
  const next = await Modal.prompt({ title: 'Rename file', label: 'Name', value: state.title, action: 'Rename' });
  if (!next) return;
  state.title = next.slice(0, 100);
  markDirty();
  renderChrome();
  renderTabs();
}

async function duplicateSession(session) {
  try {
    const full = await api('GET', `/api/sessions/${encodeURIComponent(session.id)}`);
    const copy = await api('POST', '/api/sessions', { title: `${session.title} copy`.slice(0, 100), language: full.language, code: full.code, folder: full.folder || '' });
    await refreshTree();
    openFromMap(copy.id, Prefs.get('openAs'));
  } catch (err) {
    toast(`Couldn't duplicate: ${err.message}`);
  }
}

async function moveSession(session) {
  const path = await Modal.prompt({ title: 'Move file', label: 'Folder path (empty for the top level)', value: session.folder || '', action: 'Move' });
  if (path === null) return;
  try {
    await api('PUT', `/api/sessions/${encodeURIComponent(session.id)}/folder`, { path });
  } catch (err) {
    toast(`Couldn't move: ${err.message}`);
    return;
  }
  if (session.id === state.id) state.folder = path.replace(/^\/+|\/+$/g, '');
  refreshTree();
  ProjectMap.refresh?.();
}

async function renameFolder(path) {
  const parts = path.split('/');
  const next = await Modal.prompt({ title: 'Rename folder', label: 'Folder name', value: parts.at(-1), action: 'Rename' });
  if (!next || next === parts.at(-1)) return;
  const dst = [...parts.slice(0, -1), next].join('/');
  try {
    await api('PUT', '/api/folders', { src: path, dst });
  } catch (err) {
    toast(`Couldn't rename: ${err.message}`);
    return;
  }
  if (state.folder === path || state.folder.startsWith(`${path}/`)) state.folder = dst + state.folder.slice(path.length);
  refreshTree();
  ProjectMap.refresh?.();
}

async function deleteFolder(path) {
  const ok = await Modal.confirm({ title: 'Delete folder', message: `Delete "${path}" and every file inside it? This cannot be undone.`, action: 'Delete' });
  if (!ok) return;
  try {
    await api('DELETE', `/api/folders?path=${encodeURIComponent(path)}&force=true`);
  } catch (err) {
    toast(`Couldn't delete: ${err.message}`);
    return;
  }
  await refreshTree();
  const alive = new Set(state.sessions.map((s) => s.id));
  tabs = tabs.filter((t) => !t.id || alive.has(t.id));
  if (state.id && !alive.has(state.id)) {
    state.dirty = false;
    state.tabKey = null;
    const next = tabs.at(-1);
    if (next?.id) await openSession(next.id);
    else await showEmpty();
  }
  renderTabs();
  ProjectMap.refresh?.();
}

function sessionMenu(e, s) {
  e.preventDefault();
  showMenu(e.clientX, e.clientY, [
    { label: 'Open as Flow', run: () => openFromMap(s.id, 'flow') },
    { label: 'Open as text', run: () => openFromMap(s.id, 'text') },
    '-',
    { label: 'Rename…', run: () => renameSession(s) },
    { label: 'Duplicate', run: () => duplicateSession(s) },
    { label: 'Move to folder…', run: () => moveSession(s) },
    '-',
    { label: 'Delete', run: () => deleteSession(s) },
  ]);
}

function unsavedMenu(e) {
  e.preventDefault();
  showMenu(e.clientX, e.clientY, [
    { label: 'Rename…', run: renameCurrent },
    { label: 'Close', run: () => closeTab(state.tabKey) },
  ]);
}

function importMenu(x, y, folder = '') {
  showMenu(x, y, [
    { label: folder ? `Upload files into ${folder.split('/').pop()}…` : 'Upload files…', run: () => Projects.importFiles(folder) },
    { label: 'Upload folder…', run: () => Projects.importFolder() },
    { label: 'Upload zip…', run: () => Projects.importZip() },
    '-',
    { label: 'Or drag files, folders or a zip anywhere in the window', run: () => {} },
  ]);
}

function importMenuAt(e, folder) {
  const box = e.currentTarget.getBoundingClientRect();
  importMenu(box.left, box.bottom + 4, folder);
}

function folderMenu(e, path) {
  e.preventDefault();
  showMenu(e.clientX, e.clientY, [
    { label: 'New file here…', run: () => newFileDialog(path) },
    { label: 'Upload files here…', run: () => Projects.importFiles(path) },
    { label: 'Open in project map', run: () => { ProjectMap.setFolder(path); setView('map'); } },
    '-',
    { label: 'Rename…', run: () => renameFolder(path) },
    { label: 'Delete', run: () => deleteFolder(path) },
  ]);
}

async function deleteSession(session) {
  const ok = await Modal.confirm({ title: 'Delete file', message: `Delete "${fileName(session.title, session.language)}"? This cannot be undone.`, action: 'Delete' });
  if (!ok) return;
  try {
    await api('DELETE', `/api/sessions/${encodeURIComponent(session.id)}`);
  } catch (err) {
    toast(`Couldn't delete: ${err.message}`);
    return;
  }
  tabs = tabs.filter((t) => t.id !== session.id);
  if (session.id === state.id) {
    state.dirty = false;
    state.tabKey = null;
    const next = tabs.at(-1);
    if (next?.id) await openSession(next.id);
    else await showEmpty();
  }
  refreshTree();
}

async function refreshTree() {
  try { [state.sessions, state.folders] = await Promise.all([api('GET', '/api/sessions'), api('GET', '/api/folders')]); } catch { /* keep previous list */ }
  renderTree();
}

function treeRow(depth, content, { active = false, onClick, onMenu } = {}) {
  const row = document.createElement('div');
  row.className = 'tree-row' + (active ? ' active' : '');
  row.setAttribute('role', 'treeitem');
  row.style.setProperty('--depth', depth);
  row.append(...content);
  if (onClick) row.addEventListener('click', onClick);
  if (onMenu) row.addEventListener('contextmenu', onMenu);
  return row;
}

function renderTree() {
  const rows = [];
  const rootName = document.createElement('span');
  rootName.className = 'name';
  rootName.textContent = 'Loopline';
  const rootPath = document.createElement('span');
  rootPath.className = 'root-path';
  rootPath.textContent = '~/sessions';
  rows.push(treeRow(0, [svgUse('i-chevron', 'twisty'), svgUse('i-folder-fill'), rootName, rootPath]));

  const entries = state.sessions.map((s) => (s.id === state.id ? { ...s, title: state.title, language: state.language, folder: state.folder } : s));
  if (!state.id && !document.body.classList.contains('no-file')) entries.unshift({ id: null, title: state.title, language: state.language, folder: state.folder, updated_at: null });

  const folders = [...new Set([...entries.map((s) => s.folder), ...state.folders].flatMap((path) => {
    const parts = path ? path.split('/') : [];
    return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  }))].sort();
  const hidden = (path) => path.split('/').slice(0, -1).some((_, i, all) => collapsedFolders.has(all.slice(0, i + 1).join('/')));
  const ordered = [
    ...entries.filter((s) => !s.folder).map((s) => ({ s, depth: 1 })),
    ...folders.flatMap((f) => [
      { folder: f, depth: f.split('/').length },
      ...entries.filter((s) => s.folder === f).map((s) => ({ s, depth: f.split('/').length + 1 })),
    ]),
  ];
  for (const item of ordered) {
    if (item.folder ? hidden(item.folder) : item.s.folder && (collapsedFolders.has(item.s.folder) || hidden(item.s.folder))) continue;
    if (item.folder) {
      const label = document.createElement('span');
      label.className = 'name';
      label.textContent = item.folder.split('/').pop();
      const closed = collapsedFolders.has(item.folder);
      const twisty = svgUse(closed ? 'i-chevron-right' : 'i-chevron', 'twisty');
      twisty.addEventListener('click', (e) => {
        e.stopPropagation();
        if (closed) collapsedFolders.delete(item.folder);
        else collapsedFolders.add(item.folder);
        renderTree();
      });
      const folderRow = treeRow(item.depth, [twisty, svgUse('i-folder-fill'), label], {
        onClick: () => { ProjectMap.setFolder(item.folder); setView('map'); },
        onMenu: (e) => folderMenu(e, item.folder),
      });
      folderRow.dataset.folder = item.folder;
      rows.push(folderRow);
      continue;
    }
    const { s, depth } = item;
    const active = s.id === state.id;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = fileName(s.title, s.language);
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = s.updated_at ? relTime(s.updated_at) : 'unsaved';
    const parts = [makeBadge(s.language), name, meta];
    if (s.id) {
      const del = document.createElement('button');
      del.className = 'icon-btn sm row-del';
      del.title = 'Delete';
      del.append(svgUse('i-trash'));
      del.addEventListener('click', (e) => { e.stopPropagation(); deleteSession(s); });
      parts.push(del);
    }
    rows.push(treeRow(depth, parts, { active, onMenu: s.id ? (e) => sessionMenu(e, s) : unsavedMenu, onClick: s.id ? () => openSession(s.id).then(() => { if (currentView === 'map') setView(Prefs.get('openAs') === 'text' ? 'text' : 'flow'); }) : undefined }));
  }
  if (!entries.length && !folders.length) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.textContent = 'No files yet';
    rows.push(empty);
  }
  el.tree.replaceChildren(...rows);
}

function consoleWrite(text, cls) {
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text.endsWith('\n') ? text : `${text}\n`;
  el.console.append(span);
  el.console.scrollTop = el.console.scrollHeight;
}

function setRunning(running) {
  document.body.classList.toggle('running', running);
  el.stopBtn.disabled = el.stopBtn2.disabled = !running;
}

async function run() {
  if (state.runId) return;
  if (document.body.classList.contains('no-file')) { toast('Create a file first'); return; }
  Workspace.show('console');
  Terminals.showRun();
  if (state.language === 'http') {
    el.console.replaceChildren();
    el.runMeta.textContent = 'Sending…';
    await Qol.runHttp(editor.getValue(), consoleWrite);
    el.runMeta.textContent = '';
    return;
  }
  if (!RUNNABLE.has(state.language)) {
    el.console.replaceChildren();
    consoleWrite(`${LANGS[state.language].label} files can't be run from the editor yet.`, 'c-err');
    consoleWrite('Open a terminal from the + menu to run it with your own tools.', 'c-hint');
    return;
  }
  const runId = uid();
  state.runId = runId;
  setRunning(true);
  el.console.replaceChildren();
  el.runTab.textContent = fileName();
  el.runMeta.textContent = 'Running…';

  try {
    const result = await api('POST', '/api/run', { run_id: runId, language: state.language, code: editor.getValue(), runner: Runner.id(), id: state.id });
    renderRun(result);
  } catch (err) {
    consoleWrite(`Run failed: ${err.message}`, 'c-err');
    el.runMeta.textContent = '';
  } finally {
    state.runId = null;
    setRunning(false);
  }
}

function richNode(item) {
  if (item.type === 'image') {
    const img = document.createElement('img');
    img.className = 'rich-img';
    img.alt = 'Chart produced by your program';
    img.src = `data:image/png;base64,${item.data}`;
    return img;
  }
  const wrap = document.createElement('div');
  wrap.className = 'rich-table';
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const c of item.columns) head.append(Object.assign(document.createElement('th'), { textContent: c }));
  const body = table.createTBody();
  for (const row of item.rows) {
    const tr = body.insertRow();
    for (const v of row) {
      const td = tr.insertCell();
      td.textContent = v === null ? 'NaN' : String(v);
      if (typeof v === 'number') td.className = 'num';
    }
  }
  wrap.append(table);
  if (item.n > item.rows.length) wrap.append(Object.assign(document.createElement('div'), { className: 'rich-note', textContent: `Showing ${item.rows.length} of ${item.n} rows` }));
  return wrap;
}

function renderRun(r) {
  if (r.error) {
    consoleWrite(r.error, 'c-err');
    consoleWrite('Install the toolchain or run this language on the Replit host.', 'c-hint');
    el.runMeta.textContent = '';
    return;
  }
  for (const step of r.steps) {
    consoleWrite(step.command, 'c-cmd');
    if (step.stdout) consoleWrite(step.stdout);
    if (step.stderr) consoleWrite(step.stderr, 'c-err');
  }
  if (r.truncated) consoleWrite('[output truncated]', 'c-dim');
  for (const item of r.rich ?? []) el.console.append(richNode(item));
  el.console.append('\n');
  const compileFailed = r.steps.length === 1 && r.steps[0].phase === 'compile' && r.exit_code !== 0;
  if (r.stopped) consoleWrite('Process stopped', 'c-dim');
  else if (r.timed_out) consoleWrite(`Process terminated: exceeded the ${r.time_limit}s time limit`, 'c-err');
  else if (compileFailed) consoleWrite(`Build failed with exit code ${r.exit_code}`, 'c-err');
  else consoleWrite(`Process finished with exit code ${r.exit_code}`, 'c-dim');
  el.runMeta.textContent = `${r.duration_ms} ms`;
  Qol.runDone(r, { remote: Runner.id() !== 'server' });
}

function stop() {
  if (state.runId) api('POST', `/api/run/${state.runId}/stop`).catch(() => {});
}

async function share() {
  if (!state.id) markDirty();
  await flushSave();
  if (!state.id) return;
  try {
    await navigator.clipboard.writeText(location.href);
    toast('Share link copied to clipboard');
  } catch {
    toast(location.href);
  }
}

const EXT_LANG = Object.fromEntries(Object.entries(LANGS).flatMap(([key, lang]) => lang.exts.map((ext) => [ext, key])));

async function reloadCurrent() {
  const session = await api('GET', `/api/sessions/${state.id}`);
  state.gen++;
  Object.assign(state, { title: session.title, language: session.language, dirty: false });
  setModelLanguage();
  setCode(session.code);
  setSaveState('saved');
  renderChrome();
  refreshTree();
}

async function importFile(name, code) {
  const dot = name.lastIndexOf('.');
  const language = EXT_LANG[dot > 0 ? name.slice(dot + 1).toLowerCase() : ''];
  if (!language) { toast(`Can't open ${name}. Its file type isn't supported.`); return false; }
  await newFile({ language });
  state.title = name.slice(0, dot).slice(0, 100) || 'Untitled';
  setCode(code);
  markDirty();
  renderChrome();
  return true;
}

function bindUi() {
  const groups = new Map();
  for (const [key, lang] of Object.entries(LANGS)) {
    if (!groups.has(lang.group)) groups.set(lang.group, Object.assign(document.createElement('optgroup'), { label: lang.group }));
    groups.get(lang.group).append(new Option(lang.label, key));
  }
  el.language.append(...groups.values());

  el.language.addEventListener('change', () => {
    const next = el.language.value;
    const untouched = editor.getValue().trim() === '';
    state.language = next;
    setModelLanguage();
    if (state.id || !untouched) markDirty();
    renderChrome();
    editor.focus();
  });

  el.runBtn.addEventListener('click', run);
  el.rerunBtn.addEventListener('click', run);
  el.stopBtn.addEventListener('click', stop);
  el.stopBtn2.addEventListener('click', stop);
  el.clearBtn.addEventListener('click', () => { el.console.replaceChildren(); el.runMeta.textContent = ''; });
  el.shareBtn.addEventListener('click', share);
  el.tabNew.addEventListener('click', () => newFileDialog());
  $('#welcomeNew').addEventListener('click', () => newFileDialog());
  Examples.render($('#welcomeExamples'), openExample);
  $('#welcomeProject').addEventListener('click', () => Projects.open());
  $('#welcomeImport').addEventListener('click', () => Projects.importFolder());
  $('#welcomeFiles').addEventListener('click', () => Projects.importFiles(''));
  $('#welcomeZip').addEventListener('click', () => Projects.importZip());
  el.treeNewBtn.addEventListener('click', () => newFileDialog());
  $('#treeImportBtn').addEventListener('click', (e) => importMenuAt(e, state.folder || ''));

  Workspace.bind();
  Settings.init();

  window.addEventListener('keydown', (e) => {
    if (e.shiftKey && e.key === 'F10') { e.preventDefault(); run(); }
    else if (e.ctrlKey && e.key === 'F2') { e.preventDefault(); stop(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); Plugins.beforeSave().then(save); }
    else if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newFileDialog(); }
    else if ((e.ctrlKey || e.metaKey) && !e.altKey && ['=', '+', '-', '0'].includes(e.key)) {
      e.preventDefault();
      const size = e.key === '0' ? Prefs.DEFAULTS.fontSize : Math.min(28, Math.max(9, Prefs.get('fontSize') + (e.key === '-' ? -1 : 1)));
      Prefs.set('fontSize', size);
    }
    else if (e.key === 'F1') { e.preventDefault(); showShortcuts(); }
    else if (e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); toggleZen(); }
    else if (e.key === 'Escape' && document.body.classList.contains('zen') && ![...document.querySelectorAll('.palette')].some((p) => !p.hidden)) toggleZen(false);
    else if (e.altKey && e.key.toLowerCase() === 'w') { e.preventDefault(); closeTab(state.tabKey); }
  });

  window.addEventListener('popstate', () => {
    const id = new URLSearchParams(location.search).get('id');
    if (id) openSession(id, { push: false });
    else if (state.id) newFile({ push: false });
  });

  window.addEventListener('pagehide', () => {
    if (!state.dirty) return;
    fetch('/api/sessions', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: state.id, title: state.title, language: state.language, code: editor.getValue(), layout: Mesh.layout(), folder: state.folder }),
    });
  });

  setInterval(renderTree, 60_000);
}

async function loadRuntimes() {
  try {
    state.runtimes = await api('GET', '/api/runtimes');
  } catch {
    return;
  }
  for (const opt of el.language.options) {
    const missing = state.runtimes[opt.value] === false;
    opt.textContent = LANGS[opt.value].label + (missing ? ' (not installed)' : '');
  }
}

function applyMeshCode(text) {
  const model = editor.getModel();
  const before = model.getValue();
  if (before === text) return;
  const max = Math.min(before.length, text.length);
  let start = 0;
  while (start < max && before[start] === text[start]) start++;
  let end = 0;
  while (end < max - start && before[before.length - 1 - end] === text[text.length - 1 - end]) end++;
  const from = model.getPositionAt(start);
  const to = model.getPositionAt(before.length - end);
  editor.pushUndoStop();
  editor.executeEdits('mesh', [{ range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column), text: text.slice(start, text.length - end) }]);
  editor.pushUndoStop();
}

function stepHistory(direction) {
  editor.trigger('history', direction, null);
}

function meshOutput({ kind, result }) {
  Workspace.show('console');
  el.console.replaceChildren();
  el.runTab.textContent = fileName();
  if (kind === 'run') { renderRun(result); return; }
  const trace = result.trace;
  if (trace?.stdout) consoleWrite(trace.stdout);
  if (result.stderr) consoleWrite(result.stderr, 'c-err');
  if (result.error) consoleWrite(result.error, 'c-err');
  consoleWrite(`Process finished with exit code ${result.exit_code}`, 'c-dim');
  el.runMeta.textContent = `${result.duration_ms} ms`;
  Qol.runDone(result, { remote: Runner.id() !== 'server' });
}

let currentView = 'flow';

function setView(view) {
  currentView = view;
  $('[data-panel="editor"]').classList.toggle('mesh-mode', view !== 'text');
  el.editor.hidden = view !== 'text';
  $('#mesh').hidden = view !== 'flow';
  $('#map').hidden = view !== 'map';
  for (const b of document.querySelectorAll('.view-toggle button')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  Mesh.show(view === 'flow');
  if (view === 'map') ProjectMap.setFolder(state.folder);
  ProjectMap.show(view === 'map');
  if (view === 'text') editor.layout();
}

function applySwitchPref() {
  document.querySelector('.view-toggle').hidden = !Prefs.get('showSwitch');
}

function bindViews() {
  for (const b of document.querySelectorAll('.view-toggle button')) b.addEventListener('click', () => setView(b.dataset.view));
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && currentView !== 'text' && !e.altKey && !e.target.closest('input, textarea, .monaco-editor')) {
      const key = e.key.toLowerCase();
      if (key === 'z') { e.preventDefault(); stepHistory(e.shiftKey ? 'redo' : 'undo'); return; }
      if (key === 'y') { e.preventDefault(); stepHistory('redo'); return; }
    }
    if (!e.altKey) return;
    if (e.code === 'KeyM') { e.preventDefault(); setView(currentView === 'text' ? 'flow' : 'text'); }
    if (e.code === 'KeyP') { e.preventDefault(); setView(currentView === 'map' ? 'flow' : 'map'); }
  });
  Prefs.on((key) => { if (key === 'showSwitch') applySwitchPref(); });
  applySwitchPref();
  setView(Prefs.get('defaultView'));
}

function openFromMap(id, as) {
  const target = as === 'text' ? 'text' : 'flow';
  return openSession(id).then(() => setView(target));
}

async function syncProject() {
  const folder = state.folder.split('/')[0];
  if (!folder) { toast('Open a file inside a project folder first'); return; }
  try {
    const res = await api('POST', '/api/workspace/sync', { folder });
    toast(`Wrote ${res.files} files to ${res.path}`);
  } catch (err) {
    toast(err.message);
  }
}

async function newFileDialog(folder = state.folder) {
  const picked = await NewFile.open({ types: LANGS, folder });
  if (!picked) return;
  if (picked.kind === 'project') { await Projects.open(); return; }
  if (picked.kind === 'folder') {
    try { await api('POST', '/api/folders', { path: folder ? `${folder}/${picked.name}` : picked.name }); } catch (err) { toast(err.message); return; }
    await refreshTree();
    ProjectMap.refresh?.();
    return;
  }
  await newFile({ language: picked.type, folder });
  state.title = picked.name.slice(0, 100);
  markDirty();
  renderChrome();
  if (currentView === 'map') setView(Prefs.get('openAs') === 'text' || !isFlowable(picked.type) ? 'text' : 'flow');
}

async function openExample(ex) {
  await newFile({ language: ex.language });
  setCode(ex.code);
  state.title = ex.name;
  markDirty();
  renderChrome();
  Workspace.show('viz', true);
}

async function newFileIn(folder) {
  await newFileDialog(folder);
}

function initEditor() {
  Themes.defineMonaco();
  Completions.register();
  editor = monaco.editor.create(el.editor, {
    model: monaco.editor.createModel('', 'c'),
    theme: `eide-${Themes.current()}`,
    automaticLayout: true,
    fontFamily: "'JetBrains Mono', Consolas, monospace",
    fontSize: Prefs.get('fontSize'),
    lineHeight: 22,
    fontLigatures: Prefs.get('ligatures'),
    tabSize: Prefs.get('tabSize'),
    insertSpaces: true,
    wordWrap: Prefs.get('wordWrap') ? 'on' : 'off',
    lineNumbers: Prefs.get('lineNumbers') ? 'on' : 'off',
    renderWhitespace: Prefs.get('whitespace') ? 'all' : 'none',
    minimap: { enabled: Prefs.get('minimap') },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    renderLineHighlight: 'all',
    lineNumbersMinChars: 4,
    glyphMargin: false,
    folding: true,
    showFoldingControls: 'mouseover',
    guides: { indentation: true, bracketPairs: false },
    bracketPairColorization: { enabled: Prefs.get('bracketColors') },
    stickyScroll: { enabled: Prefs.get('stickyScroll') },
    padding: { top: 10, bottom: 10 },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
  });

  Prefs.on((key) => {
    const opts = {
      fontSize: () => ({ fontSize: Prefs.get('fontSize') }),
      ligatures: () => ({ fontLigatures: Prefs.get('ligatures') }),
      tabSize: () => ({ tabSize: Prefs.get('tabSize') }),
      wordWrap: () => ({ wordWrap: Prefs.get('wordWrap') ? 'on' : 'off' }),
      lineNumbers: () => ({ lineNumbers: Prefs.get('lineNumbers') ? 'on' : 'off' }),
      whitespace: () => ({ renderWhitespace: Prefs.get('whitespace') ? 'all' : 'none' }),
      minimap: () => ({ minimap: { enabled: Prefs.get('minimap') } }),
      stickyScroll: () => ({ stickyScroll: { enabled: Prefs.get('stickyScroll') } }),
      bracketColors: () => ({ bracketPairColorization: { enabled: Prefs.get('bracketColors') } }),
    }[key];
    if (opts) editor.updateOptions(opts());
  });

  editor.onDidChangeModelContent(() => {
    if (applying) return;
    markDirty();
    Timeline.invalidate();
    Mesh.invalidate();
  });
  editor.onDidChangeCursorPosition(({ position }) => {
    el.cursorPos.textContent = `${position.lineNumber}:${position.column}`;
  });
  IndentColors.init(editor);
  editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F10, run);
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F2, stop);
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => { await Plugins.beforeSave(); save(); });
  editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyN, () => newFileDialog());

  document.fonts?.ready.then(() => monaco.editor.remeasureFonts());
}

function init() {
  initEditor();
  bindUi();
  el.tree.addEventListener('contextmenu', (e) => e.preventDefault());
  History.init({ editor: () => editor, id: () => state.id, dirty: () => state.dirty, api, toast, reload: reloadCurrent });
  Plugins.init({ editor: () => editor, api, toast });
  Runner.init({ api, toast });
  GitHub.init({ code: () => editor.getValue(), name: () => fileName(), importFile, toast });
  Timeline.init({ editor: () => editor, language: () => state.language, code: () => editor.getValue(), api, toast, uid });
  Visualizer.init({
    editor: () => editor,
    sessionId: () => state.id,
    language: () => state.language,
    code: () => editor.getValue(),
    setCode,
    api,
    toast,
    uid,
    runTrace: () => Timeline.runTrace?.(),
  });
  Mesh.init({
    api, toast, uid, openFile: openFromMap, history: stepHistory, sessionId: () => state.id, code: () => editor.getValue(), language: () => state.language, monacoLanguage: () => LANGS[state.language].monaco,
    refactor: (req) => (state.id ? Refactor.offer({ ...req, id: state.id }) : null), runner: () => Runner.id(), applyCode: applyMeshCode, touch: () => { if (state.id || state.dirty) markDirty(); }, output: meshOutput,
  });
  ProjectMap.init({
    api, toast, relTime, open: openFromMap, newFile: newFileIn, importMenu: importMenuAt,
    moved: (id, folder) => { if (id === state.id) state.folder = folder; },
  });
  Terminals.init();
  Qol.init({
    tabs: () => tabs, state, switchTab, editor: () => editor, api, toast, extToLang: (ext) => EXT_LANG[ext],
    refresh: refreshTree, open: (id) => openFromMap(id, Prefs.get('openAs')), dropped: (transfer, folder) => Projects.dropped(transfer, folder),
  });
  Projects.init({ api, toast, refresh: refreshTree, openSession, extToLang: (ext) => EXT_LANG[ext], folders: () => state.folders });
  Refactor.init({ api, toast, applied: () => { refreshTree(); ProjectMap.refresh?.(); } });
  Search.init({
    api,
    restoreFocus: () => { if (currentView === 'text') editor.focus(); },
    openAt: async (h) => {
      await openSession(h.id);
      setView('text');
      editor.setSelection(new monaco.Range(h.line, h.col, h.line, h.col + h.len));
      editor.revealLineInCenter(h.line);
      editor.focus();
    },
  });
  Palette.init({
    commands: paletteCommands,
    files: paletteFiles,
    symbols: () => Mesh.nodes().map((n) => ({ label: n.name, detail: n.sig, run: () => { setView('flow'); Mesh.reveal(n.id); } })),
    restoreFocus: () => { if (currentView === 'text') editor.focus(); },
  });
  bindViews();
  loadRuntimes();
  refreshTree();
  consoleWrite('Press Shift+F10 to run the current file.', 'c-hint');

  const saved = savedTabs();
  const id = new URLSearchParams(location.search).get('id') ?? saved.active;
  const opened = id ? openSession(id, { push: false }) : api('GET', '/api/sessions').then((all) => (all.length ? newFile({ push: false }) : showEmpty()), () => newFile({ push: false }));
  opened.then(() => {
    if (id && state.id === id) history.replaceState({ id }, '', `?id=${id}`);
    return restoreTabs(saved);
  });
}

window.MonacoEnvironment = {
  getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(
    `self.MonacoEnvironment={baseUrl:'${MONACO_VS}/../'};importScripts('${MONACO_VS}/base/worker/workerMain.js');`,
  )}`,
};
require.config({ paths: { vs: MONACO_VS } });
require(['vs/editor/editor.main'], init);
