const IndentColors = (() => {
  const MAX_LINES = 4000;
  const MAX_DEPTH = 24;
  const style = document.head.appendChild(document.createElement('style'));
  let editor = null;
  let marks = null;
  let timer = null;
  let enabled = true;
  let builtFor = 0;
  let lastCursorLine = 0;

  function buildStyles(tab) {
    const rules = [];
    for (let depth = 1; depth <= MAX_DEPTH; depth++) {
      const layers = [];
      for (let k = 0; k < depth; k++) {
        const from = `${k * tab}ch`;
        const to = `${(k + 1) * tab}ch`;
        const color = `color-mix(in srgb, var(--ind-${(k % 4) + 1}) 14%, transparent)`;
        layers.push(`linear-gradient(90deg, transparent ${from}, ${color} ${from}, ${color} ${to}, transparent ${to})`);
      }
      rules.push(`.indent-d${depth} { background: ${layers.join(', ')}; }`);
    }
    style.textContent = rules.join('\n');
    builtFor = tab;
  }

  function depthOf(text, tab) {
    let width = 0;
    for (const ch of text) {
      if (ch === '\t') width += tab - (width % tab);
      else if (ch === ' ') width++;
      else break;
    }
    return Math.min(Math.floor(width / tab), MAX_DEPTH);
  }

  function update() {
    if (!editor) return;
    if (!enabled) { marks?.clear(); return; }
    const model = editor.getModel();
    const tab = model.getOptions().tabSize;
    if (tab !== builtFor) buildStyles(tab);
    const count = Math.min(model.getLineCount(), MAX_LINES);
    const depths = new Array(count + 2).fill(null);
    for (let line = 1; line <= count; line++) {
      const text = model.getLineContent(line);
      if (text.trim()) depths[line] = depthOf(text, tab);
    }

    let next = 0;
    const after = new Array(count + 2).fill(0);
    for (let line = count; line >= 1; line--) {
      after[line] = next;
      if (depths[line] !== null) next = depths[line];
    }
    let prev = 0;
    const cursorLine = editor.getPosition()?.lineNumber;
    const decorations = [];
    for (let line = 1; line <= count; line++) {
      if (depths[line] !== null) prev = depths[line];
      const depth = depths[line] ?? Math.min(prev, after[line]);
      if (depth > 0 && line !== cursorLine) {
        decorations.push({
          range: new monaco.Range(line, 1, line, 1),
          options: { isWholeLine: true, className: `indent-d${depth}` },
        });
      }
    }
    marks ??= editor.createDecorationsCollection();
    marks.set(decorations);
  }

  const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 80); };

  function init(ed) {
    editor = ed;
    editor.onDidChangeModelContent(schedule);
    editor.onDidChangeModel(schedule);
    editor.onDidChangeModelOptions(schedule);
    editor.onDidChangeCursorPosition((e) => { if (e.position.lineNumber !== lastCursorLine) { lastCursorLine = e.position.lineNumber; schedule(); } });
    update();
  }

  function setEnabled(on) {
    enabled = on;
    update();
  }

  return { init, setEnabled, refresh: schedule };
})();
