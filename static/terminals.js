const Terminals = (() => {
  const CDN = 'https://cdn.jsdelivr.net/npm';
  const KNOWN_KEY = 'eide.sshKnown';
  const PROFILE_KEY = 'eide.sshProfiles';
  const TOKEN_KEY = 'eide.termToken';

  let status = null;
  let tabs = null;
  let host = null;
  let runBody = null;
  let runTab = null;
  let plus = null;
  let libs = null;
  const sessions = new Map();
  let activeId = 'run';
  let counter = 0;

  const make = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat());
    return n;
  };

  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  };

  function loadScript(src) {
    return fetch(src).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${src}`);
      return r.text();
    }).then((code) => new Function('define', 'module', 'exports', code).call(window));
  }

  function loadLibs() {
    libs ??= (async () => {
      document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${CDN}/@xterm/xterm@5.5.0/css/xterm.css` }));
      await loadScript(`${CDN}/@xterm/xterm@5.5.0/lib/xterm.js`);
      await Promise.all([
        loadScript(`${CDN}/@xterm/addon-fit@0.10.0/lib/addon-fit.js`),
        loadScript(`${CDN}/@xterm/addon-web-links@0.11.0/lib/addon-web-links.js`),
      ]);
    })();
    return libs;
  }

  function theme() {
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return { background: v('--bg-editor', '#1e1f22'), foreground: v('--text', '#dfe1e5'), cursor: v('--accent', '#3574f0'), selectionBackground: '#3574f055' };
  }

  function wsUrl() {
    const token = status?.needs_token ? sessionStorage.getItem(TOKEN_KEY) : '';
    const base = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/terminal`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  }

  function select(id) {
    activeId = id;
    runBody.hidden = id !== 'run';
    host.hidden = id === 'run';
    runTab.classList.toggle('active', id === 'run');
    for (const [sid, s] of sessions) {
      s.pane.hidden = sid !== id;
      s.tab.classList.toggle('active', sid === id);
      if (sid === id) requestAnimationFrame(() => { s.fit(); s.term.focus(); });
    }
  }

  const HISTORY_KEY = 'eide.termHistory';
  const MAX_LINES = 1000;

  function scrollback(term) {
    const buf = term.buffer.active;
    const lines = [];
    for (let i = Math.max(0, buf.length - MAX_LINES); i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '');
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    return lines.join('\n').slice(-200000);
  }

  function persist() {
    if (!Prefs.get('termHistory')) return;
    const saved = [...sessions.values()].map((s) => ({ ...s.meta, text: scrollback(s.term) }));
    write(HISTORY_KEY, saved);
  }

  async function restoreHistory() {
    if (!Prefs.get('termHistory') || !status?.allowed) return;
    const saved = read(HISTORY_KEY, []);
    if (!Array.isArray(saved) || !saved.length) return;
    for (const s of saved.slice(0, 4)) {
      if (s.kind === 'local' && !status.local) continue;
      await open({ kind: s.kind, ssh: s.ssh, label: s.label, restore: s.text });
    }
    select('run');
  }

  function clearHistory() {
    write(HISTORY_KEY, []);
  }

  function closeTab(id) {
    const s = sessions.get(id);
    if (!s) return;
    s.dispose();
    sessions.delete(id);
    if (activeId === id) select([...sessions.keys()].pop() ?? 'run');
    persist();
  }

  async function open({ kind, ssh, label, restore = null }) {
    if (!status?.allowed) return;
    try { await loadLibs(); } catch (err) { libs = null; await Modal.confirm({ title: 'Terminal unavailable', message: `${err.message}. The terminal emulator loads from a CDN, so check your connection.`, action: 'OK' }); return; }
    const id = `t${++counter}`;
    const term = new Terminal({ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 13, cursorBlink: true, scrollback: 5000, theme: theme(), allowProposedApi: true });
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon.WebLinksAddon());
    const pane = make('div', { className: 'term-pane' });
    host.append(pane);
    term.open(pane);

    const title = make('span', { className: 'term-title', textContent: label });
    const close = make('button', { type: 'button', className: 'term-close', title: 'Close terminal', textContent: '×' });
    const tab = make('button', { type: 'button', className: 'term-tab' }, title, close);
    tabs.insertBefore(tab, plus);

    let socket = null;
    let alive = true;
    const send = (obj) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj)); };
    const fit = () => {
      if (pane.hidden || !pane.offsetWidth) return;
      try { fitAddon.fit(); } catch { return; }
      send({ type: 'resize', cols: term.cols, rows: term.rows });
    };

    function connect(params) {
      socket = new WebSocket(wsUrl());
      socket.onopen = () => {
        fitAddon.fit();
        socket.send(JSON.stringify({ kind, cols: term.cols, rows: term.rows, ssh: params }));
      };
      socket.onmessage = async (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'output') term.write(msg.data);
        else if (msg.type === 'ready') term.focus();
        else if (msg.type === 'error') term.writeln(`\r\n\x1b[31m${msg.message}\x1b[0m`);
        else if (msg.type === 'exit') { term.writeln(`\r\n\x1b[2m[process exited with code ${msg.code}]\x1b[0m`); title.textContent = `${label} (ended)`; }
        else if (msg.type === 'fingerprint') await trust(msg, params);
      };
      socket.onclose = (ev) => {
        if (ev.code === 4403) term.writeln(`\r\n\x1b[31m${ev.reason || 'Terminal access was refused.'}\x1b[0m`);
      };
    }

    async function trust(msg, params) {
      const key = `${msg.host}:${params.port || 22}`;
      const message = msg.changed
        ? `The host key for ${key} has CHANGED. This could mean someone is intercepting the connection.\n\nNew fingerprint: ${msg.fingerprint} (${msg.algorithm})`
        : `The authenticity of ${key} can't be established.\n\nFingerprint: ${msg.fingerprint} (${msg.algorithm})\n\nOnly continue if you recognise it.`;
      const ok = await Modal.confirm({ title: msg.changed ? 'Host key changed' : 'Trust this host?', message, action: msg.changed ? 'Trust new key' : 'Trust and connect' });
      if (!ok) { term.writeln('\r\n\x1b[33mConnection cancelled.\x1b[0m'); return; }
      const known = read(KNOWN_KEY, {});
      known[key] = msg.fingerprint;
      write(KNOWN_KEY, known);
      connect({ ...params, fingerprint: msg.fingerprint });
    }

    term.onData((data) => send({ type: 'input', data }));
    const ro = new ResizeObserver(() => fit());
    ro.observe(pane);

    const dispose = () => {
      alive = false;
      ro.disconnect();
      send({ type: 'close' });
      try { socket?.close(); } catch { /* already closed */ }
      term.dispose();
      pane.remove();
      tab.remove();
    };
    sessions.set(id, { term, pane, tab, fit, dispose, meta: { kind, label, ssh: ssh ? { host: ssh.host, port: ssh.port, user: ssh.user, auth: ssh.auth } : null }, get alive() { return alive; } });
    tab.addEventListener('click', () => select(id));
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(id); });
    tab.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(id); });

    if (!restore) Workspace.show('console');
    select(id);
    const params = ssh ? { ...ssh, fingerprint: read(KNOWN_KEY, {})[`${ssh.host}:${ssh.port || 22}`] } : undefined;
    if (restore) term.write(`${restore.replace(/\n/g, '\r\n')}\r\n\x1b[2m--- previous session restored ---\x1b[0m\r\n`);
    if (restore && ssh) {
      term.writeln('\x1b[33mDisconnected. Use + > SSH connection to reconnect.\x1b[0m');
      title.textContent = `${label} (ended)`;
    } else {
      connect(params);
    }
    persist();
    return id;
  }

  async function askToken() {
    const value = await Modal.prompt({ title: 'Terminal token', label: 'Token', action: 'Connect' });
    if (!value) return false;
    sessionStorage.setItem(TOKEN_KEY, value);
    return true;
  }

  async function newLocal() {
    if (!status.local) { await Modal.confirm({ title: 'Local terminal unavailable', message: 'This server has no pseudo-terminal support installed (on Windows: pip install pywinpty).', action: 'OK' }); return; }
    if (status.needs_token && !sessionStorage.getItem(TOKEN_KEY) && !(await askToken())) return;
    open({ kind: 'local', label: status.shell || 'Shell' });
  }

  function field(label, input) {
    return make('label', { className: 'modal-field' }, make('span', { textContent: label }), input);
  }

  async function newSsh() {
    if (!status.ssh) { await Modal.confirm({ title: 'SSH unavailable', message: 'The server needs asyncssh installed (pip install asyncssh).', action: 'OK' }); return; }
    if (status.needs_token && !sessionStorage.getItem(TOKEN_KEY) && !(await askToken())) return;
    const profiles = read(PROFILE_KEY, []);
    const inp = (props) => make('input', { type: 'text', className: 'modal-input', spellcheck: false, ...props });
    const hostIn = inp({ placeholder: 'example.com or 10.0.0.5' });
    const portIn = inp({ type: 'number', value: '22' });
    const userIn = inp({ placeholder: 'user name' });
    const authIn = make('select', { className: 'modal-input' }, ...[['password', 'Password'], ['key', 'Private key'], ['agent', 'SSH agent / default keys']].map(([v, l]) => new Option(l, v)));
    const passIn = inp({ type: 'password', autocomplete: 'off' });
    const keyIn = make('textarea', { className: 'modal-input', rows: 5, spellcheck: false, placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----' });
    const phraseIn = inp({ type: 'password', autocomplete: 'off' });
    const saveIn = make('input', { type: 'checkbox', checked: true });
    const saved = make('select', { className: 'modal-input' }, new Option('Saved connections…', ''), ...profiles.map((p, i) => new Option(`${p.user ? `${p.user}@` : ''}${p.host}${p.port && p.port !== '22' ? `:${p.port}` : ''}`, String(i))));
    const rows = { password: field('Password', passIn), key: make('div', { className: 'nf-keyrow' }, field('Private key', keyIn), field('Passphrase (optional)', phraseIn)) };
    const syncAuth = () => { for (const [k, r] of Object.entries(rows)) r.hidden = k !== authIn.value; };
    authIn.addEventListener('change', syncAuth);
    saved.addEventListener('change', () => {
      const p = profiles[Number(saved.value)];
      if (!p) return;
      hostIn.value = p.host; portIn.value = p.port || '22'; userIn.value = p.user || ''; authIn.value = p.auth || 'password';
      syncAuth();
    });
    syncAuth();
    const note = make('p', { className: 'note', textContent: 'Credentials go to this IDE server to open the connection and are never stored. Only host, user and port can be saved.' });
    const body = make('div', { className: 'nf' }, profiles.length ? saved : '', field('Host', hostIn), field('Port', portIn), field('User', userIn), field('Authentication', authIn), rows.password, rows.key,
      make('label', { className: 'modal-check' }, saveIn, make('span', { textContent: 'Remember host and user' })), note);
    let go = null;
    Modal.open({
      title: 'SSH connection', body, wide: true,
      actions: [{ label: 'Connect', primary: true, onClick: () => {
        if (!hostIn.value.trim()) return;
        go = { host: hostIn.value.trim(), port: Number(portIn.value) || 22, user: userIn.value.trim(), auth: authIn.value, password: passIn.value, key: keyIn.value, passphrase: phraseIn.value };
      } }],
      onClose: () => {
        if (!go) return;
        if (saveIn.checked) {
          const entry = { host: go.host, port: String(go.port), user: go.user, auth: go.auth };
          const next = [entry, ...profiles.filter((p) => !(p.host === entry.host && p.user === entry.user && p.port === entry.port))].slice(0, 12);
          write(PROFILE_KEY, next);
        }
        open({ kind: 'ssh', ssh: go, label: `${go.user ? `${go.user}@` : ''}${go.host}` });
      },
    });
    hostIn.focus();
  }

  function menu() {
    document.querySelector('.term-menu')?.remove();
    const m = make('div', { className: 'term-menu', role: 'menu' });
    const item = (label, hint, fn, disabled) => {
      const b = make('button', { type: 'button', className: 'term-menu-item', disabled }, make('span', { textContent: label }), make('small', { textContent: hint }));
      b.addEventListener('click', () => { m.remove(); fn(); });
      return b;
    };
    if (!status?.allowed) {
      m.append(make('p', { className: 'note', textContent: status?.reason || 'Terminals are unavailable.' }));
    } else {
      m.append(item('New terminal', status.local ? status.shell : 'not installed', newLocal, !status.local), item('SSH connection…', status.ssh ? 'remote server' : 'not installed', newSsh, !status.ssh));
    }
    const r = plus.getBoundingClientRect();
    Object.assign(m.style, { left: `${Math.min(r.left, innerWidth - 240)}px`, top: `${r.bottom + 4}px` });
    document.body.append(m);
    const off = (e) => { if (!m.contains(e.target) && e.target !== plus) { m.remove(); document.removeEventListener('pointerdown', off, true); } };
    setTimeout(() => document.addEventListener('pointerdown', off, true));
  }

  async function init() {
    tabs = document.getElementById('termTabs');
    host = document.getElementById('termHost');
    runBody = document.querySelector('[data-panel="console"] .run-body');
    runTab = document.getElementById('runTabBtn');
    plus = document.getElementById('termPlus');
    runTab.addEventListener('click', () => select('run'));
    plus.addEventListener('click', menu);
    try { status = await (await fetch('/api/terminal')).json(); } catch { status = { allowed: false, reason: 'Could not reach the server.' }; }
    window.addEventListener('pagehide', persist);
    setInterval(() => { if (sessions.size) persist(); }, 5000);
    restoreHistory();
  }

  return {
    init,
    clearHistory,
    showRun: () => { if (tabs) select('run'); },
    openLocal: () => status && newLocal(),
    openSsh: () => status && newSsh(),
    available: () => Boolean(status?.allowed),
  };
})();
