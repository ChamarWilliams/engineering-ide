const Plugins = (() => {
  const KEY = 'eide.plugins.v1';
  const WEB = ['javascript', 'typescript', 'html', 'css', 'json', 'yaml', 'markdown'];
  const LANGS = ['c', 'cpp', 'lua', 'python', ...WEB];
  const DEFS = [
    { id: 'ruff', name: 'Ruff', kind: 'Formatter and linter', langs: ['python'], format: true, lint: true, tool: 'ruff', fix: 'pip install ruff', info: 'Formats Python and flags unused names, undefined names, and bug-prone patterns as you type.' },
    { id: 'clang-format', name: 'clang-format', kind: 'Formatter', langs: ['c', 'cpp'], format: true, tool: 'clang_format', fix: 'pip install clang-format', info: 'Formats C and C++ with a four-space LLVM-based style.' },
    { id: 'compiler-warnings', name: 'Compiler warnings', kind: 'Linter', langs: ['c', 'cpp'], lint: true, tool: 'gcc', fix: 'install gcc', info: 'Shows gcc errors and warnings in the editor without running the program.' },
    { id: 'prettier', name: 'Prettier', kind: 'Formatter', langs: WEB, format: true, tool: 'prettier', fix: 'npm install -g prettier', info: 'Formats JavaScript, TypeScript, HTML, CSS, JSON, YAML and Markdown.' },
    { id: 'stylua', name: 'StyLua', kind: 'Formatter', langs: ['lua'], format: true, tool: 'stylua', fix: 'install StyLua and put it on PATH', info: 'Formats Lua.' },
    { id: 'indent-colors', name: 'Indent colours', kind: 'Editor', info: 'Tints each indentation level with a colour from the current theme.' },
    { id: 'snippets', name: 'Snippet packs', kind: 'Snippets', info: 'Loops, functions, classes, and plotting boilerplate for each language.' },
    { id: 'hints', name: 'Library completions', kind: 'Language support', info: 'Completions, signatures, and hover docs for the standard library and the bundled data and cloud libraries.' },
    { id: 'inline-blame', name: 'Inline blame', kind: 'History', info: 'Shows which saved revision last changed the current line.' },
    { id: 'format-on-save', name: 'Format on save', kind: 'Setting', info: 'Formats the file with the matching formatter when you press Ctrl+S, if one is installed. Autosave never reformats.' },
  ];
  let deps = null;
  let tools = null;
  let enabled = {};
  let timer = null;
  let seq = 0;

  try { enabled = JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { enabled = {}; }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(enabled)); } catch { /* storage unavailable */ } };

  const def = (id) => DEFS.find((p) => p.id === id);
  const isOn = (id) => enabled[id] ?? !def(id).off;
  const present = (p) => !p.tool || Boolean(tools?.[p.tool]);
  const active = (lang, capability) => DEFS.find((p) => p[capability] && p.langs.includes(lang) && isOn(p.id) && present(p));

  function apply() {
    IndentColors.setEnabled(isOn('indent-colors'));
    Completions.configure({ snippets: isOn('snippets'), hints: isOn('hints') });
    History.setBlame(isOn('inline-blame'));
    scheduleLint();
  }

  function minimalEdit(model, before, after) {
    let start = 0;
    const max = Math.min(before.length, after.length);
    while (start < max && before[start] === after[start]) start++;
    let end = 0;
    while (end < max - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
    const from = model.getPositionAt(start);
    const to = model.getPositionAt(before.length - end);
    return { range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column), text: after.slice(start, after.length - end) };
  }

  async function formatEdits(model) {
    const lang = model.getLanguageId();
    if (!active(lang, 'format')) {
      const p = DEFS.find((d) => d.format && d.langs.includes(lang));
      deps.toast(p && !present(p) ? `${p.name} is not installed on this server (${p.fix}).` : p ? `Enable ${p.name} in Plugins to format ${lang}.` : 'No formatter for this language.');
      return [];
    }
    const before = model.getValue();
    try {
      const { code } = await deps.api('POST', '/api/format', { language: lang, code: before });
      return code === before || model.getValue() !== before ? [] : [minimalEdit(model, before, code)];
    } catch (err) {
      deps.toast(`Couldn't format: ${err.message}`);
      return [];
    }
  }

  async function lint() {
    const model = deps.editor().getModel();
    const lang = model.getLanguageId();
    const mine = ++seq;
    if (!active(lang, 'lint')) { monaco.editor.setModelMarkers(model, 'eide-lint', []); return; }
    let result;
    try { result = await deps.api('POST', '/api/lint', { language: lang, code: model.getValue() }); } catch { return; }
    if (mine !== seq) return;
    const Severity = monaco.MarkerSeverity;
    monaco.editor.setModelMarkers(model, 'eide-lint', result.diagnostics.map((d) => ({
      startLineNumber: d.line, startColumn: d.column, endLineNumber: d.end_line, endColumn: Math.max(d.end_column, d.column + 1),
      message: d.code ? `${d.message} (${d.code})` : d.message,
      severity: d.severity === 'error' ? Severity.Error : Severity.Warning,
      source: active(lang, 'lint').name,
    })));
  }

  function scheduleLint() {
    clearTimeout(timer);
    timer = setTimeout(lint, 700);
  }

  async function beforeSave() {
    const lang = deps.editor().getModel().getLanguageId();
    if (isOn('format-on-save') && active(lang, 'format')) await deps.editor().getAction('editor.action.formatDocument')?.run();
  }

  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat());
    return n;
  };

  async function view() {
    if (!tools) { try { tools = await deps.api('GET', '/api/tools'); } catch { tools = {}; } }
    const list = el('div', { className: 'plugin-list' });
    for (const p of DEFS) {
      const available = present(p);
      const box = el('input', { type: 'checkbox', id: `plugin-${p.id}`, checked: available && isOn(p.id), disabled: !available });
      box.setAttribute('role', 'switch');
      box.addEventListener('change', () => { enabled[p.id] = box.checked; persist(); apply(); });
      const version = typeof tools?.[p.tool] === 'string' ? ` · v${tools[p.tool]}` : '';
      const note = available ? `${p.info}${version}` : `Not installed on this server. To enable: ${p.fix}.`;
      list.append(el('div', { className: 'plugin-row' },
        box,
        el('label', { htmlFor: box.id, className: 'plugin-text' },
          el('span', { className: 'plugin-title' }, el('strong', { textContent: p.name }), el('span', { className: 'chip', textContent: p.kind })),
          el('span', { className: 'plugin-note', textContent: note }))));
    }
    return el('div', {}, el('p', { className: 'note', textContent: 'Built in and run by this IDE. Format the open file with Shift+Alt+F.' }), list);
  }

  function init(d) {
    deps = d;
    const ed = deps.editor();
    for (const lang of LANGS) {
      monaco.languages.registerDocumentFormattingEditProvider(lang, {
        displayName: 'Engineering IDE',
        provideDocumentFormattingEdits: (model) => formatEdits(model),
      });
    }
    ed.onDidChangeModelContent(scheduleLint);
    ed.onDidChangeModelLanguage(scheduleLint);
    d.api('GET', '/api/tools').then((t) => { tools = t; apply(); }).catch(() => { tools = {}; apply(); });
    apply();
  }

  return { init, beforeSave, view };
})();
