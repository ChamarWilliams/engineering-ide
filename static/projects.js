const Projects = (() => {
  const make = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat());
    return n;
  };
  const MAX_FILE = 1024 * 1024;
  const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'target', 'build', 'dist', '.idea', '.vscode']);
  let deps = null;
  let templates = null;

  const safeName = (raw) => raw.replace(/[^A-Za-z0-9 _.-]/g, '_').slice(0, 40).trim() || 'project';

  function uniqueName(base) {
    const taken = new Set((deps.folders?.() ?? []).map((f) => f.split('/')[0]));
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
    return name;
  }

  async function open() {
    templates ??= await deps.api('GET', '/api/templates');
    let chosen = templates[0];
    let result = null;
    const name = make('input', { type: 'text', className: 'modal-input', spellcheck: false });
    name.setAttribute('aria-label', 'Project name');
    const desc = make('p', { className: 'pj-desc' });
    const files = make('ul', { className: 'pj-files' });
    const side = make('div', { className: 'pj-list', role: 'listbox' });
    const items = new Map();

    const groups = [];
    for (const t of templates) {
      let g = groups.find((x) => x.name === t.group);
      if (!g) groups.push((g = { name: t.group, items: [] }));
      g.items.push(t);
    }
    for (const g of groups) {
      side.append(make('div', { className: 'pal-group', textContent: g.name }));
      for (const t of g.items) {
        const row = make('button', { type: 'button', className: 'pj-item', textContent: t.label });
        row.setAttribute('role', 'option');
        row.addEventListener('click', () => { chosen = t; paint(true); });
        row.addEventListener('dblclick', () => { create().then((ok) => ok && Modal.close()); });
        items.set(t.id, row);
        side.append(row);
      }
    }
    side.append(make('div', { className: 'pal-group', textContent: 'Import' }));
    const local = make('button', { type: 'button', className: 'pj-item', textContent: 'Folder from this computer…' });
    local.addEventListener('click', () => { Modal.close(); importFolder(); });
    const hub = make('button', { type: 'button', className: 'pj-item', textContent: 'GitHub repository…' });
    hub.addEventListener('click', () => { Modal.close(); document.getElementById('githubBtn')?.click(); });
    side.append(local, hub);

    let edited = false;
    name.addEventListener('input', () => { edited = true; });
    function paint(reset) {
      for (const [id, row] of items) row.setAttribute('aria-selected', String(id === chosen.id));
      desc.textContent = chosen.desc;
      files.replaceChildren(...(chosen.files.length ? chosen.files : ['No files']).slice(0, 14).map((f) => make('li', { textContent: f })));
      if (reset && !edited) name.value = uniqueName(chosen.id === 'empty' ? 'project' : `${chosen.label.split(' ')[0].toLowerCase()}-app`);
    }

    async function create() {
      const value = name.value.trim();
      if (!value) { deps.toast('Give the project a name'); return false; }
      try {
        result = await deps.api('POST', '/api/projects', { template: chosen.id, name: value });
      } catch (err) {
        deps.toast(err.message);
        return false;
      }
      return true;
    }

    const body = make('div', { className: 'pj' }, side, make('div', { className: 'pj-main' },
      make('label', { className: 'modal-field' }, make('span', { textContent: 'Project name' }), name), desc,
      make('div', { className: 'pj-label', textContent: 'Creates' }), files,
      make('p', { className: 'pj-note', textContent: 'Files are also written to the terminal workspace, so you can install and run the project there.' })));
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create().then((ok) => ok && Modal.close()); } });
    await new Promise((resolve) => {
      Modal.open({
        title: 'New project', body, wide: true,
        actions: [{ label: 'Create', primary: true, onClick: create }],
        onClose: resolve,
      });
      paint(true);
      name.select();
    });
    if (!result) return;
    await deps.refresh();
    if (result.open) await deps.openSession(result.open);
    deps.toast(`Created ${result.folder}${result.files ? ` with ${result.files} files` : ''}`);
  }

  function importFolder() {
    const picker = make('input', { type: 'file', multiple: true });
    picker.webkitdirectory = true;
    picker.addEventListener('change', async () => {
      const all = [...picker.files];
      if (!all.length) return;
      const root = all[0].webkitRelativePath.split('/')[0] || 'import';
      const folder = uniqueName(safeName(root));
      const wanted = all.filter((f) => {
        const parts = f.webkitRelativePath.split('/').slice(1);
        const dot = f.name.lastIndexOf('.');
        return parts.length && !parts.some((p) => SKIP.has(p)) && f.size <= MAX_FILE && deps.extToLang(dot > 0 ? f.name.slice(dot + 1).toLowerCase() : '');
      }).slice(0, 1500);
      let imported = 0;
      let first = null;
      try {
        for (let i = 0; i < wanted.length; i += 40) {
          const batch = await Promise.all(wanted.slice(i, i + 40).map(async (f) => ({ path: f.webkitRelativePath.split('/').slice(1).join('/'), content: await f.text() })));
          const res = await deps.api('POST', '/api/import', { folder, files: batch });
          imported += res.imported;
          first ??= res.open;
        }
      } catch (err) {
        deps.toast(`Import stopped: ${err.message}`);
      }
      deps.toast(`Imported ${imported} of ${all.length} files into ${folder}${all.length - imported ? '. Binary, large and unsupported files were skipped' : ''}`);
      await deps.refresh();
      if (first) deps.openSession(first);
    });
    picker.click();
  }

  return { init: (d) => { deps = d; }, open, importFolder };
})();
