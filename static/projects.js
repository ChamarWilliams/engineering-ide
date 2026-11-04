const Projects = (() => {
  const make = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat());
    return n;
  };
  const MAX_FILE = 1024 * 1024;
  const MAX_FILES = 1500;
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

  const isZip = (f) => /\.zip$/i.test(f.name);
  const asFile = (f, path) => ({ path, size: f.size, read: () => f.text() });
  const entryFile = (entry) => new Promise((ok, no) => entry.file(ok, no));
  const readBatch = (reader) => new Promise((ok, no) => reader.readEntries(ok, no));

  function wanted(item) {
    const parts = item.path.split('/');
    const name = parts[parts.length - 1];
    const dot = name.lastIndexOf('.');
    return item.size <= MAX_FILE && !parts.some((p) => SKIP.has(p)) && deps.extToLang(dot > 0 ? name.slice(dot + 1).toLowerCase() : '');
  }

  async function upload(items, folder) {
    const list = items.filter(wanted).slice(0, MAX_FILES);
    let imported = 0;
    let first = null;
    try {
      for (let i = 0; i < list.length; i += 40) {
        const batch = await Promise.all(list.slice(i, i + 40).map(async (it) => ({ path: it.path, content: (await it.read()).replace(/\r\n/g, '\n') })));
        const res = await deps.api('POST', '/api/import', { folder, files: batch });
        imported += res.imported;
        first ??= res.open;
      }
    } catch (err) {
      deps.toast(`Import stopped: ${err.message}`);
    }
    if (!imported) deps.toast('Nothing imported. Those files are binary, too large or an unsupported type');
    else deps.toast(`Imported ${imported} of ${items.length} ${items.length === 1 ? 'file' : 'files'}${folder ? ` into ${folder}` : ''}${items.length > imported ? '. Binary, large and unsupported files were skipped' : ''}`);
    await deps.refresh();
    if (first) deps.openSession(first);
  }

  // Items that all sit under one top-level folder go into a new folder of that name.
  function uploadAsFolder(items, fallback) {
    const roots = new Set(items.map((i) => i.path.split('/')[0]));
    const single = roots.size === 1 && items.every((i) => i.path.includes('/'));
    const name = uniqueName(safeName(single ? [...roots][0] : fallback));
    return upload(single ? items.map((i) => ({ ...i, path: i.path.slice(i.path.indexOf('/') + 1) })) : items, name);
  }

  async function unzip(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const dv = new DataView(buf.buffer);
    const text = new TextDecoder();
    let end = buf.length - 22;
    while (end >= 0 && dv.getUint32(end, true) !== 0x06054b50) end--;
    if (end < 0) throw new Error('That is not a valid zip file');
    const items = [];
    let at = dv.getUint32(end + 16, true);
    for (let i = dv.getUint16(end + 10, true); i > 0 && dv.getUint32(at, true) === 0x02014b50; i--) {
      const method = dv.getUint16(at + 10, true);
      const packed = dv.getUint32(at + 20, true);
      const size = dv.getUint32(at + 24, true);
      const nameLen = dv.getUint16(at + 28, true);
      const next = at + 46 + nameLen + dv.getUint16(at + 30, true) + dv.getUint16(at + 32, true);
      const local = dv.getUint32(at + 42, true);
      const path = text.decode(buf.subarray(at + 46, at + 46 + nameLen)).replace(/\\/g, '/').replace(/^\/+/, '');
      at = next;
      if (path.endsWith('/') || path.includes('..') || path.startsWith('__MACOSX/') || (method !== 0 && method !== 8)) continue;
      const from = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const raw = buf.subarray(from, from + packed);
      const read = async () => text.decode(method === 0 ? raw : await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      items.push({ path, size, read });
    }
    return items;
  }

  async function importZip(file) {
    try {
      await uploadAsFolder(await unzip(file), file.name.replace(/\.zip$/i, ''));
    } catch (err) {
      deps.toast(err.message);
    }
  }

  async function importLoose(files, folder) {
    for (const f of files.filter(isZip)) await importZip(f);
    const rest = files.filter((f) => !isZip(f));
    if (rest.length) await upload(rest.map((f) => asFile(f, f.name)), folder);
  }

  function choose(props, onPick) {
    const picker = make('input', { type: 'file', ...props });
    picker.addEventListener('change', () => { if (picker.files.length) onPick([...picker.files]); });
    picker.click();
  }

  const importFiles = (folder = '') => choose({ multiple: true }, (files) => importLoose(files, folder));
  const importZipFile = () => choose({ accept: '.zip,application/zip' }, ([file]) => importZip(file));

  function importFolder() {
    choose({ multiple: true, webkitdirectory: true }, (all) => {
      const items = all.map((f) => asFile(f, f.webkitRelativePath)).filter((i) => i.path);
      uploadAsFolder(items, items[0].path.split('/')[0] || 'import');
    });
  }

  async function walk(entry, prefix, out) {
    if (entry.isFile) {
      out.push(asFile(await entryFile(entry), prefix + entry.name));
      return;
    }
    if (SKIP.has(entry.name) || out.length > MAX_FILES * 2) return;
    const reader = entry.createReader();
    for (let batch = await readBatch(reader); batch.length; batch = await readBatch(reader)) {
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out);
    }
  }

  // The drop's entries expire after the event, so they are all collected before the first await.
  async function dropped(transfer, folder = '') {
    const entries = [...transfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
    const files = [...transfer.files];
    if (!entries.length) return importLoose(files, folder);
    const loose = [];
    for (const entry of entries) {
      if (entry.isDirectory) {
        const items = [];
        await walk(entry, '', items);
        await uploadAsFolder(items, entry.name);
      } else {
        loose.push(await entryFile(entry));
      }
    }
    if (loose.length) await importLoose(loose, folder);
  }

  return { init: (d) => { deps = d; }, open, importFolder, importFiles, importZip: importZipFile, dropped };
})();
