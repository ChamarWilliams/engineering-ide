const Search = (() => {
  let deps = null;
  let root = null;
  let input = null;
  let list = null;
  let summary = null;
  let timer = null;
  let token = 0;
  let hits = [];
  let active = 0;
  const flags = { case: false, word: false, regex: false };

  const make = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat());
    return n;
  };

  function mark(text, query) {
    if (!query) return [text];
    let rx;
    try { rx = new RegExp(flags.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags.case ? 'g' : 'gi'); } catch { return [text]; }
    const out = [];
    let last = 0;
    for (const m of text.matchAll(rx)) {
      if (!m[0]) break;
      out.push(text.slice(last, m.index), make('mark', { textContent: m[0] }));
      last = m.index + m[0].length;
    }
    out.push(text.slice(last));
    return out;
  }

  function render(query) {
    const rows = [];
    let lastId = null;
    hits.forEach((h, i) => {
      if (h.id !== lastId) {
        lastId = h.id;
        rows.push(make('div', { className: 'srch-file' }, make('strong', { textContent: h.title }), make('span', { textContent: h.folder || '' })));
      }
      const row = make('div', { className: `pal-row srch-hit${i === active ? ' active' : ''}` },
        make('span', { className: 'srch-line', textContent: String(h.line) }), make('span', { className: 'pal-label' }, ...mark(h.text, query)));
      row.addEventListener('pointermove', () => { if (active !== i) { active = i; paint(); } });
      row.addEventListener('click', () => choose(i));
      row.dataset.i = i;
      rows.push(row);
    });
    list.replaceChildren(...rows);
  }

  function paint() {
    list.querySelectorAll('.srch-hit').forEach((r) => r.classList.toggle('active', Number(r.dataset.i) === active));
    list.querySelector('.srch-hit.active')?.scrollIntoView({ block: 'nearest' });
  }

  async function run() {
    const query = input.value;
    const mine = ++token;
    if (!query) { hits = []; list.replaceChildren(); summary.textContent = 'Search across every file'; return; }
    try {
      const params = new URLSearchParams({ q: query, case: flags.case, word: flags.word, regex: flags.regex });
      const res = await deps.api('GET', `/api/search?${params}`);
      if (mine !== token) return;
      hits = res.hits;
      active = 0;
      summary.textContent = res.hits.length ? `${res.hits.length}${res.truncated ? '+' : ''} matches in ${res.files} files` : 'No matches';
      render(query);
    } catch (err) {
      if (mine === token) { hits = []; list.replaceChildren(); summary.textContent = err.message; }
    }
  }

  function choose(i) {
    const h = hits[i];
    if (!h) return;
    close();
    deps.openAt(h);
  }

  function open(seed) {
    root.hidden = false;
    if (seed) input.value = seed;
    input.focus();
    input.select();
    run();
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    deps.restoreFocus?.();
  }

  function build() {
    root = make('div', { className: 'palette', hidden: true });
    input = make('input', { type: 'text', className: 'pal-input', placeholder: 'Find in all files', spellcheck: false, autocomplete: 'off' });
    input.setAttribute('aria-label', 'Find in files');
    const toggles = [['case', 'Aa', 'Match case'], ['word', 'W', 'Whole word'], ['regex', '.*', 'Regular expression']].map(([key, label, title]) => {
      const b = make('button', { type: 'button', className: 'srch-opt', textContent: label, title });
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => { flags[key] = !flags[key]; b.setAttribute('aria-pressed', String(flags[key])); run(); input.focus(); });
      return b;
    });
    summary = make('div', { className: 'srch-summary', textContent: 'Search across every file' });
    list = make('div', { className: 'pal-list', role: 'listbox' });
    root.append(make('div', { className: 'pal-box' }, make('div', { className: 'pal-head' }, input, ...toggles), summary, list));
    document.body.append(root);
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 180); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, hits.length - 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  }

  function init(d) {
    deps = d;
    build();
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); open(); }
    }, true);
  }

  return { init, open };
})();
