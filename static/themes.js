const Themes = (() => {
  const KEY = 'eide.theme.v2';

  const THEMES = [
    {
      id: 'ink', label: 'Ink', mode: 'dark',
      ui: {
        'bg-editor': '#0f0f10', 'bg-panel': '#141415', line: '#232325', 'line-soft': '#2c2c2f',
        text: '#ececee', 'text-2': '#c4c4c8', 'text-muted': '#8e8e95', 'text-faint': '#6b6b72',
        hover: '#1d1d20', pressed: '#27272b', selected: '#212126', accent: '#7aa2ff', 'on-accent': '#0a0a0b',
        green: '#4ade80', red: '#f87171', err: '#f87171', warn: '#e5b567', shadow: 'rgba(0, 0, 0, 0.5)',
      },
      syn: { fg: '#d4d4d8', comment: '#6f6f78', keyword: '#c4a7e7', string: '#9ccfa4', number: '#e0b07a', type: '#8fb4e8', fn: '#7aa2ff', directive: '#d6b87a' },
    },
    {
      id: 'chalk', label: 'Chalk', mode: 'light',
      ui: {
        'bg-editor': '#ffffff', 'bg-panel': '#fafafa', line: '#ececee', 'line-soft': '#e2e2e6',
        text: '#18181b', 'text-2': '#3f3f46', 'text-muted': '#6b6b75', 'text-faint': '#8b8b95',
        hover: '#f2f2f4', pressed: '#e8e8ec', selected: '#eeeef2', accent: '#2f5fe0', 'on-accent': '#ffffff',
        green: '#15803d', red: '#c62828', err: '#c62828', warn: '#a35a00', shadow: 'rgba(0, 0, 0, 0.1)',
      },
      syn: { fg: '#27272a', comment: '#8b8b95', keyword: '#7c3aed', string: '#15803d', number: '#b45309', type: '#1d4ed8', fn: '#2f5fe0', directive: '#9a6700' },
    },
    {
      id: 'graphite', label: 'Graphite', mode: 'dark',
      ui: {
        'bg-editor': '#1e1f22', 'bg-panel': '#2b2d30', line: '#1e1f22', 'line-soft': '#393b40',
        text: '#dfe1e5', 'text-2': '#b4b8bf', 'text-muted': '#868a91', 'text-faint': '#6f737a',
        hover: '#393b40', pressed: '#43454a', selected: '#2e436e', accent: '#3574f0', 'on-accent': '#ffffff',
        green: '#5fb865', red: '#e55765', err: '#f75464', warn: '#e5c07b', shadow: 'rgba(0, 0, 0, 0.5)',
      },
      syn: { fg: '#bcbec4', comment: '#7a7e85', keyword: '#cf8e6d', string: '#6aab73', number: '#2aacb8', type: '#b5b6e3', fn: '#56a8f5', directive: '#b3ae60' },
    },
    {
      id: 'paper', label: 'Paper and ink', mode: 'light',
      ui: {
        'bg-editor': '#fbf7ee', 'bg-panel': '#f1ebdd', line: '#ddd3c0', 'line-soft': '#d6ccb8',
        text: '#1f1d1a', 'text-2': '#4a463f', 'text-muted': '#6e6859', 'text-faint': '#857e6e',
        hover: '#e7dfcc', pressed: '#ddd3bc', selected: '#f0d9cf', accent: '#c8442a', 'on-accent': '#ffffff',
        green: '#3f7d3a', red: '#b83a2e', err: '#b83a2e', warn: '#a8741a', shadow: 'rgba(60, 40, 20, 0.2)',
      },
      syn: { fg: '#1f1d1a', comment: '#857e6e', keyword: '#8a3b8f', string: '#4f7a32', number: '#b5651d', type: '#2f6f8f', fn: '#c8442a', directive: '#8a6a1a' },
    },
    {
      id: 'blueprint', label: 'Blueprint', mode: 'dark',
      ui: {
        'bg-editor': '#0e1a2b', 'bg-panel': '#122238', line: '#0a1424', 'line-soft': '#2a4466',
        text: '#c9d7ea', 'text-2': '#9db3cf', 'text-muted': '#7a93b5', 'text-faint': '#5f7a9c',
        hover: '#1b3252', pressed: '#234062', selected: '#1e3c64', accent: '#5ce1e6', 'on-accent': '#06222a',
        green: '#62e3a4', red: '#ff6b7a', err: '#ff7b86', warn: '#ffd166', shadow: 'rgba(0, 0, 0, 0.55)',
      },
      syn: { fg: '#c9d7ea', comment: '#6f8aae', keyword: '#5ce1e6', string: '#9fe8b8', number: '#ffd166', type: '#8fb8ff', fn: '#7cc4ff', directive: '#ff9ec0' },
    },
    {
      id: 'signal', label: 'Signal', mode: 'dark',
      ui: {
        'bg-editor': '#0b0b0b', 'bg-panel': '#141414', line: '#8a8a8a', 'line-soft': '#5a5a5a',
        text: '#f2f2f2', 'text-2': '#d8d8d8', 'text-muted': '#b0b0b0', 'text-faint': '#949494',
        hover: '#262626', pressed: '#333333', selected: '#34430a', accent: '#c6f432', 'on-accent': '#0b0b0b',
        green: '#c6f432', red: '#ff5f7a', err: '#ff6b85', warn: '#ffd400', shadow: 'rgba(0, 0, 0, 0.7)',
      },
      syn: { fg: '#f2f2f2', comment: '#9a9a9a', keyword: '#c6f432', string: '#ff9fd1', number: '#ffd400', type: '#7de3ff', fn: '#ff5fa2', directive: '#ffd400' },
    },
    {
      id: 'softlab', label: 'Soft lab', mode: 'light',
      ui: {
        'bg-editor': '#ffffff', 'bg-panel': '#eceef5', line: '#dde0ec', 'line-soft': '#d3d7e6',
        text: '#2a2d3a', 'text-2': '#484c5e', 'text-muted': '#6b7088', 'text-faint': '#808499',
        hover: '#e1e4f0', pressed: '#d5d9ea', selected: '#dcd7fb', accent: '#6c5ce7', 'on-accent': '#ffffff',
        green: '#1f9d6b', red: '#d64560', err: '#d64560', warn: '#b7791f', shadow: 'rgba(40, 40, 90, 0.18)',
      },
      syn: { fg: '#2a2d3a', comment: '#8c90a6', keyword: '#6c5ce7', string: '#0e8f8f', number: '#c2410c', type: '#3b6fd0', fn: '#2f6bd7', directive: '#b7791f' },
    },
  ];

  const byId = Object.fromEntries(THEMES.map((t) => [t.id, t]));
  const root = document.documentElement;
  let currentId = 'ink';
  let monacoReady = false;

  try {
    const saved = localStorage.getItem(KEY);
    if (byId[saved]) currentId = saved;
  } catch { /* storage unavailable */ }

  const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const toHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, t) => toHex(toRgb(a).map((c, i) => c + (toRgb(b)[i] - c) * t));

  function paint(theme) {
    for (const [key, value] of Object.entries(theme.ui)) root.style.setProperty(`--${key}`, value);
    [theme.syn.keyword, theme.syn.string, theme.syn.number, theme.syn.type].forEach((c, i) => root.style.setProperty(`--ind-${i + 1}`, c));
    root.dataset.theme = theme.id;
    root.style.colorScheme = theme.mode;
    if (monacoReady) monaco.editor.setTheme(`eide-${theme.id}`);
  }

  function defineMonaco() {
    for (const theme of THEMES) {
      const { ui: u, syn: s } = theme;
      const bg = u['bg-editor'];
      const clear = '#00000000';
      const strip = (hex) => hex.slice(1);
      monaco.editor.defineTheme(`eide-${theme.id}`, {
        base: theme.mode === 'dark' ? 'vs-dark' : 'vs',
        inherit: true,
        rules: [
          { token: '', foreground: strip(s.fg) },
          { token: 'comment', foreground: strip(s.comment), fontStyle: 'italic' },
          { token: 'keyword', foreground: strip(s.keyword) },
          { token: 'keyword.directive', foreground: strip(s.directive) },
          { token: 'string', foreground: strip(s.string) },
          { token: 'string.escape', foreground: strip(s.keyword) },
          { token: 'number', foreground: strip(s.number) },
          { token: 'type', foreground: strip(s.type) },
          { token: 'annotation', foreground: strip(s.directive) },
          { token: 'predefined', foreground: strip(s.fn) },
          { token: 'identifier', foreground: strip(s.fg) },
          { token: 'delimiter', foreground: strip(s.fg) },
          { token: 'operator', foreground: strip(s.fg) },
        ],
        colors: {
          'editor.background': bg,
          'editor.foreground': s.fg,
          'editorGutter.background': bg,
          'editorLineNumber.foreground': mix(bg, s.fg, 0.35),
          'editorLineNumber.activeForeground': u['text-2'],
          'editor.lineHighlightBackground': mix(bg, s.fg, 0.05),
          'editor.lineHighlightBorder': clear,
          'editor.selectionBackground': mix(bg, u.accent, 0.4),
          'editor.inactiveSelectionBackground': mix(bg, u.accent, 0.22),
          'editor.wordHighlightBackground': mix(bg, u.accent, 0.18),
          'editor.findMatchBackground': mix(bg, u.green, 0.4),
          'editorCursor.foreground': u.text,
          'editorWhitespace.foreground': mix(bg, s.fg, 0.15),
          'editorIndentGuide.background1': mix(bg, s.fg, 0.1),
          'editorIndentGuide.activeBackground1': mix(bg, s.fg, 0.22),
          'editorBracketMatch.background': mix(bg, u.accent, 0.25),
          'editorBracketMatch.border': clear,
          'editorWidget.background': u['bg-panel'],
          'editorWidget.border': u['line-soft'],
          'editorSuggestWidget.background': u['bg-panel'],
          'editorSuggestWidget.selectedBackground': u.selected,
          'editorHoverWidget.background': u['bg-panel'],
          'editorStickyScroll.background': bg,
          'scrollbarSlider.background': `${mix(bg, s.fg, 0.25)}66`,
          'scrollbarSlider.hoverBackground': `${mix(bg, s.fg, 0.4)}88`,
          'scrollbarSlider.activeBackground': `${mix(bg, s.fg, 0.5)}aa`,
          'scrollbar.shadow': clear,
          ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`editorBracketHighlight.foreground${n}`, s.fg])),
        },
      });
    }
    monacoReady = true;
    monaco.editor.setTheme(`eide-${currentId}`);
  }

  function swatch(theme) {
    const box = document.createElement('span');
    box.className = 'swatch';
    for (const color of [theme.ui['bg-editor'], theme.ui['bg-panel'], theme.ui.accent, theme.syn.keyword]) {
      const chip = document.createElement('i');
      chip.style.background = color;
      box.append(chip);
    }
    return box;
  }

  function choose(id) {
    if (!byId[id]) return;
    currentId = id;
    try { localStorage.setItem(KEY, id); } catch { /* storage unavailable */ }
    paint(byId[id]);
  }

  paint(byId[currentId]);
  return { defineMonaco, current: () => currentId, list: () => THEMES, swatch, choose };
})();
