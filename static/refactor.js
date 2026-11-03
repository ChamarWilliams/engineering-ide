const Refactor = (() => {
  let deps = null;

  const make = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat());
    return n;
  };

  function choose({ title, intro, files }) {
    return new Promise((resolve) => {
      let picked = [];
      const boxes = files.map((f) => {
        const box = make('input', { type: 'checkbox', checked: true });
        box.dataset.id = f.id;
        return box;
      });
      const rows = files.map((f, i) => make('label', { className: 'rf-file' },
        boxes[i],
        make('span', { className: 'rf-body' },
          make('strong', { textContent: f.title }),
          make('small', { textContent: `${f.folder ? `${f.folder} · ` : ''}${f.count} ${f.count === 1 ? 'line' : 'lines'}` }),
          ...f.lines.map((l) => make('code', { textContent: `${l.line}  ${l.text}` })))));
      const body = make('div', { className: 'rf' }, make('p', { className: 'note', textContent: intro }), make('div', { className: 'rf-list' }, ...rows));
      Modal.open({
        title,
        body,
        wide: true,
        actions: [
          { label: 'Only this file' },
          { label: 'Update selected', primary: true, onClick: () => { picked = boxes.filter((b) => b.checked).map((b) => b.dataset.id); } },
        ],
        onClose: () => resolve(picked),
      });
    });
  }

  async function offer({ kind, id, old, to }) {
    if (!id || !old || !to || old === to) return [];
    let files;
    try {
      ({ files } = await deps.api('POST', '/api/refactor/preview', { kind, id, old, new: to }));
    } catch (err) {
      deps.toast(`Couldn't check other files: ${err.message}`);
      return [];
    }
    if (!files.length) return [];
    const what = kind === 'file' ? `the file name in ${files.length === 1 ? 'its' : 'their'} imports` : `calls to ${old}`;
    const picked = await choose({
      title: kind === 'file' ? `Rename "${old}" everywhere?` : `Rename ${old} everywhere?`,
      intro: `${files.length} other ${files.length === 1 ? 'file uses' : 'files use'} "${old}". Update ${what} to "${to}" too?`,
      files,
    });
    if (!picked.length) return [];
    try {
      const { changed } = await deps.api('POST', '/api/refactor/apply', { kind, id, old, new: to, files: picked });
      deps.toast(`Updated ${changed.length} ${changed.length === 1 ? 'file' : 'files'}`);
      deps.applied?.(changed);
      return changed;
    } catch (err) {
      deps.toast(`Couldn't update the other files: ${err.message}`);
      return [];
    }
  }

  return { init: (d) => { deps = d; }, offer };
})();
