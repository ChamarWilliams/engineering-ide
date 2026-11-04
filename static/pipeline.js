const Pipeline = (() => {
  const make = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat());
    return n;
  };
  const TITLES = { send: 'Send', build: 'Build', run: 'Run', trace: 'Trace', draw: 'Draw' };
  let host = null;
  let last = null;
  let timer = null;
  let slow = false;

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const ms = (n) => (n < 1 ? '<1 ms' : n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`);
  const firstLine = (text, pattern) => {
    const lines = (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    return (pattern && lines.find((l) => pattern.test(l))) || lines[0] || '';
  };
  const callCount = (trace) => (trace.events ?? []).filter((e) => e.e === 'call').length;

  function sendStage(info, serverMs) {
    const kb = (info.bytes / 1024).toFixed(1);
    const text = `Sent ${plural(info.lines, 'line')} (${kb} KB) of ${info.label} to the server`;
    if (info.sendError) return { id: 'send', state: 'fail', detail: `Could not reach the server: ${info.sendError}`, recovery: 'Your code is still in the editor and saved. Check your connection and run again.', ms: 0 };
    return { id: 'send', state: 'ok', detail: text, ms: Math.max(1, (info.roundtrip ?? 0) - serverMs) };
  }

  function buildStage(info, phases) {
    const compile = phases.find((p) => p.phase === 'compile');
    const tool = (compile?.tool ?? '').replace(/\.exe$/i, '').toLowerCase();
    if (!compile) return { id: 'build', state: 'skip', detail: `No build step: ${info.label} runs directly`, ms: 0 };
    if (compile.exit_code !== 0) {
      const why = firstLine(info.compileText, /error/i);
      return { id: 'build', state: 'fail', detail: `${tool} could not build the program${why ? `: ${why}` : ''}`, ms: compile.ms, recovery: 'Your code is unchanged. Fix the error in the editor and run again.' };
    }
    return { id: 'build', state: 'ok', detail: `Built with ${tool}`, ms: compile.ms };
  }

  function runStage(info, phases, result) {
    const step = phases.find((p) => p.phase === 'run' || p.phase === 'trace');
    const exit = result.exit_code;
    if (info.failedAt === 'build') return { id: 'run', state: 'skip', detail: 'Not run because the build failed', ms: 0 };
    if (!step) return { id: 'run', state: 'skip', detail: 'Nothing ran', ms: 0 };
    const out = (info.stdout || '').split('\n').filter((l) => l !== '').length;
    if (step.timed_out) return { id: 'run', state: 'warn', detail: `Stopped at the time limit. Kept ${plural(out, 'line')} of output`, ms: step.ms, recovery: 'Output so far is in the console. Look for an infinite loop or a long wait.' };
    if (exit) {
      const why = firstLine(result.stderr || info.stderr, /error|exception|fault|panic/i);
      return { id: 'run', state: 'warn', detail: `Your program exited with code ${exit}${why ? `: ${why.slice(0, 90)}` : ''}`, ms: step.ms, recovery: 'The output up to the failure is kept and shown.' };
    }
    return { id: 'run', state: 'ok', detail: `Ran to the end, ${plural(out, 'line')} of output`, ms: step.ms };
  }

  const RANK = { ok: 0, skip: 0, fallback: 1, warn: 2, fail: 3 };

  function traceStage(info, trace) {
    if (!trace) return { id: 'trace', state: 'fail', detail: 'The tracer produced nothing to show', recovery: 'The console has the error. Your code is unchanged.' };
    const steps = trace.steps?.length ?? 0;
    const base = `Recorded ${plural(steps, 'step')} and ${plural(callCount(trace), 'call')}`;
    if (trace.cut) {
      const why = { steps: 'the step limit', time: 'the time limit', stepping: 'the debugger stopping' }[trace.cut] ?? trace.cut;
      return { id: 'trace', state: 'warn', detail: `${base}, then stopped at ${why}`, recovery: 'Replay shows everything recorded up to that point.' };
    }
    return { id: 'trace', state: 'ok', detail: base };
  }

  function mergeTrace(run, trace) {
    const worst = RANK[run.state] > RANK[trace.state] ? run : trace;
    const extra = run.state === 'ok' || run.state === 'skip' ? '' : `. ${run.detail}`;
    return { id: 'trace', state: worst.state, detail: `${trace.detail}${extra}`, ms: run.ms, recovery: trace.recovery ?? run.recovery };
  }

  function build(info) {
    const result = info.result ?? {};
    const phases = result.phases ?? (result.steps ?? []).map((s) => ({ phase: s.phase, tool: (s.command || '').split(' ')[0], ms: s.duration_ms, exit_code: s.exit_code, timed_out: s.timed_out }));
    const serverMs = result.duration_ms ?? 0;
    info.failedAt = phases.some((p) => p.phase === 'compile' && p.exit_code !== 0) ? 'build' : null;
    info.compileText = info.compileText ?? (result.steps ?? []).find((s) => s.phase === 'compile')?.stderr ?? result.stderr;
    info.stdout = info.stdout ?? result.trace?.stdout ?? (result.steps ?? []).map((s) => s.stdout ?? '').join('');
    const stages = [sendStage(info, serverMs), buildStage(info, phases)];
    if (info.sendError) return stages;
    const run = runStage(info, phases, result);
    if (info.via === 'trace' && info.failedAt !== 'build') stages.push(mergeTrace(run, traceStage(info, result.trace)));
    else stages.push(run);
    if (info.fallback && !info.failedAt) stages.push({ id: 'trace', state: 'fallback', detail: `Tracing was not available: ${info.fallback}`, ms: null, recovery: 'Ran the program normally and showed the call order instead.' });
    if (info.drawMs != null) stages.push(info.failedAt ? { id: 'draw', state: 'skip', detail: 'Nothing to draw because the build failed', ms: null } : { id: 'draw', state: 'ok', detail: info.drawNote ?? 'Drew the result', ms: info.drawMs });
    return stages;
  }

  function card(stage, index) {
    const dot = make('span', { className: 'pipe-dot' });
    const title = make('strong', { textContent: TITLES[stage.id] });
    const time = make('span', { className: 'pipe-ms', textContent: stage.state === 'skip' || stage.ms == null ? '' : ms(stage.ms) });
    const detail = make('span', { className: 'pipe-detail', textContent: stage.detail });
    const body = make('div', { className: `pipe-card pipe-${stage.state}`, role: 'listitem' }, make('div', { className: 'pipe-top' }, dot, title, time), detail);
    if (stage.recovery) body.append(make('span', { className: 'pipe-fix', textContent: stage.recovery }));
    body.dataset.index = String(index);
    return body;
  }

  function stop() {
    clearTimeout(timer);
    timer = null;
    host?.classList.remove('pipe-playing');
    host?.querySelectorAll('.pipe-card').forEach((c) => c.classList.remove('pipe-on', 'pipe-pending'));
    if (last) host?.querySelector('.pipe-replay')?.replaceChildren('Replay');
  }

  function replay() {
    if (!last || !host) return;
    if (timer) { stop(); return; }
    const cards = [...host.querySelectorAll('.pipe-card')];
    const button = host.querySelector('.pipe-replay');
    button.replaceChildren('Stop');
    host.classList.add('pipe-playing');
    cards.forEach((c) => c.classList.add('pipe-pending'));
    let i = 0;
    const hold = slow ? 1800 : 900;
    const step = () => {
      if (i >= cards.length) { stop(); return; }
      cards.forEach((c) => c.classList.remove('pipe-on'));
      cards[i].classList.remove('pipe-pending');
      cards[i].classList.add('pipe-on');
      cards[i].scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      i++;
      timer = setTimeout(step, hold);
    };
    step();
  }

  function paint(stages, info) {
    stop();
    const total = (info.result?.duration_ms ?? 0) + (stages.find((s) => s.id === 'send')?.ms ?? 0) + (info.drawMs ?? 0);
    const replayBtn = make('button', { type: 'button', className: 'pipe-btn pipe-replay', textContent: 'Replay', title: 'Play the last run back one step at a time' });
    const slowBtn = make('label', { className: 'pipe-slow', title: 'Slower replay' }, make('input', { type: 'checkbox', checked: slow }), 'Slow');
    slowBtn.querySelector('input').addEventListener('change', (e) => { slow = e.target.checked; });
    replayBtn.addEventListener('click', replay);
    const list = make('div', { className: 'pipe-list', role: 'list', ariaLabel: 'What happened in the last run' }, stages.map(card));
    host.replaceChildren(make('div', { className: 'pipe-bar' }, make('span', { className: 'pipe-title', textContent: 'Last run' }), make('span', { className: 'pipe-total', textContent: `${ms(total)} in total` }), slowBtn, replayBtn), list);
    host.hidden = false;
  }

  function report(info) {
    if (!host) return;
    last = { ...info, stages: build(info) };
    paint(last.stages, last);
  }

  function init() {
    host = document.getElementById('pipeline');
  }

  return { init, report, replay, clear: () => { if (host) { stop(); host.hidden = true; host.replaceChildren(); last = null; } } };
})();
