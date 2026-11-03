const Palette = (() => {
  let deps = null;
  let root = null;
  let input = null;
  let list = null;
  let hint = null;
  let items = [];
  let active = 0;
  let mode = 'files';

  const MODES = {
    files: { prefix: '', placeholder: 'Go to file…   > commands   @ cells', hint: 'Files' },
    commands: { prefix: '>', placeholder: 'Run a command…', hint: 'Commands' },
    symbols: { prefix: '@', placeholder: 'Go to cell…', hint: 'Cells' },
  };

  function score(text, query) {
    if (!query) return 1;
    const t = text.toLowerCase();
    const q = query.toLowerCase();
    const at = t.indexOf(q);
    if (at >= 0) return 100 - at + (at === 0 ? 20 : 0);
    let ti = 0;
    let s = 0;
    for (const ch of q) {
      const next = t.indexOf(ch, ti);
      if (next < 0) return 0;
      s += next === ti ? 3 : 1;
      ti = next + 1;
    }
    return s;
  }

  function source() {
    if (mode === 'commands') return deps.commands();
    if (mode === 'symbols') return deps.symbols();
    return deps.files();
  }

  function render() {
    const query = input.value.slice(MODES[mode].prefix.length).trim();
    items = source()
      .map((it) => ({ it, s: score(`${it.label} ${it.detail ?? ''}`, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.it);
    active = Math.min(active, Math.max(items.length - 1, 0));
    hint.textContent = MODES[mode].hint;
    list.replaceChildren(...items.map((it, i) => {
      const row = document.createElement('div');
      row.className = `pal-row${i === active ? ' active' : ''}`;
      row.setAttribute('role', 'option');
      const label = document.createElement('span');
      label.className = 'pal-label';
      label.textContent = it.label;
      row.append(label);
      if (it.detail) row.append(Object.assign(document.createElement('span'), { className: 'pal-detail', textContent: it.detail }));
      if (it.keys) row.append(Object.assign(document.createElement('kbd'), { textContent: it.keys }));
      row.addEventListener('pointermove', () => { if (active !== i) { active = i; paintActive(); } });
      row.addEventListener('click', () => choose(i));
      return row;
    }));
    if (!items.length) list.append(Object.assign(document.createElement('div'), { className: 'pal-empty', textContent: 'No matches' }));
  }

  function paintActive() {
    [...list.children].forEach((c, i) => c.classList.toggle('active', i === active));
    list.children[active]?.scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    const it = items[i];
    if (!it) return;
    close();
    it.run();
  }

  function open(next = 'files') {
    mode = next;
    root.hidden = false;
    input.value = MODES[mode].prefix;
    input.placeholder = MODES[mode].placeholder;
    active = 0;
    render();
    input.focus();
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    deps.restoreFocus?.();
  }

  function onInput() {
    const v = input.value;
    const next = v.startsWith('>') ? 'commands' : v.startsWith('@') ? 'symbols' : 'files';
    if (next !== mode) { mode = next; input.placeholder = MODES[mode].placeholder; active = 0; }
    render();
  }

  function build() {
    root = document.createElement('div');
    root.className = 'palette';
    root.hidden = true;
    input = Object.assign(document.createElement('input'), { type: 'text', className: 'pal-input', spellcheck: false, autocomplete: 'off' });
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-label', 'Command palette');
    hint = Object.assign(document.createElement('span'), { className: 'pal-hint' });
    list = Object.assign(document.createElement('div'), { className: 'pal-list', role: 'listbox' });
    const head = document.createElement('div');
    head.className = 'pal-head';
    head.append(input, hint);
    const box = document.createElement('div');
    box.className = 'pal-box';
    box.append(head, list);
    root.append(box);
    document.body.append(root);
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); paintActive(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); paintActive(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  }

  function init(d) {
    deps = d;
    build();
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'p' && e.shiftKey) { e.preventDefault(); open('commands'); }
      else if (key === 'p') { e.preventDefault(); open('files'); }
      else if (key === 'o' && e.shiftKey) { e.preventDefault(); open('symbols'); }
    }, true);
  }

  return { init, open };
})();
