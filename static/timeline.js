const Timeline = (() => {
  const $ = (id) => document.getElementById(id);
  const ui = {
    trace: $('traceBtn'), prev: $('tlPrev'), play: $('tlPlay'), next: $('tlNext'),
    scrub: $('tlScrub'), label: $('tlLabel'), speed: $('tlSpeed'),
  };
  const IDLE = 'No trace yet. Press Trace.';
  let deps = null;
  let trace = null;
  let idx = 0;
  let timer = null;
  let marks = null;
  let tracing = false;

  const last = () => trace.steps.length - 1;
  const playing = () => timer !== null;

  function setPlaying(on) {
    clearTimeout(timer);
    timer = null;
    ui.play.firstElementChild.firstElementChild.setAttribute('href', on ? '#i-pause' : '#i-run');
    ui.play.setAttribute('aria-label', on ? 'Pause' : 'Play');
    if (on) schedule();
  }

  function schedule() {
    timer = setTimeout(() => {
      if (idx >= last()) { setPlaying(false); return; }
      go(idx + 1);
      schedule();
    }, 700 / Number(ui.speed.value));
  }

  function mark(line) {
    const editor = deps.editor();
    marks ??= editor.createDecorationsCollection();
    marks.set([{
      range: new monaco.Range(line, 1, line, 1),
      options: { isWholeLine: true, className: 'trace-line', linesDecorationsClassName: 'trace-gutter' },
    }]);
    editor.revealLineInCenterIfOutsideViewport(line);
  }

  function go(i) {
    if (!trace) return;
    idx = Math.min(Math.max(i, 0), last());
    const step = trace.steps[idx];
    const label = `Step ${idx + 1} of ${trace.steps.length}, line ${step.line}${step.fn === '<module>' ? '' : `, in ${step.fn}()`}`;
    ui.scrub.value = idx;
    ui.scrub.setAttribute('aria-valuetext', label);
    ui.label.textContent = label;
    ui.prev.disabled = idx === 0;
    ui.next.disabled = idx === last();
    mark(step.line);
    const atEnd = idx === last();
    Visualizer.render(step, trace.steps[idx - 1], {
      out: atEnd ? trace.stdout : trace.stdout.slice(0, step.out),
      err: atEnd ? trace.stderr : '',
    }, trace, idx);
  }

  function invalidate() {
    setPlaying(false);
    trace = null;
    marks?.clear();
    Visualizer.clear();
    ui.scrub.max = 0;
    ui.scrub.value = 0;
    ui.scrub.removeAttribute('aria-valuetext');
    for (const b of [ui.scrub, ui.prev, ui.play, ui.next]) b.disabled = true;
    ui.label.textContent = IDLE;
  }

  async function runTrace() {
    if (tracing || !deps) return;
    if (deps.language() !== 'python') { deps.toast('Tracing is only available for Python right now.'); return; }
    tracing = true;
    invalidate();
    ui.trace.disabled = true;
    ui.label.textContent = 'Tracing…';
    try {
      const r = await deps.api('POST', '/api/trace', { run_id: deps.uid(), language: 'python', code: deps.code(), runner: Runner.id() });
      if (r.error) { ui.label.textContent = IDLE; deps.toast(r.error); return; }
      if (!r.trace) {
        ui.label.textContent = r.timed_out ? 'The program timed out.' : 'No trace was recorded.';
        return;
      }
      if (!r.trace.steps.length) { ui.label.textContent = 'Nothing to trace.'; return; }
      trace = { ...r.trace, stderr: r.stderr };
      ui.scrub.max = last();
      for (const b of [ui.scrub, ui.play]) b.disabled = false;
      if (trace.cut) deps.toast(`Trace stopped after ${trace.steps.length} steps (${trace.cut === 'time' ? 'time' : 'step'} limit).`);
      Workspace.show('viz');
      go(0);
    } catch (err) {
      ui.label.textContent = IDLE;
      deps.toast(`Couldn't trace: ${err.message}`);
    } finally {
      tracing = false;
      ui.trace.disabled = false;
    }
  }

  function togglePlay() {
    if (!trace) return;
    if (playing()) { setPlaying(false); return; }
    if (idx >= last()) go(0);
    setPlaying(true);
  }

  function init(d) {
    deps = d;
    ui.trace.addEventListener('click', runTrace);
    ui.prev.addEventListener('click', () => { setPlaying(false); go(idx - 1); });
    ui.next.addEventListener('click', () => { setPlaying(false); go(idx + 1); });
    ui.play.addEventListener('click', togglePlay);
    ui.scrub.addEventListener('input', () => { setPlaying(false); go(Number(ui.scrub.value)); });
    ui.speed.addEventListener('change', () => { if (playing()) setPlaying(true); });

    window.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.key === 'F11') { e.preventDefault(); runTrace(); return; }
      if (!trace || !e.altKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); setPlaying(false); go(idx + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setPlaying(false); go(idx - 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); togglePlay(); }
    }, true);

    invalidate();
  }

  return { init, invalidate, runTrace, go };
})();
