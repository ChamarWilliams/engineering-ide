const Qol = (() => {
  let deps = null;
  const mru = [];
  let cycle = null;
  let overlay = null;

  const make = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat());
    return n;
  };

  // ---------- Most-recently-used tab switching ----------

  function visit(key) {
    if (!key) return;
    const i = mru.indexOf(key);
    if (i >= 0) mru.splice(i, 1);
    mru.unshift(key);
  }

  const ordered = () => {
    const live = new Map(deps.tabs().map((t) => [t.key, t]));
    const seen = mru.filter((k) => live.has(k));
    return [...seen, ...[...live.keys()].filter((k) => !seen.includes(k))].map((k) => live.get(k));
  };

  function paintCycle() {
    overlay ??= make('div', { className: 'mru' });
    overlay.replaceChildren(...cycle.list.map((t, i) => make('div', { className: `mru-row${i === cycle.at ? ' active' : ''}`, textContent: t.title || 'Untitled' })));
    document.body.append(overlay);
  }

  function endCycle(commit) {
    if (!cycle) return;
    const target = cycle.list[cycle.at];
    cycle = null;
    overlay?.remove();
    if (commit && target && target.key !== deps.state.tabKey) deps.switchTab(target.key);
  }

  function bindTabs() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const list = ordered();
        if (list.length < 2) return;
        cycle ??= { list, at: 0 };
        cycle.at = (cycle.at + (e.shiftKey ? -1 : 1) + list.length) % list.length;
        paintCycle();
      } else if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        const list = ordered();
        if (list[1]) deps.switchTab(list[1].key);
      } else if (e.key === 'Escape' && cycle) {
        endCycle(false);
      }
    }, true);
    document.addEventListener('keyup', (e) => { if (e.key === 'Control') endCycle(true); }, true);
    window.addEventListener('blur', () => endCycle(false));
  }

  // ---------- Dropping files into the sidebar ----------

  function bindDrop() {
    const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const clear = () => {
      document.body.classList.remove('dropping-files');
      document.querySelectorAll('.drop-folder').forEach((r) => r.classList.remove('drop-folder'));
    };
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      document.body.classList.add('dropping-files');
      document.querySelectorAll('.drop-folder').forEach((r) => r.classList.remove('drop-folder'));
      e.target.closest?.('.tree-row[data-folder]')?.classList.add('drop-folder');
    }, true);
    window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) clear(); }, true);
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const folder = e.target.closest?.('.tree-row[data-folder]')?.dataset.folder ?? deps.state.folder ?? '';
      clear();
      deps.dropped(e.dataTransfer, folder);
    }, true);
  }

  // ---------- Missing imports ----------

  async function offerImports(auto) {
    const model = deps.editor().getModel();
    const language = deps.state.language;
    const found = Imports.missing(language, model.getValue());
    if (!found.length) {
      if (!auto) deps.toast('No missing imports found');
      return;
    }
    const body = make('div', {}, make('p', { className: 'note', textContent: 'These names are used but not imported:' }),
      make('pre', { className: 'imp-list', textContent: found.map((f) => f.text).join('\n') }));
    let go = false;
    await new Promise((resolve) => {
      Modal.open({ title: `Add ${found.length} missing ${found.length === 1 ? 'import' : 'imports'}?`, body, actions: [{ label: 'Add', primary: true, onClick: () => { go = true; } }], onClose: resolve });
    });
    if (go) Imports.apply(deps.editor(), language, found);
  }

  // ---------- Theme following the system ----------

  function followSystem() {
    if (!Prefs.get('themeSync')) return;
    const mode = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const current = Themes.list().find((t) => t.id === Themes.current());
    if (current?.mode === mode) return;
    const remembered = Prefs.get(mode === 'dark' ? 'themeDark' : 'themeLight');
    const pick = Themes.list().find((t) => t.id === remembered && t.mode === mode) ?? Themes.list().find((t) => t.mode === mode);
    if (pick) Themes.choose(pick.id);
  }

  function rememberTheme() {
    const t = Themes.list().find((x) => x.id === Themes.current());
    if (t && Prefs.get('themeSync')) Prefs.set(t.mode === 'dark' ? 'themeDark' : 'themeLight', t.id);
  }

  // ---------- Run results: benchmark badge and chime ----------

  let audio = null;

  function chime() {
    try {
      audio ??= new AudioContext();
      const now = audio.currentTime;
      [660, 880].forEach((freq, i) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.35);
        osc.connect(gain).connect(audio.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.4);
      });
    } catch { /* audio unavailable */ }
  }

  function runDone(result, { remote = false } = {}) {
    const badge = document.getElementById('bench');
    if (badge) {
      const parts = [];
      if (typeof result.duration_ms === 'number') parts.push(`${result.duration_ms} ms`);
      if (result.peak_kb) parts.push(result.peak_kb >= 1024 ? `${(result.peak_kb / 1024).toFixed(1)} MB peak` : `${result.peak_kb} KB peak`);
      badge.textContent = parts.join(' · ');
      badge.hidden = !parts.length;
    }
    if (Prefs.get('chime') && (document.hidden || !document.hasFocus() || remote || (result.duration_ms ?? 0) >= 2000)) chime();
  }

  // ---------- .http scratchpad ----------

  function parseHttp(text) {
    return text.split(/^###.*$/m).map((block) => {
      const lines = block.replace(/\r/g, '').split('\n').filter((l) => !/^\s*(#|\/\/)/.test(l));
      while (lines.length && !lines[0].trim()) lines.shift();
      if (!lines.length) return null;
      const m = lines[0].trim().match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)/i);
      if (!m) return { error: `Not a request line: ${lines[0].trim().slice(0, 80)}` };
      const headers = {};
      let i = 1;
      for (; i < lines.length && lines[i].trim(); i++) {
        const h = lines[i].match(/^([^:\s]+)\s*:\s*(.*)$/);
        if (h) headers[h[1]] = h[2];
      }
      const body = lines.slice(i + 1).join('\n').trim();
      return { method: m[1].toUpperCase(), url: m[2], headers, body: body || undefined };
    }).filter(Boolean);
  }

  async function runHttp(text, write) {
    const requests = parseHttp(text);
    if (!requests.length) { write('Write a request such as: GET /api/sessions', 'c-hint'); return; }
    for (const req of requests) {
      if (req.error) { write(req.error, 'c-err'); continue; }
      let url;
      try { url = new URL(req.url, location.origin); } catch { write(`Invalid URL: ${req.url}`, 'c-err'); continue; }
      write(`${req.method} ${url.href}`, 'c-hint');
      const started = performance.now();
      try {
        const res = await fetch(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body, signal: AbortSignal.timeout(20000) });
        const raw = await res.text();
        let shown = raw;
        try { shown = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* not JSON */ }
        write(`${res.status} ${res.statusText}  ·  ${Math.round(performance.now() - started)} ms  ·  ${res.headers.get('content-type') ?? ''}`, res.ok ? 'c-ok' : 'c-err');
        write(shown.length > 20000 ? `${shown.slice(0, 20000)}\n… ${shown.length - 20000} more characters` : shown);
      } catch (err) {
        write(`Request failed: ${err.message}. Cross-origin servers must allow this page with CORS.`, 'c-err');
      }
      write('');
    }
  }

  function init(d) {
    deps = d;
    bindTabs();
    bindDrop();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', followSystem);
    Prefs.on((key) => {
      if (key === 'themeSync' && Prefs.get('themeSync')) { rememberTheme(); followSystem(); }
    });
    followSystem();
    deps.editor().onDidPaste(() => { if (['c', 'cpp', 'python'].includes(deps.state.language)) setTimeout(() => offerImports(true), 50); });
  }

  return { init, visit, previous: () => ordered()[1]?.key, runDone, runHttp, offerImports, followSystem, rememberTheme };
})();
