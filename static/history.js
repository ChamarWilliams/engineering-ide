const History = (() => {
  const list = document.getElementById('historyList');
  let deps = null;
  let revisions = [];
  let blame = null;
  let marks = null;
  let blameOn = true;

  const ago = (iso) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    const unit = (n, name) => `${n} ${name}${n === 1 ? '' : 's'} ago`;
    if (s < 60) return 'just now';
    if (s < 3600) return unit(Math.floor(s / 60), 'minute');
    if (s < 86400) return unit(Math.floor(s / 3600), 'hour');
    return unit(Math.floor(s / 86400), 'day');
  };

  function showBlame() {
    const editor = deps.editor();
    if (!blameOn || !blame || deps.dirty()) { marks?.clear(); return; }
    const line = editor.getPosition().lineNumber;
    const info = blame.lines[line - 1];
    if (!info) { marks?.clear(); return; }
    const col = editor.getModel().getLineMaxColumn(line);
    marks ??= editor.createDecorationsCollection();
    marks.set([{
      range: new monaco.Range(line, 1, line, col),
      options: { after: { content: `    You, ${ago(info.at)} · revision ${info.n}`, inlineClassName: 'blame' } },
    }]);
  }

  function render() {
    if (!revisions.length) {
      list.replaceChildren(Object.assign(document.createElement('p'), { className: 'tree-empty', textContent: 'Save a file to start its history.' }));
      return;
    }
    list.replaceChildren(...revisions.map((rev, i) => {
      const row = document.createElement('div');
      row.className = 'rev';
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.title = 'Compare with the current file';
      const n = Object.assign(document.createElement('span'), { className: 'n', textContent: `Revision ${rev.n}` });
      const when = Object.assign(document.createElement('span'), { className: 'when', textContent: ago(rev.created_at) });
      const delta = document.createElement('span');
      delta.className = 'delta';
      delta.append(Object.assign(document.createElement('span'), { className: 'add', textContent: `+${rev.added}` }), ' ',
        Object.assign(document.createElement('span'), { className: 'del', textContent: `−${rev.removed}` }));
      row.append(n, when, delta);
      if (i > 0) {
        const restore = Object.assign(document.createElement('button'), { type: 'button', className: 'btn sm', textContent: 'Restore' });
        restore.addEventListener('click', (e) => { e.stopPropagation(); restoreRevision(rev.n); });
        row.append(restore);
      }
      row.addEventListener('click', () => compare(rev.n));
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') compare(rev.n); });
      return row;
    }));
  }

  async function refresh() {
    const id = deps.id();
    if (!id) { clear(); return; }
    try {
      [revisions, blame] = await Promise.all([
        deps.api('GET', `/api/sessions/${id}/revisions`),
        deps.api('GET', `/api/sessions/${id}/blame`),
      ]);
    } catch { return; }
    render();
    showBlame();
  }

  function clear() {
    revisions = [];
    blame = null;
    marks?.clear();
    render();
  }

  async function restoreRevision(n) {
    try {
      await deps.api('POST', `/api/sessions/${deps.id()}/revisions/${n}/restore`);
      await deps.reload();
      deps.toast(`Restored revision ${n}`);
      Modal.close();
      refresh();
    } catch (err) {
      deps.toast(`Couldn't restore: ${err.message}`);
    }
  }

  async function compare(n) {
    let rev;
    try { rev = await deps.api('GET', `/api/sessions/${deps.id()}/revisions/${n}`); } catch (err) { deps.toast(err.message); return; }
    const host = document.createElement('div');
    host.className = 'diff-host';
    const lang = deps.editor().getModel().getLanguageId();
    const original = monaco.editor.createModel(rev.code, lang);
    const modified = monaco.editor.createModel(deps.editor().getValue(), lang);
    let diff = null;
    Modal.open({
      title: `Revision ${n} compared with the current file`,
      body: host,
      wide: true,
      actions: [
        ...(n !== revisions[0]?.n ? [{ label: `Restore revision ${n}`, primary: true, onClick: () => { restoreRevision(n); return false; } }] : []),
        { label: 'Close' },
      ],
      onClose: () => { diff?.dispose(); original.dispose(); modified.dispose(); },
    });
    diff = monaco.editor.createDiffEditor(host, {
      readOnly: true, automaticLayout: true, renderSideBySide: true, originalEditable: false,
      fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false,
    });
    diff.setModel({ original, modified });
  }

  function init(d) {
    deps = d;
    deps.editor().onDidChangeCursorPosition(showBlame);
    deps.editor().onDidChangeModelContent(showBlame);
    render();
  }

  function setBlame(on) {
    blameOn = on;
    if (deps) showBlame();
  }

  return { init, refresh, clear, setBlame };
})();
