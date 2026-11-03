const Settings = (() => {
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat());
    return n;
  };

  const section = (title, ...kids) => el('section', { className: 'settings-section' }, el('h3', { className: 'sub', textContent: title }), ...kids);

  function choiceGrid(label, items, current, pick) {
    const grid = el('div', { className: 'card-grid', role: 'radiogroup' });
    grid.setAttribute('aria-label', label);
    const mark = () => grid.querySelectorAll('[role="radio"]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === current())));
    for (const item of items) {
      const card = el('button', { type: 'button', className: 'choice-card' }, ...item.content);
      card.dataset.id = item.id;
      card.setAttribute('role', 'radio');
      card.addEventListener('click', () => { pick(item.id); mark(); });
      grid.append(card);
    }
    mark();
    return grid;
  }

  const prefGrid = (label, key, items) => choiceGrid(label, items.map(([id, text]) => ({ id, content: [el('span', { className: 'card-label', textContent: text })] })),
    () => Prefs.get(key), (id) => Prefs.set(key, id));

  function toggle(key, title, note) {
    const box = el('input', { type: 'checkbox', id: `pref-${key}`, checked: Prefs.get(key) });
    box.setAttribute('role', 'switch');
    box.addEventListener('change', () => Prefs.set(key, box.checked));
    return el('div', { className: 'setting-row' }, box,
      el('label', { htmlFor: box.id, className: 'plugin-text' },
        el('span', { className: 'plugin-title' }, el('strong', { textContent: title })),
        el('span', { className: 'plugin-note', textContent: note })));
  }

  function viewsSection() {
    return section('Views and flow',
      el('p', { className: 'note', textContent: 'Flow is the main view. The text editor stays available as a backup, one click or Alt+M away.' }),
      el('h4', { className: 'sub', textContent: 'Start in' }),
      prefGrid('Start view', 'defaultView', [['flow', 'Flow'], ['map', 'Project map'], ['text', 'Text editor']]),
      el('h4', { className: 'sub', textContent: 'Open scripts as' }),
      prefGrid('Open scripts as', 'openAs', [['flow', 'Flow'], ['text', 'Text editor']]),
      el('h4', { className: 'sub', textContent: 'Wire style' }),
      prefGrid('Wire style', 'wireStyle', [['curve', 'Curved'], ['straight', 'Straight'], ['step', 'Stepped']]),
      el('div', { className: 'modal-inline' }),
      toggle('showSwitch', 'Show the Map, Flow and Text switch', 'Adds the switch to the tab bar. Turn it off to rely on Alt+M and Alt+P.'),
      toggle('pulses', 'Animate runs', 'Replays a run with glowing comets and call labels travelling along the wires.'),
      toggle('grid', 'Dot grid', 'Draws the dot grid behind flows and the project map.'),
      toggle('snapGuides', 'Magnetic alignment guides', 'Cells snap to the edges and centres of their neighbours while you drag. Hold Alt to drag freely.'),
      toggle('fineGrid', 'Fine snap grid', 'Snaps dropped cells to a 4 px grid instead of 8 px.'));
  }

  function stepper(key, title, min, max, step) {
    const input = el('input', { type: 'number', className: 'modal-input stepper', min, max, step, value: Prefs.get(key) });
    input.setAttribute('aria-label', title);
    input.addEventListener('change', () => {
      const n = Math.min(max, Math.max(min, Number(input.value) || Prefs.DEFAULTS[key]));
      input.value = n;
      Prefs.set(key, n);
    });
    return el('div', { className: 'setting-row' }, input, el('span', { className: 'plugin-text' }, el('span', { className: 'plugin-title' }, el('strong', { textContent: title }))));
  }

  function editorSection() {
    return section('Editor',
      stepper('fontSize', 'Font size', 9, 28, 0.5),
      stepper('tabSize', 'Tab size', 1, 8, 1),
      toggle('wordWrap', 'Word wrap', 'Wraps long lines instead of scrolling sideways.'),
      toggle('minimap', 'Minimap', 'Shows a zoomed-out overview at the right edge.'),
      toggle('lineNumbers', 'Line numbers', 'Shows line numbers in the gutter.'),
      toggle('ligatures', 'Font ligatures', 'Joins symbols such as => and != into single glyphs.'),
      toggle('stickyScroll', 'Sticky scroll', 'Keeps the enclosing function header pinned while scrolling.'),
      toggle('whitespace', 'Show whitespace', 'Draws dots and arrows for spaces and tabs.'),
      toggle('bracketColors', 'Bracket pair colors', 'Colours matching brackets by nesting depth.'),
      toggle('normalizeEol', 'Normalize line endings', 'Converts CRLF to LF whenever a file is saved.'),
      toggle('themeSync', 'Follow system theme', 'Switches between a light and a dark theme with your operating system.'),
      toggle('termHistory', 'Remember terminal output', 'Restores each terminal tab and its scrollback after a reload. Saved in this browser only, so avoid it if you print secrets.'),
      toggle('chime', 'Completion chime', 'Plays a soft sound when a long or remote run finishes, or when this tab is in the background.'));
  }

  async function open() {
    const themes = choiceGrid('Theme', Themes.list().map((t) => ({
      id: t.id,
      content: [Themes.swatch(t), el('span', { className: 'card-label', textContent: t.label }), el('span', { className: 'card-mode', textContent: t.mode })],
    })), Themes.current, (id) => { Themes.choose(id); Qol.rememberTheme(); });

    const layouts = choiceGrid('Layout', Workspace.layouts().map((l) => ({
      id: l.id,
      content: [el('span', { className: 'card-label', textContent: l.label })],
    })), Workspace.current, Workspace.setLayout);
    const reset = el('button', { type: 'button', className: 'btn sm', textContent: 'Reset this layout' });
    reset.addEventListener('click', () => Workspace.reset());

    const body = el('div', {},
      viewsSection(),
      editorSection(),
      section('Theme', themes),
      section('Layout', layouts, el('div', { className: 'modal-inline' }, reset)),
      section('Plugins', await Plugins.view()));
    Modal.open({ title: 'Settings', body, actions: [{ label: 'Done', primary: true }] });
  }

  function init() {
    document.getElementById('settingsBtn').addEventListener('click', open);
  }

  return { init };
})();
