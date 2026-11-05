const Feedback = (() => {
  const KINDS = [['bug', 'Something broke'], ['idea', 'Idea or feature'], ['other', 'Something else']];
  const make = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat());
    return n;
  };
  let deps = null;
  let lastError = '';

  function remember(text) {
    lastError = String(text || '').slice(0, 400);
  }

  function context(include) {
    if (!include) return '';
    const parts = [`language: ${deps.language()}`, `browser: ${navigator.userAgent.slice(0, 120)}`, `screen: ${innerWidth}x${innerHeight}`];
    if (lastError) parts.push(`last error: ${lastError}`);
    return parts.join('\n');
  }

  function open(kind = 'other') {
    let chosen = kind;
    const radios = KINDS.map(([id, label]) => {
      const input = make('input', { type: 'radio', name: 'fb-kind', value: id, checked: id === chosen });
      input.addEventListener('change', () => { chosen = id; });
      return make('label', { className: 'fb-kind' }, input, make('span', { textContent: label }));
    });
    const message = make('textarea', { className: 'modal-input fb-text', rows: 5, maxLength: 3000, placeholder: 'What happened, or what would you like to see?' });
    message.setAttribute('aria-label', 'Your feedback');
    const first = make('input', { type: 'text', className: 'modal-input', maxLength: 60, placeholder: 'First name (optional)', autocomplete: 'given-name' });
    const last = make('input', { type: 'text', className: 'modal-input', maxLength: 60, placeholder: 'Last name (optional)', autocomplete: 'family-name' });
    const attach = make('input', { type: 'checkbox', checked: true });
    const status = make('p', { className: 'note fb-status', textContent: '' });
    const body = make('div', { className: 'fb-body' },
      make('div', { className: 'fb-kinds' }, radios),
      message,
      make('p', { className: 'note', textContent: 'Leave both names blank to stay anonymous.' }),
      make('div', { className: 'fb-names' }, first, last),
      make('label', { className: 'fb-attach' }, attach, make('span', { textContent: 'Include my language, browser and last error (never your code)' })),
      status);
    Modal.open({
      title: 'Send feedback',
      body,
      actions: [{
        label: 'Send',
        primary: true,
        onClick: async () => {
          const text = message.value.trim();
          if (text.length < 3) {
            status.textContent = 'Write a few words first.';
            message.focus();
            return false;
          }
          try {
            await deps.api('POST', '/api/feedback', { kind: chosen, message: text, first_name: first.value, last_name: last.value, context: context(attach.checked) });
          } catch (err) {
            status.textContent = `Couldn't send it: ${err.message}. Your text is still here, so try again.`;
            return false;
          }
          deps.toast('Thanks, your feedback was sent');
          return true;
        },
      }],
    });
  }

  return { init: (d) => { deps = d; }, open, remember };
})();
