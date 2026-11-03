const Modal = (() => {
  const root = document.getElementById('modal');
  const box = root.querySelector('.modal-box');
  const titleEl = document.getElementById('modalTitle');
  const bodyEl = document.getElementById('modalBody');
  const actionsEl = document.getElementById('modalActions');
  const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';
  let opener = null;
  let onClose = null;

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    bodyEl.replaceChildren();
    actionsEl.replaceChildren();
    const cb = onClose;
    onClose = null;
    cb?.();
    opener?.focus?.();
  }

  function open({ title, body, actions = [], wide = false, onClose: cb = null }) {
    opener = document.activeElement;
    onClose = cb;
    titleEl.textContent = title;
    bodyEl.replaceChildren(body);
    box.classList.toggle('wide', wide);
    actionsEl.replaceChildren(...actions.map((a) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn${a.primary ? ' primary' : ''}`;
      btn.textContent = a.label;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try { if ((await a.onClick?.()) !== false) close(); } finally { btn.disabled = false; }
      });
      return btn;
    }));
    root.hidden = false;
    (bodyEl.querySelector(FOCUSABLE) ?? document.getElementById('modalClose')).focus();
  }

  document.getElementById('modalClose').addEventListener('click', close);
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...box.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function prompt({ title, label, value = '', action = 'OK' }) {
    return new Promise((resolve) => {
      let answer = null;
      const input = Object.assign(document.createElement('input'), { type: 'text', value, className: 'modal-input' });
      input.setAttribute('aria-label', label);
      const done = () => { answer = input.value.trim(); close(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(); } });
      const wrap = document.createElement('label');
      wrap.className = 'modal-field';
      wrap.append(Object.assign(document.createElement('span'), { textContent: label }), input);
      open({ title, body: wrap, actions: [{ label: action, primary: true, onClick: () => { answer = input.value.trim(); } }], onClose: () => resolve(answer) });
      input.select();
    });
  }

  function confirm({ title, message, action = 'Delete' }) {
    return new Promise((resolve) => {
      let ok = false;
      const body = Object.assign(document.createElement('p'), { textContent: message, className: 'note' });
      open({ title, body, actions: [{ label: action, primary: true, onClick: () => { ok = true; } }], onClose: () => resolve(ok) });
    });
  }

  return { open, close, prompt, confirm };
})();
