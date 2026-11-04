const Device = (() => {
  const make = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat());
    return n;
  };
  let deps = null;

  async function open() {
    let info;
    try {
      info = await deps.api('GET', '/api/workspace/link');
    } catch (err) {
      deps.toast(`Couldn't create the link: ${err.message}`);
      return;
    }
    const url = info.shared ? location.origin : `${location.origin}/?ws=${info.token}`;
    const note = info.shared
      ? 'This server shows the same files to everyone, so just open the address below on your phone.'
      : 'Open this link on your phone or another computer to see the same files there. Anyone with the link can open this workspace, so treat it like a password.';
    const field = make('input', { type: 'text', className: 'modal-input', value: url, readOnly: true, spellcheck: false });
    field.setAttribute('aria-label', 'Workspace link');
    field.addEventListener('focus', () => field.select());
    const copy = make('button', { type: 'button', className: 'mesh-btn', textContent: 'Copy link' });
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        deps.toast('Link copied');
      } catch {
        field.select();
        deps.toast('Press Ctrl+C to copy the link');
      }
    });
    const code = make('div', { className: 'dev-qr', hidden: true });
    if (window.QRCode) {
      code.hidden = false;
      new QRCode(code, { text: url, width: 176, height: 176, colorDark: '#000000', colorLight: '#ffffff' });
    }
    const body = make('div', { className: 'dev-body' }, make('p', { className: 'note', textContent: note }), field, make('div', { className: 'dev-row' }, copy), code);
    Modal.open({ title: 'Open on another device', body, actions: [{ label: 'Done', primary: true }] });
  }

  return { init: (d) => { deps = d; }, open };
})();
