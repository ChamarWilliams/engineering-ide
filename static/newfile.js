const NewFile = (() => {
  const make = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat());
    return n;
  };

  function extToType(name, types) {
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || dot === name.length - 1) return null;
    const ext = name.slice(dot + 1).toLowerCase();
    return Object.keys(types).find((k) => types[k].exts.includes(ext)) ?? null;
  }

  // Resolves to { name, type }, { kind: 'folder', name }, { kind: 'project' } or null when cancelled.
  function open({ types, folder = '' }) {
    return new Promise((resolve) => {
      let step = 'type';
      let picked = null;
      let active = 0;
      let rows = [];
      const input = make('input', { type: 'text', className: 'pal-input', placeholder: 'Type a name like utils.py, or filter the list', spellcheck: false, autocomplete: 'off' });
      input.setAttribute('aria-label', 'New file');
      const chip = make('span', { className: 'nf-chip', hidden: true });
      const hint = make('span', { className: 'pal-hint', textContent: folder || 'New' });
      const list = make('div', { className: 'pal-list', role: 'listbox' });
      const box = make('div', { className: 'pal-box nf-pop' }, make('div', { className: 'pal-head' }, chip, input, hint), list);
      const root = make('div', { className: 'palette' }, box);

      const entries = [
        { kind: 'folder', group: 'General', label: 'Folder', badge: '/', color: '#7a7f87' },
        { kind: 'project', group: 'General', label: 'Project…', badge: '+', color: '#7a7f87' },
        ...Object.entries(types).map(([key, t]) => ({ kind: 'file', key, group: t.group, label: t.label, ext: `.${t.ext}`, badge: t.badge, color: t.color })),
      ];

      const badgeOf = (e) => {
        const b = make('span', { className: 'lang-badge', textContent: e.badge });
        b.style.background = e.color;
        return b;
      };

      function finish(result) {
        root.remove();
        resolve(result);
      }

      function choose(entry) {
        if (entry.kind === 'project') { finish({ kind: 'project' }); return; }
        if (entry.kind === 'quick') { finish({ name: entry.base, type: entry.key }); return; }
        picked = entry;
        step = 'name';
        input.value = '';
        input.placeholder = entry.kind === 'folder' ? 'Folder name' : `Name for the ${entry.label} file`;
        chip.hidden = false;
        chip.replaceChildren(badgeOf(entry), entry.label);
        render();
        input.focus();
      }

      function commitName() {
        const raw = input.value.trim();
        if (picked.kind === 'folder') { if (raw) finish({ kind: 'folder', name: raw }); return; }
        const inferred = extToType(raw, types);
        const base = inferred === picked.key ? raw.slice(0, raw.lastIndexOf('.')) : raw;
        finish({ name: base || 'Untitled', type: picked.key });
      }

      function render() {
        list.replaceChildren();
        rows = [];
        if (step === 'name') {
          list.append(make('div', { className: 'pal-empty', textContent: picked.kind === 'folder' ? 'Press Enter to create the folder' : `Press Enter to create it. Backspace on an empty name goes back.` }));
          return;
        }
        const query = input.value.trim();
        const inferred = extToType(query, types);
        if (inferred) {
          const t = types[inferred];
          rows.push({ kind: 'quick', key: inferred, base: query.slice(0, query.lastIndexOf('.')), label: `Create ${query}`, ext: t.label, badge: t.badge, color: t.color });
        } else {
          const q = query.toLowerCase();
          for (const e of entries) if (!q || e.label.toLowerCase().includes(q) || (e.ext ?? '').includes(q)) rows.push(e);
        }
        active = Math.min(active, Math.max(rows.length - 1, 0));
        let group = null;
        rows.forEach((e, i) => {
          if (!query && e.group !== group) {
            group = e.group;
            list.append(make('div', { className: 'pal-group', textContent: group }));
          }
          const row = make('div', { className: `pal-row${i === active ? ' active' : ''}`, role: 'option' }, badgeOf(e), make('span', { className: 'pal-label', textContent: e.label }));
          if (e.ext) row.append(make('span', { className: 'pal-detail nf-ext', textContent: e.ext }));
          row.addEventListener('pointermove', () => { if (active !== i) { active = i; paint(); } });
          row.addEventListener('click', () => choose(e));
          list.append(row);
        });
        if (!rows.length) list.append(make('div', { className: 'pal-empty', textContent: 'No matching type. Try an extension such as notes.md' }));
      }

      function paint() {
        const items = [...list.querySelectorAll('.pal-row')];
        items.forEach((r, i) => r.classList.toggle('active', i === active));
        items[active]?.scrollIntoView({ block: 'nearest' });
      }

      input.addEventListener('input', () => { if (step === 'type') { active = 0; render(); } });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); return; }
        if (step === 'name') {
          if (e.key === 'Enter') { e.preventDefault(); commitName(); }
          else if (e.key === 'Backspace' && !input.value) { step = 'type'; chip.hidden = true; input.placeholder = 'Type a name like utils.py, or filter the list'; render(); }
          return;
        }
        if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, rows.length - 1); paint(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); paint(); }
        else if (e.key === 'Enter' && rows[active]) { e.preventDefault(); choose(rows[active]); }
      });
      root.addEventListener('pointerdown', (e) => { if (e.target === root) finish(null); });

      document.body.append(root);
      render();
      input.focus();
    });
  }

  return { open };
})();
