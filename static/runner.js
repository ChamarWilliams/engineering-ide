const Runner = (() => {
  const OWNER_KEY = 'eide.owner';
  const CHOICE_KEY = 'eide.runner';
  const SERVER = { id: 'server', name: 'This server' };
  const LANG_NAMES = { c: 'C', cpp: 'C++', lua: 'Lua', python: 'Python' };
  let deps = null;
  let agents = [];
  let choice = 'server';
  let memoryKey = '';

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
  };

  function ownerKey() {
    let key = store.get(OWNER_KEY) || memoryKey;
    if (!key) {
      key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      memoryKey = key;
      store.set(OWNER_KEY, key);
    }
    return key;
  }

  const headers = () => ({ 'X-Owner-Key': ownerKey() });
  const id = () => choice;
  const selected = () => agents.find((a) => a.id === choice);

  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat());
    return n;
  };

  function renderButton() {
    const agent = selected();
    const dot = document.getElementById('runnerDot');
    document.getElementById('runnerName').textContent = agent ? agent.name : SERVER.name;
    dot.className = `dot${agent ? (agent.online ? ' on' : ' off') : ''}`;
  }

  async function refresh() {
    try { agents = await deps.api('GET', '/api/agents'); } catch { return; }
    if (choice !== 'server' && !agents.some((a) => a.id === choice)) choose('server');
    renderButton();
  }

  function choose(value) {
    choice = value;
    store.set(CHOICE_KEY, value);
    renderButton();
  }

  function langs(agent) {
    const on = Object.keys(LANG_NAMES).filter((l) => agent.tools?.[l]).map((l) => LANG_NAMES[l]);
    return on.length ? on.join(', ') : 'no toolchains found';
  }

  function runnerRow({ value, title, detail, badge, online, onRemove }) {
    const row = el('div', { className: 'runner-row', role: 'radio', tabIndex: 0 });
    row.setAttribute('aria-checked', String(choice === value));
    const dot = el('span', { className: `dot${online === undefined ? '' : online ? ' on' : ' off'}` });
    const text = el('div', { className: 'runner-text' }, el('strong', { textContent: title }), el('span', { textContent: detail }));
    row.append(dot, text);
    if (badge) row.append(el('span', { className: 'chip', textContent: badge }));
    if (onRemove) {
      const remove = el('button', { type: 'button', className: 'btn sm', textContent: 'Remove' });
      remove.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
      row.append(remove);
    }
    const pick = () => { choose(value); Modal.close(); };
    row.addEventListener('click', pick);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    return row;
  }

  function pairingView() {
    const root = el('div', { className: 'pair' });
    const docker = el('input', { type: 'checkbox', id: 'pair-docker' });
    const network = el('input', { type: 'checkbox', id: 'pair-network' });
    const out = el('div');
    const start = el('button', { type: 'button', className: 'btn primary', textContent: 'Pair a computer' });
    let timer = null;
    let known = new Set();

    const command = (code) => `python agent.py --server ${location.origin} --code ${code}${docker.checked ? ' --docker' : ''}${docker.checked && network.checked ? ' --allow-network' : ''}`;

    start.addEventListener('click', async () => {
      start.disabled = true;
      try {
        const { code, expires_in } = await deps.api('POST', '/api/agents/pair');
        known = new Set(agents.map((a) => a.id));
        const cmd = el('code', { className: 'cmd', textContent: command(code) });
        const copy = el('button', { type: 'button', className: 'btn sm', textContent: 'Copy' });
        copy.addEventListener('click', () => navigator.clipboard?.writeText(cmd.textContent).then(() => deps.toast('Command copied')));
        const status = el('div', { className: 'status', role: 'status', textContent: `Waiting for the agent. The code works once and expires in ${Math.round(expires_in / 60)} minutes.` });
        for (const box of [docker, network]) box.addEventListener('change', () => { cmd.textContent = command(code); });
        out.replaceChildren(
          el('div', { className: 'code-box', textContent: code }),
          el('ol', { className: 'steps' },
            el('li', {}, 'Download and unzip ', el('a', { href: '/agent.zip', textContent: 'the agent' }), ' on your computer.'),
            el('li', {}, 'Run ', el('code', { textContent: 'pip install websockets' }), ' once.'),
            el('li', {}, 'In the unzipped folder, run:')),
          el('div', { className: 'cmd-row' }, cmd, copy),
          status,
        );
        const deadline = Date.now() + expires_in * 1000;
        timer = setInterval(async () => {
          await refresh();
          const fresh = agents.find((a) => a.online && !known.has(a.id));
          if (fresh) {
            clearInterval(timer);
            choose(fresh.id);
            status.textContent = `${fresh.name} is connected and selected.`;
            deps.toast(`${fresh.name} connected`);
          } else if (Date.now() > deadline) {
            clearInterval(timer);
            status.className = 'status err';
            status.textContent = 'The code expired. Generate a new one.';
          }
        }, 2000);
      } catch (err) {
        out.replaceChildren(el('div', { className: 'status err', textContent: err.message }));
      } finally { start.disabled = false; }
    });

    root.append(
      el('p', { className: 'note' }, 'The agent on your computer connects out to this IDE, so no ports are opened. Programs then run on your machine with your toolchains and your own cloud credentials.'),
      el('div', { className: 'field check' }, docker, el('label', { htmlFor: 'pair-docker', textContent: 'Run programs in Docker containers (isolated)' })),
      el('div', { className: 'field check' }, network, el('label', { htmlFor: 'pair-network', textContent: 'Let Docker programs use the network' })),
      el('div', { className: 'modal-inline' }, start),
      out,
    );
    return { root, stop: () => clearInterval(timer) };
  }

  async function open() {
    await refresh();
    const host = el('div');
    const pairing = pairingView();
    const list = el('div', { className: 'runner-list', role: 'radiogroup', ariaLabel: 'Where code runs' });
    list.setAttribute('aria-label', 'Where code runs');
    list.append(runnerRow({ value: 'server', title: SERVER.name, detail: 'Runs on the IDE host. Time limited, no network.' }));
    for (const a of agents) {
      list.append(runnerRow({
        value: a.id,
        title: a.name,
        detail: a.online ? `${langs(a)}${a.network ? ' · network on' : ' · network off'}` : 'Offline. Start the agent on that computer.',
        badge: a.online ? (a.mode === 'docker' ? 'Docker' : 'Native') : null,
        online: a.online,
        onRemove: async () => {
          try { await deps.api('DELETE', `/api/agents/${a.id}`); } catch (err) { deps.toast(err.message); return; }
          Modal.close();
          await refresh();
          open();
        },
      }));
    }
    host.append(list, el('h3', { className: 'sub', textContent: 'Add a computer' }), pairing.root);
    Modal.open({ title: 'Run code on', body: host, actions: [{ label: 'Close' }], onClose: pairing.stop });
  }

  function init(d) {
    deps = d;
    const saved = store.get(CHOICE_KEY);
    if (saved) choice = saved;
    document.getElementById('runnerBtn').addEventListener('click', open);
    renderButton();
    refresh();
    setInterval(refresh, 20000);
  }

  return { init, id, headers, refresh };
})();
