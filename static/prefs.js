const Prefs = (() => {
  const KEY = 'eide.prefs.v1';
  const DEFAULTS = {
    defaultView: 'flow',
    openAs: 'flow',
    showSwitch: true,
    wireStyle: 'curve',
    pulses: true,
    grid: true,
    snapGuides: true,
    fineGrid: false,
    fontSize: 13.5,
    tabSize: 4,
    wordWrap: false,
    minimap: false,
    lineNumbers: true,
    ligatures: true,
    stickyScroll: true,
    whitespace: false,
    bracketColors: true,
    normalizeEol: true,
    themeSync: false,
    themeDark: '',
    themeLight: '',
    chime: false,
    termHistory: true,
  };
  let values = { ...DEFAULTS };
  const listeners = new Set();

  try { values = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { values = { ...DEFAULTS }; }

  const get = (key) => values[key];

  function set(key, value) {
    values[key] = value;
    const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== DEFAULTS[k]));
    try { localStorage.setItem(KEY, JSON.stringify(changed)); } catch { /* storage unavailable */ }
    for (const fn of listeners) fn(key, value);
  }

  const on = (fn) => { listeners.add(fn); };

  return { get, set, on, DEFAULTS };
})();
