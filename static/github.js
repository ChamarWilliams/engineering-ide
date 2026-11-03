const GitHub = (() => {
  const KEY = 'eide.gh.token';
  const API = 'https://api.github.com';
  let deps = null;
  let token = '';
  let user = null;

  try { token = localStorage.getItem(KEY) ?? ''; } catch { /* storage unavailable */ }
  const saveToken = (value) => {
    token = value;
    try { value ? localStorage.setItem(KEY, value) : localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  };

  async function gh(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.message || `GitHub returned ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');
  const toBase64 = (text) => {
    let bin = '';
    new TextEncoder().encode(text).forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  };
  const fromBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));

  async function ifMissing(promise) {
    try { return await promise; } catch (e) { if (e.status === 404) return null; throw e; }
  }

  async function pushFile({ repo, path, branch, message, code, pr }) {
    const info = await gh('GET', `/repos/${repo}`);
    const base = info.default_branch;
    const target = branch || base;
    if (target !== base) {
      const exists = await ifMissing(gh('GET', `/repos/${repo}/git/ref/heads/${encodeURIComponent(target)}`));
      if (!exists) {
        const from = await gh('GET', `/repos/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
        await gh('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${target}`, sha: from.object.sha });
      }
    }
    const current = await ifMissing(gh('GET', `/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(target)}`));
    const saved = await gh('PUT', `/repos/${repo}/contents/${encodePath(path)}`, {
      message, content: toBase64(code), branch: target, ...(current?.sha ? { sha: current.sha } : {}),
    });
    let prUrl = null;
    if (pr && target !== base) {
      const opened = await gh('POST', `/repos/${repo}/pulls`, { title: message, head: target, base, body: 'Opened from Loopline.' });
      prUrl = opened.html_url;
    }
    return { commitUrl: saved.commit.html_url, fileUrl: saved.content.html_url, prUrl, branch: target };
  }

  async function importFile({ repo, path, ref }) {
    const data = await gh('GET', `/repos/${repo}/contents/${encodePath(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
    if (Array.isArray(data)) throw new Error('That path is a folder. Enter a file path.');
    return { name: data.name, code: fromBase64(data.content) };
  }

  async function publishGist({ name, code }) {
    const gist = await gh('POST', '/gists', { public: false, files: { [name]: { content: code } } });
    return gist.html_url;
  }

  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat());
    return n;
  };

  function field(label, input) {
    const wrap = el('div', { className: 'field' });
    const id = `gh-${label.toLowerCase().replace(/\W+/g, '-')}`;
    input.id = id;
    wrap.append(el('label', { htmlFor: id, textContent: label }), input);
    return wrap;
  }

  function link(text, href) {
    return el('a', { href, textContent: text, target: '_blank', rel: 'noopener noreferrer' });
  }

  function connectView(refresh) {
    const root = el('div');
    const input = el('input', { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: 'github_pat_…' });
    const status = el('div', { className: 'status', role: 'status' });
    const go = el('button', { type: 'button', className: 'btn primary', textContent: 'Connect' });
    go.addEventListener('click', async () => {
      if (!input.value.trim()) { status.className = 'status err'; status.textContent = 'Enter a token first.'; return; }
      saveToken(input.value.trim());
      go.disabled = true;
      status.className = 'status';
      status.textContent = 'Connecting…';
      try {
        user = await gh('GET', '/user');
        refresh();
      } catch (err) {
        saveToken('');
        status.className = 'status err';
        status.textContent = err.status === 401 ? 'GitHub rejected that token.' : `Couldn't connect: ${err.message}`;
      } finally { go.disabled = false; }
    });
    root.append(
      el('p', { className: 'note' }, 'Push the open file to a repository, open a pull request, import a file, or publish a secret gist. ',
        'Create a ', link('fine-grained token', 'https://github.com/settings/personal-access-tokens/new'),
        ' with read and write access to Contents and Pull requests.'),
      field('Personal access token', input),
      el('p', { className: 'note' }, 'The token stays in this browser and is sent only to api.github.com. It never reaches the IDE server.'),
      el('div', { className: 'modal-inline' }, go),
      status,
    );
    return root;
  }

  function actionsView(refresh) {
    const root = el('div');
    const repo = el('input', { placeholder: 'owner/name', autocomplete: 'off', spellcheck: false });
    const datalist = el('datalist', { id: 'ghRepos' });
    repo.setAttribute('list', 'ghRepos');
    const path = el('input', { value: deps.name(), spellcheck: false });
    const branch = el('input', { placeholder: 'Default branch', spellcheck: false });
    const message = el('input', { value: `Update ${deps.name()}` });
    const pr = el('input', { type: 'checkbox', id: 'gh-pr' });
    const status = el('div', { className: 'status', role: 'status' });

    const say = (kind, ...parts) => { status.className = `status${kind === 'err' ? ' err' : ''}`; status.replaceChildren(...parts.flat()); };
    const run = (button, work) => async () => {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo.value.trim())) { say('err', 'Enter a repository as owner/name.'); return; }
      button.disabled = true;
      say('ok', 'Working…');
      try { await work(); } catch (err) { say('err', err.message); } finally { button.disabled = false; }
    };

    const push = el('button', { type: 'button', className: 'btn primary', textContent: 'Push file' });
    push.addEventListener('click', run(push, async () => {
      const r = await pushFile({ repo: repo.value.trim(), path: path.value.trim(), branch: branch.value.trim(), message: message.value.trim() || `Update ${path.value}`, code: deps.code(), pr: pr.checked });
      say('ok', 'Pushed to ', r.branch, '. ', link('View commit', r.commitUrl), r.prUrl ? [' · ', link('View pull request', r.prUrl)] : '');
    }));
    const pull = el('button', { type: 'button', className: 'btn', textContent: 'Import file' });
    pull.addEventListener('click', run(pull, async () => {
      const file = await importFile({ repo: repo.value.trim(), path: path.value.trim(), ref: branch.value.trim() });
      if (await deps.importFile(file.name, file.code)) { Modal.close(); deps.toast(`Imported ${file.name}`); }
    }));
    const gist = el('button', { type: 'button', className: 'btn', textContent: 'Publish secret gist' });
    gist.addEventListener('click', async () => {
      gist.disabled = true;
      say('ok', 'Working…');
      try { say('ok', 'Gist created. ', link('Open gist', await publishGist({ name: deps.name(), code: deps.code() }))); } catch (err) { say('err', err.message); } finally { gist.disabled = false; }
    });
    const out = el('button', { type: 'button', className: 'btn', textContent: 'Disconnect' });
    out.addEventListener('click', () => { saveToken(''); user = null; refresh(); });

    const prRow = el('div', { className: 'field check' }, pr, el('label', { htmlFor: 'gh-pr', textContent: 'Open a pull request (needs a branch other than the default)' }));
    root.append(
      el('p', { className: 'note' }, 'Signed in as ', el('strong', { textContent: `@${user.login}` }), '.'),
      field('Repository', repo), datalist, field('File path', path), field('Branch', branch), field('Commit message', message), prRow,
      el('div', { className: 'modal-inline' }, push, pull, gist, out), status,
    );
    gh('GET', '/user/repos?per_page=100&sort=pushed').then((repos) => {
      datalist.replaceChildren(...repos.map((r) => el('option', { value: r.full_name })));
    }).catch(() => {});
    return root;
  }

  async function open() {
    const host = el('div');
    const render = () => host.replaceChildren(user ? actionsView(render) : connectView(render));
    if (token && !user) {
      host.textContent = 'Checking your GitHub connection…';
      try { user = await gh('GET', '/user'); } catch { saveToken(''); }
    }
    render();
    Modal.open({ title: 'GitHub', body: host, actions: [{ label: 'Close' }] });
  }

  function init(d) {
    deps = d;
    document.getElementById('githubBtn').addEventListener('click', open);
  }

  return { init, open, pushFile, importFile, publishGist };
})();
