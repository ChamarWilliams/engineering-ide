/**
 * Engineering IDE — Interactive Code, Loop & Control Flow Visualizer
 * Provides dynamic SVG execution circuits, animated loopback wires with traveling comets,
 * live pointer tracks, iteration inspectors, variable sparklines, and narrative explainers.
 */
const Visualizer = (() => {
  const $ = (id) => document.getElementById(id);

  // Pointer variable patterns
  const POINTER_RE = /^(i|j|k|l|r|lo|hi|low|high|mid|left|right|pivot|p|q|idx|index|start|end|cur|curr|gap|min_idx|max_idx|step|count|num|val)$/i;

  let deps = null;
  let currentTrace = null;
  let currentSteps = [];
  let currentIdx = 0;
  let activeTab = 'active'; // 'active', 'flow', 'loops', 'all'
  let isPlaying = false;
  let playTimer = null;
  let playbackSpeed = 1;
  let varHistory = new Map(); // varName -> Array of numeric values
  let recursiveFns = new Set(); // Functions that call themselves in the trace
  let loopAnalysis = []; // Detected loops in active code
  let flowModel = null; // Active SVG execution flow model

  let currentZoom = 1.0;

  const SAMPLES = {
    bubblesort: {
      title: 'Bubble Sort & Swaps (Image 4)',
      lang: 'python',
      code: `def bubble_sort(arr):
    n = len(arr)
    # Outer loop controls number of passes
    for i in range(n):
        # Inner loop compares adjacent elements
        for j in range(0, n - i - 1):
            if arr[j] > arr[j + 1]:
                # Swap elements
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
    return arr

def main():
    numbers = [5, 4, 7, 3, 2]
    sorted_nums = bubble_sort(numbers)
    return sorted_nums

result = main()
print("Sorted result:", result)
`,
    },
    factorial: {
      title: 'Factorial',
      lang: 'python',
      code: `def compute_factorial(n):
    factorial = 1
    for i in range(1, n + 1):
        factorial = factorial * i
    return factorial

def main():
    print("Enter a positive integer: 4")
    number = 4
    result = compute_factorial(number)
    return result

main()
`,
    },
    recursion: {
      title: 'Recursion',
      lang: 'python',
      code: `def factorial(x):
    if x <= 1:
        return 1
    return x * factorial(x - 1)

def main():
    num = 4
    return factorial(num)

result = main()
print("Factorial:", result)
`,
    },
    linkedlist: {
      title: 'Linked list',
      lang: 'python',
      code: `class Node:
    def __init__(self, val, next=None):
        self.val = val
        self.next = next

def main():
    values = [22, 2, 77, 6, 43, 76, 89]
    head = None
    curr = None
    for v in values:
        node = Node(v)
        if not head:
            head = node
            curr = node
        else:
            curr.next = node
            curr = node

    target = 4
    p = head
    idx = 0
    while p and idx < 3:
        p = p.next
        idx += 1
    return p.val

main()
`,
    },
    main_loop: {
      title: 'Main() Function Loop Circuit',
      lang: 'python',
      code: `def main():
    numbers = [10, 20, 30, 40, 50]
    total = 0
    print("Entered def main() from script window")

    # Loop calculating cumulative sum
    for num in numbers:
        total += num
        print(f"Inside loop: num = {num}, running total = {total}")

    print("Loop finished inside main()")
    return total

print("Script started in main window")
result = main()
print(f"Back in main window! Final result = {result}")
`,
    },
    binarysearch: {
      title: 'Binary Search (While Loop)',
      lang: 'python',
      code: `def binary_search(arr, target):
    low = 0
    high = len(arr) - 1
    found_idx = -1

    # While loop halves the search range each step
    while low <= high:
        mid = (low + high) // 2
        guess = arr[mid]
        if guess == target:
            found_idx = mid
            break
        elif guess < target:
            low = mid + 1
        else:
            high = mid - 1
            
    return found_idx

def main():
    data = [3, 9, 14, 27, 38, 43, 56, 72, 88]
    target = 43
    return binary_search(data, target)

idx = main()
print(f"Target found at index: {idx}")
`,
    },
  };

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const TRACEABLE = ['python', 'javascript', 'typescript', 'lua', 'shell', 'c', 'cpp', 'rust', 'go'];
  const NONE_WORD = { python: 'None', javascript: 'null', typescript: 'null', lua: 'nil', shell: '', c: 'NULL', cpp: 'NULL', rust: 'None', go: 'nil' };
  const langOf = () => currentTrace?.language || deps?.language?.() || 'python';
  const isPy = () => langOf() === 'python';

  function pointerLabel(p) {
    if (!p) return '';
    if (p.null) return 'NULL';
    if (p.to) return p.i === undefined ? p.to : `${p.to}[${p.i}]`;
    if (p.h) return `heap ${p.h.slice(-4)}`;
    return '';
  }

  function fmtVal(v) {
    if (v === null || v === undefined) return NONE_WORD[langOf()] ?? 'None';
    if (typeof v === 'boolean') return isPy() ? (v ? 'True' : 'False') : String(v);
    if (typeof v === 'number') return String(v);
    if (v.p) return v.p.null ? 'NULL' : `→ ${pointerLabel(v.p)}`;
    if (v.s !== undefined) return isPy() ? `'${v.s}'` : `"${v.s}"`;
    if (v.l) {
      const [open, close] = v.k === 'tuple' ? ['(', ')'] : v.k === 'list' || v.k === 'array' || v.k === 'table' ? ['[', ']'] : ['{', '}'];
      return `${open}${v.l.map(fmtVal).join(', ')}${v.n > v.l.length ? ', …' : ''}${close}`;
    }
    if (v.d) {
      const body = `{${v.d.map(([k, x]) => `${k}: ${fmtVal(x)}`).join(', ')}${v.n > v.d.length ? ', …' : ''}}`;
      return v.k && !isPy() && v.k !== 'Object' ? `${v.k} ${body}` : body;
    }
    return v.r ?? String(v);
  }

  function getNumericArray(vars) {
    for (const [name, val] of Object.entries(vars)) {
      if (val && val.l && val.l.length > 0 && val.l.every((x) => typeof x === 'number')) {
        return { name, items: val.l, raw: val };
      }
    }
    return null;
  }

  // Parse lines to detect loop structures
  function analyzeCodeLoops(code) {
    const lines = (code || '').split('\n');
    const loops = [];
    lines.forEach((lineText, idx) => {
      const lineNum = idx + 1;
      const trimmed = lineText.trim();
      const forMatch = /^for\s+([A-Za-z0-9_,\s]+)\s+in\s+([^:]+):/.exec(trimmed);
      const whileMatch = /^while\s+([^:]+):/.exec(trimmed);

      if (forMatch) {
        loops.push({
          type: 'for',
          line: lineNum,
          vars: forMatch[1].split(',').map((s) => s.trim()),
          iterable: forMatch[2].trim(),
          raw: trimmed,
        });
      } else if (whileMatch) {
        loops.push({
          type: 'while',
          line: lineNum,
          cond: whileMatch[1].trim(),
          raw: trimmed,
        });
      }
    });
    return loops;
  }

  // Build the complete visualizer DOM shell inside .viz-body
  function ensureStructure() {
    const container = document.querySelector('.viz-body');
    if (!container) return;

    if (container.querySelector('.viz-ctrl-bar')) return; // Already initialized

    container.innerHTML = `
      <div class="viz-ctrl-bar">
        <button id="vizBtnPlay" class="viz-btn primary" title="Play/Pause">
          <svg id="vizPlaySvg" viewBox="0 0 16 16"><path d="M4.5 2.9v10.2c0 .4.4.6.7.4l8-5.1a.5.5 0 0 0 0-.8l-8-5.1a.5.5 0 0 0-.7.4Z" fill="currentColor"/></svg>
          <span id="vizPlayLabel">Play</span>
        </button>
        <button id="vizBtnPrev" class="viz-btn" title="Previous step" disabled>&#8249;</button>
        <button id="vizBtnNext" class="viz-btn" title="Next step" disabled>&#8250;</button>
        <input id="vizScrubber" class="viz-scrub-input" type="range" min="0" max="0" value="0" disabled>
        <span id="vizStepCounter" class="viz-step-counter">0/0</span>
        <select id="vizSpeedSelect" class="viz-speed-select" aria-label="Playback speed">
          <option value="0.5">0.5x</option>
          <option value="1" selected>1x</option>
          <option value="2">2x</option>
          <option value="4">4x</option>
        </select>
      </div>

      <div id="vizNotice" class="viz-notice" hidden></div>

      <!-- Live Execution Stage -->
      <div id="vizActiveStage" style="display: none; flex-direction: column; gap: 12px; width: 100%;">
        
        <!-- Only Active Block Stage Canvas (Matching User's Reference Images 1-4) -->
        <div id="vizLoopLanes" class="viz-lanes" hidden></div>
        <div id="vizActiveStageCanvas" class="viz-active-stage-canvas">
          <div id="vizActiveBlockMount" class="viz-active-block-mount">
            <!-- Dynamically mounted Active Block (Loop, Call, Return, or Pointer) -->
          </div>

        </div>

        <!-- Optional Detailed / Flow Views (Toggled via Tabs) -->
        <div id="vizDetailedViews" style="display: none; flex-direction: column; gap: 12px; width: 100%;">
          <!-- Interactive Control Flow & Dynamic SVG Loop Circuit -->
          <div id="vizFlowSection" class="viz-flow-card">
            <div class="viz-flow-header">
              <span class="viz-flow-title">
                <svg width="15" height="15" viewBox="0 0 16 16"><path d="M2.5 8h11M8 2.5v11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="8" r="3" fill="var(--accent, #3574f0)"/></svg>
                Execution Flow &amp; Loop Circuit
              </span>
              <span id="vizFlowStateBadge" class="viz-flow-badge">
                <span class="pulse-dot"></span>
                <span id="vizFlowStateText">Starting Flow</span>
              </span>
            </div>
            <div id="vizFlowSvgWrap" class="viz-flow-svg-wrap">
              <!-- Dynamically populated SVG Graph -->
            </div>
          </div>

          <!-- Hero Loop Tracker Card -->
          <div id="vizLoopSection" class="viz-loop-card">
            <div class="viz-loop-head">
              <span id="vizLoopBadge" class="viz-loop-badge for-loop">
                <span class="pulse-dot"></span>
                <span id="vizLoopType">Loop Active</span>
              </span>
              <span id="vizLoopMeta" class="viz-loop-meta">Line <strong id="vizLoopLine">0</strong></span>
            </div>
            <div id="vizLoopStmt" class="viz-loop-stmt">for item in list:</div>
            <div id="vizCondBox" class="viz-cond-box">
              <span id="vizCondExpr" class="viz-cond-expr">Condition: i &lt; n</span>
              <span id="vizCondResult" class="viz-cond-result true">TRUE</span>
            </div>
            <div class="viz-loop-progress-wrap">
              <div class="viz-loop-progress-labels">
                <span id="vizIterCounter">Iteration #1</span>
                <span id="vizIterPercent">0%</span>
              </div>
              <div class="viz-loop-progress-track">
                <div id="vizIterProgressFill" class="viz-loop-progress-fill" style="width: 0%;"></div>
              </div>
            </div>
            <div id="vizIterTrail" class="viz-iter-trail"></div>
          </div>

          <!-- Plain-English Narrative Card -->
          <div id="vizNarrativeSection" class="viz-narrative-card">
            <div class="viz-narrative-icon">ℹ</div>
            <div class="viz-narrative-content">
              <span id="vizNarrativeLine" class="viz-narrative-line">Line 1:</span>
              <span id="vizNarrativeText">Beginning execution.</span>
            </div>
          </div>

          <!-- Graphical Array & Pointer Stage -->
          <div id="vizDataSection" class="viz-stage-card">
            <div class="viz-stage-head">
              <span class="viz-stage-title">
                <svg width="14" height="14" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 3v10M10 3v10" stroke="currentColor" stroke-width="1.3"/></svg>
                <span id="vizArrayName">Array Elements</span>
              </span>
              <span id="vizArraySize" class="viz-stage-badge">0 items</span>
            </div>
            <div id="vizBarsCanvas" class="viz-bars-container">
              <!-- Dynamically populated bars -->
            </div>
          </div>

          <!-- Variables & Sparklines Grid -->
          <div id="vizVarsSection" class="viz-vars-section">
            <div class="viz-stage-head">
              <span class="viz-stage-title">
                <svg width="14" height="14" viewBox="0 0 16 16"><circle cx="5" cy="5" r="2" fill="currentColor"/><circle cx="11" cy="5" r="2" fill="currentColor"/><circle cx="8" cy="11" r="2" fill="currentColor"/></svg>
                Scope Variables &amp; Trends
              </span>
            </div>
            <div id="vizVarsGrid" class="viz-vars-grid"></div>
          </div>

          <!-- Console Stream Output -->
          <div id="vizOutputSection" class="viz-stage-card" style="padding: 10px;">
            <div class="viz-stage-head" style="margin-bottom: 6px;">
              <span class="viz-stage-title" style="font-size: 11px; color: var(--text-muted, #868a91);">Standard Output</span>
            </div>
            <pre id="vizConsoleStream" class="viz-out" style="max-height: 90px; margin: 0;"></pre>
          </div>
        </div>
      </div>
    `;

    bindEvents();
  }

  function setZoom(val) {
    currentZoom = Math.max(0.6, Math.min(1.6, Math.round(val * 100) / 100));
    const mount = $('vizActiveBlockMount');
    const label = $('vizZoomLevel');
    if (mount) {
      mount.style.transform = `scale(${currentZoom})`;
      mount.style.transformOrigin = 'center top';
    }
    if (label) {
      label.textContent = `${Math.round(currentZoom * 100)}%`;
    }
  }

  function bindEvents() {
    const playBtn = $('vizBtnPlay');
    const prevBtn = $('vizBtnPrev');
    const nextBtn = $('vizBtnNext');
    const nextLoopBtn = $('vizBtnNextLoop');
    const scrubber = $('vizScrubber');
    const speedSelect = $('vizSpeedSelect');
    const runTraceBtn = $('vizBtnRunTrace');
    const emptyRunBtn = $('vizEmptyRunBtn');
    const zoomInBtn = $('vizZoomIn');
    const zoomOutBtn = $('vizZoomOut');

    playBtn?.addEventListener('click', togglePlay);
    prevBtn?.addEventListener('click', () => { pause(); stepDelta(-1); });
    nextBtn?.addEventListener('click', () => { pause(); stepDelta(1); });
    nextLoopBtn?.addEventListener('click', () => { pause(); stepNextLoop(); });
    scrubber?.addEventListener('input', (e) => { pause(); goToStep(Number(e.target.value)); });
    speedSelect?.addEventListener('change', (e) => { playbackSpeed = Number(e.target.value) || 1; });
    zoomInBtn?.addEventListener('click', () => setZoom(currentZoom + 0.15));
    zoomOutBtn?.addEventListener('click', () => setZoom(currentZoom - 0.15));

    runTraceBtn?.addEventListener('click', triggerTrace);
    emptyRunBtn?.addEventListener('click', triggerTrace);

    // Filter tabs
    document.querySelectorAll('.viz-nav-tab').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        document.querySelectorAll('.viz-nav-tab').forEach((b) => b.classList.remove('active'));
        tabBtn.classList.add('active');
        activeTab = tabBtn.dataset.tab;
        applyTabFilter();
      });
    });

    // Sample buttons
    document.querySelectorAll('.viz-sample-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sampleKey = btn.dataset.sample;
        loadSample(sampleKey);
      });
    });
  }

  function applyTabFilter() {
    const canvas = $('vizActiveStageCanvas');
    const detailed = $('vizDetailedViews');
    const flowSec = $('vizFlowSection');
    const loopSec = $('vizLoopSection');
    const narrSec = $('vizNarrativeSection');
    const dataSec = $('vizDataSection');
    const varsSec = $('vizVarsSection');

    if (!canvas || !detailed) return;

    if (activeTab === 'active') {
      canvas.style.display = 'flex';
      detailed.style.display = 'none';
    } else if (activeTab === 'flow') {
      canvas.style.display = 'none';
      detailed.style.display = 'flex';
      if (flowSec) flowSec.style.display = '';
      if (loopSec) loopSec.style.display = 'none';
      if (narrSec) narrSec.style.display = 'none';
      if (dataSec) dataSec.style.display = 'none';
      if (varsSec) varsSec.style.display = 'none';
    } else if (activeTab === 'loops') {
      canvas.style.display = 'none';
      detailed.style.display = 'flex';
      if (flowSec) flowSec.style.display = 'none';
      if (loopSec) loopSec.style.display = '';
      if (narrSec) narrSec.style.display = '';
      if (dataSec) dataSec.style.display = 'none';
      if (varsSec) varsSec.style.display = 'none';
    } else if (activeTab === 'all') {
      canvas.style.display = 'flex';
      detailed.style.display = 'flex';
      if (flowSec) flowSec.style.display = '';
      if (loopSec) loopSec.style.display = '';
      if (narrSec) narrSec.style.display = '';
      if (dataSec) dataSec.style.display = '';
      if (varsSec) varsSec.style.display = '';
    }
  }

  async function loadSample(key) {
    const sample = SAMPLES[key];
    if (!sample || !deps) return;
    if (deps.setCode) deps.setCode(sample.code);
    deps.toast?.(`Loaded ${sample.title}`);
    await triggerTrace();
  }

  let tracedCode = null;
  let tracing = false;

  async function triggerTrace(quiet = false) {
    if (!deps || tracing) return;
    quiet = quiet === true;
    pause();
    const code = deps.code?.();
    if (!code || !code.trim()) {
      if (!quiet) deps.toast?.('Please enter some code to visualize.');
      return;
    }

    loopAnalysis = analyzeCodeLoops(code);
    tracing = true;
    tracedCode = code;

    try {
      const res = await deps.api('POST', '/api/trace', {
        run_id: deps.uid(),
        language: deps.language?.() || 'python',
        code,
        runner: 'server',
      });

      if (res.error) {
        showNotice(res.error, res.stderr);
        if (!quiet) deps.toast?.(res.error);
        return;
      }

      if (res.trace && res.trace.steps && res.trace.steps.length > 0) {
        loadTrace(res.trace, res.stderr, code, res.exit_code);
      } else {
        showNotice(lastLine(res.stderr) || 'The code ran without recording any steps.', res.stderr);
        if (!quiet) deps.toast?.('The code executed without recording trace steps.');
      }
    } catch (err) {
      showNotice(`Tracing failed: ${err.message}`);
      if (!quiet) deps.toast?.(`Execution failed: ${err.message}`);
    } finally {
      tracing = false;
    }
  }

  function panelShown() {
    const panel = document.querySelector('[data-panel="viz"]');
    return Boolean(panel && !panel.classList.contains('is-hidden') && !panel.hidden);
  }

  function autoTrace() {
    if (!panelShown() || isInspecting() || tracing) return;
    if (!TRACEABLE.includes(deps.language?.() || 'python')) {
      showNotice(`The visualizer can't trace ${deps.language?.()} yet.`);
      return;
    }
    const code = deps.code?.() || '';
    if (code === tracedCode) return;
    triggerTrace(true);
  }

  let autoTimer = null;
  function scheduleAutoTrace(delay = 700) {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(autoTrace, delay);
  }

  function lastLine(text) {
    const rows = String(text || '').split('\n').map((r) => r.trim()).filter(Boolean);
    return rows.length ? rows[rows.length - 1] : '';
  }

  function showNotice(text, detail = '') {
    ensureStructure();
    const box = $('vizNotice');
    if (!box) return;
    if (!text) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    box.title = String(detail || '').slice(-600);
    box.textContent = text;
  }

  function loadTrace(trace, stderr = '', codeOverride = null, exitCode = 0) {
    ensureStructure();
    currentTrace = { ...trace, language: trace.language || deps?.language?.() || 'python', stderr };
    currentSteps = trace.steps || [];
    currentIdx = 0;
    varHistory.clear();
    lastMem = null;
    recursiveFns = new Set((trace.events || []).filter((e) => e.e === 'call' && e.caller && e.caller.fn === e.fn).map((e) => e.fn));
    const failed = trace.error || (exitCode ? lastLine(stderr) : '');
    const cutNote = trace.cut ? `Trace stopped early (${trace.cut === 'time' ? 'time limit' : 'step limit'}); showing what ran.` : '';
    showNotice(failed ? `Program stopped: ${failed}` : cutNote, stderr);

    const code = codeOverride || deps?.code?.() || '';
    tracedCode = code;
    loopAnalysis = isPy() ? analyzeCodeLoops(code) : buildTraceLoops(currentSteps, code.split('\n')).map((l) => ({ type: l.kind, line: l.line, vars: l.vars, raw: l.text }));

    const emptyStage = $('vizEmptyStage');
    const activeStage = $('vizActiveStage');
    const scrubber = $('vizScrubber');

    if (emptyStage) emptyStage.style.display = 'none';
    if (activeStage) activeStage.style.display = 'flex';

    if (scrubber) {
      scrubber.disabled = false;
      scrubber.min = 0;
      scrubber.max = Math.max(0, currentSteps.length - 1);
      scrubber.value = 0;
    }

    $('vizBtnPrev')?.removeAttribute('disabled');
    $('vizBtnNext')?.removeAttribute('disabled');
    $('vizBtnNextLoop')?.removeAttribute('disabled');

    // Pre-scan numeric variables for sparklines
    currentSteps.forEach((st) => {
      if (st.vars) {
        Object.entries(st.vars).forEach(([k, v]) => {
          if (typeof v === 'number') {
            if (!varHistory.has(k)) varHistory.set(k, []);
            varHistory.get(k).push(v);
          }
        });
      }
    });

    // Build the dynamic SVG execution flow diagram
    buildFlowModel(code, trace);

    applyTabFilter();
    goToStep(0);
  }

  /* -------------------------------------------------------------
     Dynamic SVG Flow & Loop Circuit Engine
     Renders Caller -> def func() -> Loop Header -> Loop Body ->
     Curved Loopback Wire (with Comet) -> Return -> Caller Return
  ------------------------------------------------------------- */
  function buildFlowModel(code, trace) {
    const wrap = $('vizFlowSvgWrap');
    if (!wrap) return;

    const lines = (code || '').split('\n');
    const events = trace.events || [];

    // Find function call event (e.g. main)
    const callEv = events.find((e) => e.e === 'call' && e.fn !== '<module>');
    const retEv = events.find((e) => e.e === 'ret' && callEv && e.fn === callEv.fn);

    const hasFunc = Boolean(callEv);
    const funcName = callEv ? callEv.fn : 'main';
    const callerLine = callEv?.caller?.line || 1;
    const defLine = callEv?.line || 1;

    // Detect loop
    const matchedLoop = loopAnalysis[0] || null;
    const loopLine = matchedLoop ? matchedLoop.line : (defLine + 2);
    const loopStmt = matchedLoop ? matchedLoop.raw : 'for item in items:';

    // Identify statement lines in loop body
    const bodyLines = [];
    if (matchedLoop) {
      const loopIndent = lines[matchedLoop.line - 1]?.match(/^(\s*)/)?.[1].length || 0;
      for (let i = matchedLoop.line; i < lines.length; i++) {
        const lineText = lines[i];
        if (!lineText.trim()) continue;
        const indent = lineText.match(/^(\s*)/)?.[1].length || 0;
        if (indent > loopIndent) {
          bodyLines.push(i + 1);
        } else {
          break;
        }
      }
    }

    // Return line inside function
    let returnLine = null;
    lines.forEach((l, idx) => {
      if (/^\s*return\b/.test(l)) returnLine = idx + 1;
    });

    flowModel = {
      hasFunc,
      funcName,
      callerLine,
      defLine,
      loopLine,
      bodyLines,
      returnLine,
      matchedLoop,
      totalIterations: 0,
    };

    // Calculate total loop iterations from steps
    currentSteps.forEach((st) => {
      if (st.line === loopLine) flowModel.totalIterations++;
    });

    // Generate SVG Canvas
    const svgHtml = `
      <svg id="vizFlowSvg" class="viz-flow-svg" viewBox="0 0 460 520" preserveAspectRatio="xMidYMid meet">
        <defs>
          <!-- Arrowheads -->
          <marker id="flow-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b" />
          </marker>
          <marker id="flow-arrow-active" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
          </marker>
          <marker id="flow-arrow-loop" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#34d399" />
          </marker>
        </defs>

        <!-- WIRES (Drawn behind nodes) -->
        
        <!-- Wire 1: Caller -> def func() -->
        <path id="flowWire1" class="flow-wire" d="M 230 60 L 230 96" marker-end="url(#flow-arrow)"/>
        <text id="flowWire1Label" class="flow-wire-label" x="238" y="80">call ${funcName}()</text>
        <circle id="flowComet1" class="flow-comet" r="4.5">
          <animateMotion dur="0.8s" repeatCount="indefinite" path="M 230 60 L 230 96"/>
        </circle>

        <!-- Wire 2: Function Setup -> Loop Header -->
        <path id="flowWire2" class="flow-wire" d="M 230 144 L 230 180" marker-end="url(#flow-arrow)"/>
        <text id="flowWire2Label" class="flow-wire-label" x="238" y="164">enter loop</text>
        <circle id="flowComet2" class="flow-comet" r="4.5">
          <animateMotion dur="0.8s" repeatCount="indefinite" path="M 230 144 L 230 180"/>
        </circle>

        <!-- Wire 3: Loop Header -> Loop Body (Condition TRUE) -->
        <path id="flowWire3" class="flow-wire" d="M 230 232 L 230 270" marker-end="url(#flow-arrow)"/>
        <text id="flowWire3Label" class="flow-wire-label" x="238" y="254">[ TRUE / Next Item ]</text>
        <circle id="flowComet3" class="flow-comet" r="4.5">
          <animateMotion dur="0.8s" repeatCount="indefinite" path="M 230 232 L 230 270"/>
        </circle>

        <!-- Wire 4: Loopback Back-Edge Wire (Body -> Header) -->
        <path id="flowWireLoopback" class="flow-wire loopback" d="M 355 298 C 428 298 428 206 345 206" marker-end="url(#flow-arrow-loop)"/>
        <g id="flowLoopbackBadgeWrap" transform="translate(385, 238)">
          <rect class="loopback-tag" x="0" y="0" width="70" height="22" rx="11"/>
          <text id="flowLoopbackBadgeText" class="loopback-text" x="35" y="11">Iter #1</text>
        </g>
        <circle id="flowCometLoopback" class="flow-comet loopback-comet" r="5">
          <animateMotion id="flowAnimLoopback" dur="0.9s" repeatCount="indefinite" path="M 355 298 C 428 298 428 206 345 206"/>
        </circle>

        <!-- Wire 5: Exit Loop Wire (Header -> Return) -->
        <path id="flowWireExit" class="flow-wire" d="M 115 206 C 45 206 45 378 122 378" marker-end="url(#flow-arrow)"/>
        <text id="flowWireExitLabel" class="flow-wire-label" x="50" y="280">[ FALSE / Done ]</text>
        <circle id="flowCometExit" class="flow-comet" r="4.5">
          <animateMotion dur="1s" repeatCount="indefinite" path="M 115 206 C 45 206 45 378 122 378"/>
        </circle>

        <!-- Wire 6: Return -> Caller Resume -->
        <path id="flowWire6" class="flow-wire" d="M 230 402 L 230 440" marker-end="url(#flow-arrow)"/>
        <text id="flowWire6Label" class="flow-wire-label" x="238" y="422">return result</text>
        <circle id="flowComet6" class="flow-comet" r="4.5">
          <animateMotion dur="0.8s" repeatCount="indefinite" path="M 230 402 L 230 440"/>
        </circle>

        <!-- NODES (Interactive clickable stages) -->

        <!-- Node 1: Script Caller / Main Window -->
        <g id="flowNodeCaller" class="flow-node caller" data-step-target="caller">
          <rect class="flow-node-box" x="120" y="16" width="220" height="44" rx="8"/>
          <text class="flow-node-title" x="230" y="34" text-anchor="middle">Script (Main Window)</text>
          <text id="flowNodeCallerSub" class="flow-node-sub" x="230" y="49" text-anchor="middle">Line ${callerLine}: ${hasFunc ? `Calls ${funcName}()` : 'Script start'}</text>
        </g>

        <!-- Node 2: Function Entry -->
        <g id="flowNodeFunc" class="flow-node func-entry" data-step-target="func">
          <rect class="flow-node-box" x="110" y="96" width="240" height="48" rx="8"/>
          <text class="flow-node-title" x="230" y="116" text-anchor="middle">def ${funcName}():</text>
          <text id="flowNodeFuncSub" class="flow-node-sub" x="230" y="132" text-anchor="middle">Local Scope & Setup</text>
        </g>

        <!-- Node 3: Loop Header / Decision -->
        <g id="flowNodeLoopHead" class="flow-node loop-head" data-step-target="loopHead">
          <rect class="flow-node-box" x="100" y="180" width="260" height="52" rx="10"/>
          <text class="flow-node-title" x="230" y="201" text-anchor="middle">⯁ ${loopStmt.length > 32 ? loopStmt.slice(0, 30) + '…' : loopStmt}</text>
          <text id="flowNodeLoopHeadSub" class="flow-node-sub" x="230" y="218" text-anchor="middle">Condition: Evaluating</text>
        </g>

        <!-- Node 4: Loop Body -->
        <g id="flowNodeLoopBody" class="flow-node loop-body" data-step-target="loopBody">
          <rect class="flow-node-box" x="90" y="270" width="280" height="60" rx="8"/>
          <text class="flow-node-title" x="230" y="292" text-anchor="middle">Loop Body Statements</text>
          <text id="flowNodeLoopBodySub" class="flow-node-sub" x="230" y="313" text-anchor="middle">Executing statements…</text>
        </g>

        <!-- Node 5: Return / Exit Function -->
        <g id="flowNodeReturn" class="flow-node exit-node" data-step-target="return">
          <rect class="flow-node-box" x="120" y="356" width="220" height="46" rx="8"/>
          <text class="flow-node-title" x="230" y="376" text-anchor="middle">return statement</text>
          <text id="flowNodeReturnSub" class="flow-node-sub" x="230" y="392" text-anchor="middle">Exit ${funcName}()</text>
        </g>

        <!-- Node 6: Back to Main Window / Caller Scope -->
        <g id="flowNodeCallerRet" class="flow-node caller-return" data-step-target="callerRet">
          <rect class="flow-node-box" x="105" y="440" width="250" height="48" rx="8"/>
          <text class="flow-node-title" x="230" y="460" text-anchor="middle">Back in Main Window</text>
          <text id="flowNodeCallerRetSub" class="flow-node-sub" x="230" y="476" text-anchor="middle">Execution Complete</text>
        </g>
      </svg>
    `;

    wrap.innerHTML = svgHtml;

    // Node click handlers jump to relevant execution steps
    wrap.querySelectorAll('.flow-node').forEach((nodeEl) => {
      nodeEl.addEventListener('click', () => {
        const target = nodeEl.dataset.stepTarget;
        jumpToFlowTarget(target);
      });
    });
  }

  function jumpToFlowTarget(target) {
    if (!flowModel || !currentSteps.length) return;
    pause();

    let targetIdx = -1;
    if (target === 'caller') {
      targetIdx = currentSteps.findIndex((st) => st.fn === '<module>');
    } else if (target === 'func') {
      targetIdx = currentSteps.findIndex((st) => st.fn === flowModel.funcName);
    } else if (target === 'loopHead') {
      targetIdx = currentSteps.findIndex((st, i) => i >= currentIdx && st.line === flowModel.loopLine);
      if (targetIdx === -1) targetIdx = currentSteps.findIndex((st) => st.line === flowModel.loopLine);
    } else if (target === 'loopBody') {
      targetIdx = currentSteps.findIndex((st, i) => i >= currentIdx && flowModel.bodyLines.includes(st.line));
      if (targetIdx === -1) targetIdx = currentSteps.findIndex((st) => flowModel.bodyLines.includes(st.line));
    } else if (target === 'return') {
      targetIdx = currentSteps.findIndex((st) => st.line === flowModel.returnLine);
    } else if (target === 'callerRet') {
      targetIdx = currentSteps.length - 1;
    }

    if (targetIdx >= 0) goToStep(targetIdx);
  }

  // Update dynamic SVG flow diagram state on each step
  function renderFlowGraph(step, prev, idx) {
    if (!flowModel) return;

    const badge = $('vizFlowStateBadge');
    const badgeText = $('vizFlowStateText');

    // Clear active classes from all nodes, wires, comets
    document.querySelectorAll('.flow-node.active').forEach((n) => n.classList.remove('active'));
    document.querySelectorAll('.flow-wire.active').forEach((w) => {
      w.classList.remove('active');
      if (w.getAttribute('marker-end')?.includes('flow-arrow-active')) {
        w.setAttribute('marker-end', 'url(#flow-arrow)');
      }
    });
    document.querySelectorAll('.flow-comet.active').forEach((c) => c.classList.remove('active'));

    const isModule = step.fn === '<module>';
    const isFunc = step.fn === flowModel.funcName;
    const isLoopHead = step.line === flowModel.loopLine;
    const isLoopBody = flowModel.bodyLines.includes(step.line);
    const isReturn = flowModel.returnLine && step.line === flowModel.returnLine;
    const isAfterFunc = isModule && idx > (currentSteps.findIndex((s) => s.fn === flowModel.funcName) || 0);

    // Calculate iteration counter
    let currentIter = 0;
    currentSteps.slice(0, idx + 1).forEach((st) => {
      if (st.line === flowModel.loopLine) currentIter++;
    });

    // Detect state
    if (isAfterFunc && idx >= currentSteps.length - 2) {
      // 1. Back in Main Window (Execution Complete)
      const n = $('flowNodeCallerRet');
      const w = $('flowWire6');
      const c = $('flowComet6');
      n?.classList.add('active');
      w?.classList.add('active');
      w?.setAttribute('marker-end', 'url(#flow-arrow-active)');
      c?.classList.add('active');

      const retSub = $('flowNodeCallerRetSub');
      if (retSub && step.vars) {
        const resKey = Object.keys(step.vars).find((k) => /result|ans|out|res|total/i.test(k)) || Object.keys(step.vars)[0];
        if (resKey) retSub.textContent = `Received: ${resKey} = ${fmtVal(step.vars[resKey])}`;
      }
      if (badgeText) badgeText.textContent = 'Back in Main Window';
      if (badge) badge.className = 'viz-flow-badge';
    } else if (isReturn) {
      // 2. Return statement inside function
      const n = $('flowNodeReturn');
      const w = $('flowWireExit');
      const c = $('flowCometExit');
      n?.classList.add('active');
      w?.classList.add('active');
      w?.setAttribute('marker-end', 'url(#flow-arrow-active)');
      c?.classList.add('active');

      const retSub = $('flowNodeReturnSub');
      if (retSub && step.vars) {
        const retVal = Object.values(step.vars)[0];
        retSub.textContent = `Returning: ${fmtVal(retVal)}`;
      }
      if (badgeText) badgeText.textContent = `Returning from ${flowModel.funcName}()`;
    } else if (isLoopBody) {
      // 3. Inside Loop Body
      const n = $('flowNodeLoopBody');
      const w = $('flowWire3');
      const c = $('flowComet3');
      n?.classList.add('active');
      w?.classList.add('active');
      w?.setAttribute('marker-end', 'url(#flow-arrow-active)');
      c?.classList.add('active');

      // Update live expressions in loop body node
      const sub = $('flowNodeLoopBodySub');
      if (sub && step.vars) {
        const varEntries = Object.entries(step.vars).filter(([k]) => !k.startsWith('_')).slice(0, 3);
        const expr = varEntries.map(([k, v]) => `${k}=${fmtVal(v)}`).join(' | ');
        sub.textContent = expr || `Executing line ${step.line}`;
      }
      if (badgeText) badgeText.textContent = `In Loop: Iteration #${currentIter} of ${flowModel.totalIterations}`;
    } else if (isLoopHead) {
      // 4. Loop Header / Condition Evaluation
      const n = $('flowNodeLoopHead');
      n?.classList.add('active');

      // Was previous step in loop body? That means we just LOOPED BACK!
      const prevWasBody = prev && (flowModel.bodyLines.includes(prev.line) || prev.line > flowModel.loopLine);
      if (prevWasBody) {
        const wLoop = $('flowWireLoopback');
        const cLoop = $('flowCometLoopback');
        wLoop?.classList.add('active');
        cLoop?.classList.add('active');

        const bText = $('flowLoopbackBadgeText');
        if (bText) bText.textContent = `Iter #${currentIter}`;
        if (badgeText) badgeText.textContent = `↻ Looping: Iteration #${currentIter} of ${flowModel.totalIterations}`;
      } else {
        const w = $('flowWire2');
        const c = $('flowComet2');
        w?.classList.add('active');
        w?.setAttribute('marker-end', 'url(#flow-arrow-active)');
        c?.classList.add('active');
        if (badgeText) badgeText.textContent = `Checking Loop Header (Line ${step.line})`;
      }

      const sub = $('flowNodeLoopHeadSub');
      if (sub) {
        sub.textContent = `Iteration ${currentIter} of ${flowModel.totalIterations} (Condition: TRUE)`;
      }
    } else if (isFunc) {
      // 5. Function Entry & Setup
      const n = $('flowNodeFunc');
      const w = $('flowWire1');
      const c = $('flowComet1');
      n?.classList.add('active');
      w?.classList.add('active');
      w?.setAttribute('marker-end', 'url(#flow-arrow-active)');
      c?.classList.add('active');

      const sub = $('flowNodeFuncSub');
      if (sub && step.vars) {
        const keys = Object.keys(step.vars);
        sub.textContent = keys.length ? `Vars: ${keys.slice(0, 2).map((k) => `${k}=${fmtVal(step.vars[k])}`).join(', ')}` : `Inside ${flowModel.funcName}()`;
      }
      if (badgeText) badgeText.textContent = `Entered def ${flowModel.funcName}()`;
    } else {
      // 6. Script caller (Main Window)
      const n = $('flowNodeCaller');
      n?.classList.add('active');
      if (badgeText) badgeText.textContent = 'Script Entry in Main Window';
    }
  }

  /* -------------------------------------------------------------
     Active Block Rendering Engine (Matches Reference Images 1 - 4)
     Shows ONLY the Active Block for the current execution step.
  ------------------------------------------------------------- */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderVarRows(vars) {
    if (!vars) return '<tr><td colspan="2" style="color: #64748b; text-align: center; padding: 6px;">No local variables</td></tr>';
    const entries = Object.entries(vars).filter(([k]) => !k.startsWith('_'));
    if (!entries.length) return '<tr><td colspan="2" style="color: #64748b; text-align: center; padding: 6px;">No local variables</td></tr>';
    return entries.map(([k, v]) => `
      <tr>
        <td class="var-key">${escapeHtml(k)}</td>
        <td class="var-val">${escapeHtml(fmtVal(v))}</td>
      </tr>
    `).join('');
  }

  function renderReturnActiveBlock(mount, step, prev, idx, funcName, vars) {
    let callerVars = {};
    for (let i = idx - 1; i >= 0; i--) {
      if (currentSteps[i].fn === '<module>' && currentSteps[i].vars) {
        callerVars = currentSteps[i].vars;
        break;
      }
    }
    if (!Object.keys(callerVars).length) {
      callerVars = currentSteps[0]?.vars || {};
    }

    let retVal = null;
    if (vars.result !== undefined) retVal = vars.result;
    else if (vars.sorted_nums !== undefined) retVal = vars.sorted_nums;
    else if (vars.factorial !== undefined) retVal = vars.factorial;
    else if (vars.total !== undefined) retVal = vars.total;
    else if (vars.arr !== undefined) retVal = vars.arr;
    else {
      const vals = Object.values(vars);
      retVal = vals.length ? vals[vals.length - 1] : null;
    }

    let stdoutText = '';
    if (currentTrace && currentTrace.stdout) {
      stdoutText = currentTrace.stdout.slice(0, step.out || currentTrace.stdout.length).trim();
    }

    mount.innerHTML = `
      <div style="width: 100%; max-width: 530px; display: flex; flex-direction: column; align-items: center;">
        <!-- Top Output Block (Image 3) -->
        ${stdoutText ? `<div class="viz-output-block">
          <div class="viz-output-tab">Output</div>
          <pre class="viz-output-text">${escapeHtml(stdoutText)}</pre>
        </div>` : ''}

        <!-- Connected Blocks -->
        <div class="viz-split-block-stage" style="align-items: flex-start; gap: 20px;">
          <!-- Main Block (Left, Green Dashed Border) -->
          <div class="viz-frame-box">
            <div class="viz-active-block-card active-return" style="border: 1.5px dashed #4ade80; box-shadow: 0 0 18px rgba(74, 222, 128, 0.2);">
              <div class="viz-attached-tab" style="border-color: #4ade80; color: #4ade80;">Main Block</div>
              <div class="viz-sub-tab">Variables</div>
              <table class="viz-var-table">
                ${renderVarRows(callerVars)}
              </table>
            </div>
          </div>

          <!-- Curved Green Arrow with Returns Pill (Image 3) -->
          <div class="viz-wire-bridge" style="position: relative; width: 110px; height: 90px; align-self: flex-end; margin-bottom: 6px;">
            <svg style="position: absolute; width: 100%; height: 100%; overflow: visible; pointer-events: none;">
              <defs>
                <marker id="ret-arrow-green" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#4ade80" />
                </marker>
              </defs>
              <path d="M 105 65 C 65 85, 20 72, 4 22" fill="none" stroke="#4ade80" stroke-width="1.8" stroke-dasharray="4 3" marker-end="url(#ret-arrow-green)"/>
            </svg>
            <div class="viz-return-pill" style="position: absolute; bottom: 32px; left: -14px; z-index: 4;">
              Returns <span class="viz-pill-val">${escapeHtml(fmtVal(retVal))}</span>
            </div>
          </div>

          <!-- Function Block (Right) -->
          <div class="viz-frame-box">
            <div class="viz-active-block-card" style="border: 1.5px dashed rgba(255, 255, 255, 0.25);">
              <div class="viz-attached-tab" style="line-height: 1.35;">
                <span style="font-size: 10.5px; color: #38bdf8;">function</span><br>${escapeHtml(funcName)}(${Object.values(vars)[0] !== undefined ? escapeHtml(fmtVal(Object.values(vars)[0])) : ''})
              </div>
              <table class="viz-var-table" style="margin-top: 2px;">
                ${renderVarRows(vars)}
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  let lastBars = null;
  let lastFrames = 0;

  function animateBars(mount, items, prev, a, b) {
    const bars = [...mount.querySelectorAll('.viz-bar-rect')];
    if (bars.length < 2) return;
    const pitch = bars[1].getBoundingClientRect().left - bars[0].getBoundingClientRect().left;
    const changed = prev ? items.map((_, i) => i).filter((i) => prev[i] !== items[i]) : [];
    if (changed.length === 2 && prev[changed[0]] === items[changed[1]] && prev[changed[1]] === items[changed[0]]) {
      const [p, q] = changed;
      const dx = (q - p) * pitch;
      const opts = { duration: 560, easing: 'cubic-bezier(.3,.7,.3,1)' };
      bars[p].animate([{ transform: `translateX(${dx}px)` }, { transform: `translate(${dx / 2}px, -48px)`, offset: 0.5 }, { transform: 'none' }], opts);
      bars[q].animate([{ transform: `translateX(${-dx}px)` }, { transform: `translate(${-dx / 2}px, -16px)`, offset: 0.5 }, { transform: 'none' }], opts);
      return;
    }
    for (const k of [a, b]) {
      bars[k]?.animate([{ outline: '2px solid #f5b942', outlineOffset: '2px' }, { outline: '2px solid rgba(245, 185, 66, 0)', outlineOffset: '9px' }], { duration: 650, easing: 'ease-out' });
    }
    for (const i of changed) bars[i].animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 300 });
  }

  function markKind(mount, kind) {
    if (mount.dataset.kind === kind) return;
    mount.dataset.kind = kind;
    mount.classList.remove('enter');
    void mount.offsetWidth;
    mount.classList.add('enter');
  }

  function renderLoopActiveBlock(mount, step, prev, idx, vars) {
    let currentIter = 1;
    const loopLine = flowModel?.loopLine || (loopAnalysis[0]?.line) || step.line;
    currentSteps.slice(0, idx + 1).forEach((st) => {
      if (st.line === loopLine) currentIter++;
    });

    const primaryLoopVar = (vars.i !== undefined) ? 'i' : (vars.step !== undefined) ? 'step' : (vars.j !== undefined) ? 'j' : 'i';
    const primaryLoopVal = vars[primaryLoopVar] !== undefined ? vars[primaryLoopVar] : (currentIter - 1);

    const arrInfo = getNumericArray(vars);

    if (arrInfo && arrInfo.items.length) {
      const items = arrInfo.items;
      let idxA = 0;
      let idxB = 1;

      if (vars.j !== undefined) {
        idxA = vars.j;
        idxB = vars.j + 1;
      } else if (vars.i !== undefined) {
        idxA = vars.i;
        idxB = Math.min(items.length - 1, vars.i + 1);
      }
      idxA = Math.max(0, Math.min(idxA, items.length - 1));
      idxB = Math.max(0, Math.min(idxB, items.length - 1));

      const valA = items[idxA];
      const valB = items[idxB];
      const isSwapping = (valA > valB);
      const maxVal = Math.max(...items, 1);

      const colWidth = 46;
      const colGap = 16;
      const totalW = items.length * (colWidth + colGap) - colGap;
      const cx = (k) => k * (colWidth + colGap) + colWidth / 2;
      const x1 = cx(idxA);
      const x2 = cx(idxB);
      const prevBars = lastBars && lastBars.key === arrInfo.name && lastBars.items.length === items.length ? lastBars.items : null;
      const nameA = vars.j !== undefined ? 'j' : 'i';
      const labelOf = (k) => (k === idxA ? nameA : k === idxB ? `${nameA}+1` : String(k));

      mount.innerHTML = `
        <div class="viz-active-block-card active-loop">
          <div class="viz-attached-tab">
            <span style="color: #6ee7b7;">loop iteration ${currentIter}</span>
            <span style="color: #e2e8f0;">${primaryLoopVar} = ${primaryLoopVal}</span>
          </div>
          <div class="viz-bars-wrap" style="width: ${totalW}px;">
            <div class="viz-bars-stage">
              ${items.map((val, k) => {
                const isActive = (k === idxA || k === idxB);
                const heightPx = Math.round(40 + (val / maxVal) * 120);
                return `
                  <div class="viz-bar-item" style="width: ${colWidth}px;">
                    <div class="viz-bar-rect ${isActive ? 'active' : ''}" style="height: ${heightPx}px;">${val}</div>
                    <div class="viz-bar-label ${isActive ? 'active' : ''}">${labelOf(k)}</div>
                  </div>`;
              }).join('')}
            </div>
            <svg class="viz-swap-arc-svg" viewBox="0 0 ${totalW} 30" width="${totalW}" height="30">
              <defs>
                <marker id="green-arrow-up" viewBox="0 0 10 10" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M 0 8 L 5 0 L 10 8 z" fill="#4ade80" />
                </marker>
              </defs>
              <path class="viz-arc-path ${isSwapping ? 'swap' : 'keep'}" d="M ${x1} 3 C ${x1} 28, ${x2} 28, ${x2} 3" fill="none" stroke="#4ade80" stroke-width="2" marker-start="url(#green-arrow-up)" marker-end="url(#green-arrow-up)"/>
            </svg>
          </div>
          <div class="viz-loop-narrative">
            <div><span class="viz-pill-val">${valA}</span> &gt; <span class="viz-pill-val">${valB}</span> ${isSwapping ? 'so they swap' : 'is false, they stay'}</div>
          </div>
          <table class="viz-var-table" style="margin-top: 14px;">
            ${renderVarRows(vars)}
          </table>
        </div>
      `;
      animateBars(mount, items, prevBars, idxA, idxB);
      lastBars = { key: arrInfo.name, items: [...items] };
    } else {
      // Non-array loop (e.g. accumulator)
      mount.innerHTML = `
        <div class="viz-active-block-card active-loop" style="max-width: 440px;">
          <!-- Attached Solid Top-Left Tab -->
          <div class="viz-attached-tab">
            <span style="color: #6ee7b7;">loop iteration ${currentIter}</span>
            <span style="color: #e2e8f0;">${primaryLoopVar} = ${primaryLoopVal}</span>
          </div>

          <!-- Accumulator / Step Graphic -->
          <div style="display: flex; align-items: center; justify-content: center; gap: 14px; padding: 22px 10px;">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
              <span style="font-size: 10px; color: #94a3b8; font-family: var(--mono);">TOTAL</span>
              <div class="viz-pill-val" style="font-size: 18px; padding: 6px 16px; border-color: #38bdf8; color: #38bdf8;">
                ${vars.total !== undefined ? vars.total : 0}
              </div>
            </div>
            <div style="font-size: 22px; color: #4ade80; font-family: var(--mono); font-weight: 700;">+</div>
            <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
              <span style="font-size: 10px; color: #94a3b8; font-family: var(--mono);">ITEM</span>
              <div class="viz-pill-val" style="font-size: 18px; padding: 6px 16px; border-color: #4ade80; color: #4ade80;">
                ${vars.num !== undefined ? vars.num : vars.val ?? vars.i ?? 0}
              </div>
            </div>
          </div>

          <!-- Monospace Narrative -->
          <div class="viz-loop-narrative">
            <div><span class="viz-narrative-green">accumulating</span> loop step ${currentIter} <span class="viz-narrative-green">:</span></div>
            <div>value <span class="viz-pill-val">${vars.num ?? vars.val ?? 0}</span> added to total ➔ <span class="viz-pill-val">${vars.total ?? 0}</span></div>
          </div>

          <!-- 2-Column Variables Table -->
          <table class="viz-var-table" style="margin-top: 14px;">
            ${renderVarRows(vars)}
          </table>
        </div>
      `;
    }
  }

  function renderPointerActiveBlock(mount, step, prev, idx, vars) {
    const arr = getNumericArray(vars);
    const listValues = arr ? arr.items.slice(0, 12) : [];
    const ptrKey = ['idx', 'index', 'i'].find((k) => typeof vars[k] === 'number');
    const cur = ptrKey ? Math.max(0, Math.min(vars[ptrKey], listValues.length - 1)) : 0;
    const note = vars.p === null ? 'p is None' : (ptrKey ? `${ptrKey} = ${vars[ptrKey]}` : 'following next');

    mount.innerHTML = `
      <div class="viz-ptr-container">
        <div class="viz-ptr-status-box">
          line ${step.line}: <span style="color: #4ade80; font-weight: 500;">${escapeHtml(note)}</span>
        </div>
        <div class="viz-dotted-divider"></div>
        <div class="viz-node-chain-wrap">
          <div class="viz-node-chain-row" style="flex-wrap: wrap; row-gap: 18px;">
            ${listValues.length ? listValues.map((val, i) => {
              const isCur = i === cur;
              return `
                <div class="viz-node-unit">
                  ${isCur ? '<div class="viz-node-cur-tag">current</div>' : ''}
                  <div class="viz-node-box ${isCur ? 'active-current' : ''}">
                    <div class="viz-node-val">${val}</div>
                    <div class="viz-node-ptr"><div class="viz-node-dot ${isCur ? 'green' : ''}"></div></div>
                  </div>
                  <div class="viz-node-lbl">${i === 0 ? 'head' : `p${i}`}</div>
                </div>
                <div class="viz-node-wire ${isCur ? 'green' : ''}">${i < listValues.length - 1 ? '➔' : '➔ none'}</div>
              `;
            }).join('') : '<div class="viz-node-lbl">No list in scope yet</div>'}
          </div>
        </div>
        <table class="viz-var-table" style="margin-top: 14px;">${renderVarRows(vars)}</table>
      </div>
    `;
  }

  function renderRecursionActiveBlock(mount, step, prev, idx, funcName, vars) {
    const argKey = Object.keys(vars).find((k) => !k.startsWith('_')) || 'x';
    const curX = vars[argKey];
    const frames = [];
    for (let i = 0; i <= idx; i++) {
      const st = currentSteps[i];
      const v = st.fn === step.fn && st.vars ? st.vars[argKey] : undefined;
      if (typeof v === 'number' && !frames.includes(v)) frames.push(v);
    }
    if (typeof curX === 'number' && !frames.includes(curX)) frames.push(curX);
    let callerVars = {};
    for (let i = idx; i >= 0; i--) {
      if (currentSteps[i].fn === '<module>' && currentSteps[i].vars) { callerVars = currentSteps[i].vars; break; }
    }

    const prevFrames = lastFrames;
    lastFrames = frames.length;
    mount.innerHTML = `
      <div class="viz-call-stage">
        <!-- Main Block (Left, Image 2) -->
        <div class="viz-frame-box" style="max-width: 200px;">
          <div class="viz-active-block-card" style="border: 1.5px dashed rgba(255, 255, 255, 0.25);">
            <div class="viz-attached-tab">Main Block</div>
            <div class="viz-sub-tab">Variables</div>
            <table class="viz-var-table">
              ${renderVarRows(callerVars)}
            </table>
          </div>
        </div>

        <!-- Curved Blue Arrow SVG (Image 2) -->
        <svg class="viz-call-curve-svg" viewBox="0 0 110 60">
          <defs>
            <marker id="call-arrow-blue" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
            </marker>
          </defs>
          <path d="M 0 45 C 50 45, 70 15, 105 15" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-dasharray="4 3" marker-end="url(#call-arrow-blue)"/>
        </svg>

        <!-- Recursion Stack Column (Right, Image 2) -->
        <div class="viz-stack-column">
          ${frames.map((val, i) => {
            const isActive = val === curX;
            const isNew = isActive && frames.length > prevFrames;
            return `
              <div class="viz-stack-frame ${isActive ? 'active-frame' : ''} ${isNew ? 'drop-in' : ''}">
                <div class="viz-attached-tab" style="${isActive ? 'border-color: #38bdf8; color: #38bdf8;' : ''}">
                  <span style="font-size: 10px; color: #94a3b8;">function</span><br>${escapeHtml(funcName)}(${val})
                </div>
                <table class="viz-var-table" style="margin-top: 2px;">
                  <tr><td class="var-key">${escapeHtml(argKey)}</td><td class="var-val">${val}</td></tr>
                </table>
              </div>
              ${i < frames.length - 1 ? `<div class="viz-stack-arrow-down ${isActive ? 'active' : ''}">↓</div>` : ''}
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderCallActiveBlock(mount, step, prev, idx, funcName, vars) {
    mount.innerHTML = `
      <div class="viz-split-block-stage" style="align-items: flex-start; max-width: 500px;">
        <!-- Main Block (Left) -->
        <div class="viz-frame-box">
          <div class="viz-active-block-card" style="border: 1.5px dashed rgba(255, 255, 255, 0.25);">
            <div class="viz-attached-tab">Main Block</div>
            <div class="viz-sub-tab">Variables</div>
            <table class="viz-var-table">
              <tr><td class="var-key">status</td><td class="var-val">Calling ${escapeHtml(funcName)}()</td></tr>
            </table>
          </div>
        </div>

        <!-- Wire -->
        <div class="viz-wire-bridge" style="width: 80px; height: 50px;">
          <svg style="width: 100%; height: 100%; overflow: visible; pointer-events: none;">
            <defs>
              <marker id="call-arrow-blue2" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
              </marker>
            </defs>
            <path d="M 0 25 L 75 25" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-dasharray="4 3" marker-end="url(#call-arrow-blue2)"/>
          </svg>
        </div>

        <!-- Function Block (Right) -->
        <div class="viz-frame-box">
          <div class="viz-active-block-card active-loop" style="border: 1.5px dashed #38bdf8; box-shadow: 0 0 16px rgba(56, 189, 248, 0.2);">
            <div class="viz-attached-tab" style="border-color: #38bdf8; color: #38bdf8;">
              <span style="font-size: 10px;">function</span><br>${escapeHtml(funcName)}()
            </div>
            <table class="viz-var-table" style="margin-top: 2px;">
              ${renderVarRows(vars)}
            </table>
          </div>
        </div>
      </div>
    `;
  }

  function renderScriptStartActiveBlock(mount, step, vars) {
    mount.innerHTML = `
      <div class="viz-active-block-card" style="max-width: 440px; border: 1.5px dashed rgba(255, 255, 255, 0.25);">
        <div class="viz-attached-tab">Main Block</div>
        <div class="viz-sub-tab">Variables</div>
        <table class="viz-var-table" style="margin-top: 2px;">
          ${renderVarRows(Object.keys(vars).length ? vars : { status: 'Script starting in main window...' })}
        </table>
      </div>
    `;
  }

  /* Memory view: arrays as cells, pointers as chips under the cell they point at, heap nodes as a chain */
  let lastMem = null;

  const isPtr = (v) => Boolean(v && typeof v === 'object' && v.p && v.s === undefined);
  const hasPointers = (vars) => Object.values(vars || {}).some(isPtr);
  const tagKey = (p) => (!p || p.null ? null : p.to ? (p.i === undefined ? p.to : `${p.to}#${p.i}`) : p.h ? `heap:${p.h}` : null);

  function memNotes(vars, prevVars) {
    const notes = [];
    for (const [k, v] of Object.entries(vars)) {
      const before = prevVars[k];
      if (isPtr(v)) {
        const now = v.p.null ? 'NULL' : pointerLabel(v.p);
        if (isPtr(before)) {
          const was = before.p.null ? 'NULL' : pointerLabel(before.p);
          if (was !== now) notes.push(`${k} now points to ${now} (was ${was})`);
        } else if (before === undefined) notes.push(`${k} points to ${now}`);
      } else if (v && v.l && before && before.l) {
        v.l.forEach((x, i) => { if (!same(x, before.l[i])) notes.push(`${k}[${i}] = ${fmtVal(x)}`); });
      } else if (before !== undefined && typeof v !== 'object' && v !== before) {
        notes.push(`${k} = ${fmtVal(v)}`);
      }
    }
    return notes.slice(0, 3);
  }

  function heapOrder(vars, heap) {
    const order = [];
    const seen = new Set();
    const visit = (addr) => {
      if (!addr || seen.has(addr) || heap[addr] === undefined) return;
      seen.add(addr);
      order.push(addr);
      for (const [, val] of heap[addr]?.d || []) if (isPtr(val) && val.p.h) visit(val.p.h);
    };
    Object.values(vars).filter(isPtr).forEach((v) => visit(v.p.h));
    return order;
  }

  function derefOf(v, vars, heap) {
    const p = v.p;
    if (p.null) return '—';
    if (p.to) {
      const target = vars[p.to];
      if (target && target.l) {
        if (p.i === undefined || p.i < 0 || p.i >= target.l.length) return 'outside the array';
        return fmtVal(target.l[p.i]);
      }
      return fmtVal(target);
    }
    if (p.h && heap[p.h] !== undefined) return fmtVal(heap[p.h]);
    return '?';
  }

  function renderMemoryActiveBlock(mount, step, prev, idx, vars) {
    const lines = (deps?.code?.() || '').split('\n');
    const prevVars = prev && prev.fn === step.fn ? prev.vars || {} : {};
    const heap = step.heap || {};
    const prevHeap = prev?.heap || {};
    const types = step.ty || {};
    const ptrs = Object.entries(vars).filter(([, v]) => isPtr(v));

    const tags = new Map();
    ptrs.forEach(([name, v]) => {
      const key = tagKey(v.p);
      if (!key) return;
      if (!tags.has(key)) tags.set(key, []);
      tags.get(key).push(name);
    });
    const chips = (key) => (tags.get(key) || []).map((n) => `<span class="viz-mem-ptr" data-name="${escapeHtml(n)}">${escapeHtml(n)}</span>`).join('');

    const arrays = Object.entries(vars).filter(([, v]) => v && v.l && !isPtr(v));
    const arrayHtml = arrays.map(([name, v]) => {
      const before = prevVars[name]?.l;
      const cols = v.l.map((x, i) => {
        const changed = before && !same(before[i], x);
        return `<div class="viz-mem-col">
          <div class="viz-mem-cell${changed ? ' flash' : ''}${tags.has(`${name}#${i}`) ? ' pointed' : ''}">${escapeHtml(fmtVal(x))}</div>
          <div class="viz-mem-idx">${i}</div>
          <div class="viz-mem-tags">${chips(`${name}#${i}`)}</div>
        </div>`;
      });
      if (tags.has(`${name}#${v.l.length}`)) {
        cols.push(`<div class="viz-mem-col"><div class="viz-mem-cell end">end</div><div class="viz-mem-idx">${v.l.length}</div><div class="viz-mem-tags">${chips(`${name}#${v.l.length}`)}</div></div>`);
      }
      const type = types[name] || (v.et ? `${v.et} [${v.n}]` : '');
      return `<div class="viz-mem-block"><div class="viz-mem-label">${escapeHtml(name)}<small>${escapeHtml(type)}</small></div><div class="viz-mem-row" data-arr="${escapeHtml(name)}">${cols.join('')}</div></div>`;
    }).join('');

    const targeted = [...new Set(ptrs.map(([, v]) => v.p.to).filter((n) => n && vars[n] && !vars[n].l))];
    const scalarHtml = targeted.map((name) => `
      <div class="viz-mem-block small"><div class="viz-mem-label">${escapeHtml(name)}<small>${escapeHtml(types[name] || '')}</small></div>
        <div class="viz-mem-row"><div class="viz-mem-col">
          <div class="viz-mem-cell pointed${prevVars[name] !== undefined && !same(prevVars[name], vars[name]) ? ' flash' : ''}">${escapeHtml(fmtVal(vars[name]))}</div>
          <div class="viz-mem-tags">${chips(name)}</div>
        </div></div></div>`).join('');

    const order = heapOrder(vars, heap);
    const nodeHtml = order.map((addr, n) => {
      const obj = heap[addr];
      const fields = obj && obj.d ? obj.d : [['value', obj]];
      const nextField = fields.find(([, val]) => isPtr(val));
      let wire = '';
      if (nextField) {
        const target = nextField[1];
        const following = order[n + 1];
        wire = target.p.null ? '<div class="viz-mem-wire stop">⊘</div>' : target.p.h === following ? '<div class="viz-mem-wire">➔</div>' : `<div class="viz-mem-wire far">→ ${escapeHtml(target.p.h.slice(-4))}</div>`;
      }
      const body = fields.map(([k, val]) => (isPtr(val)
        ? `<div class="viz-mem-field"><span>${escapeHtml(k)}</span><i class="dot"></i></div>`
        : `<div class="viz-mem-field"><span>${escapeHtml(k)}</span><b>${escapeHtml(fmtVal(val))}</b></div>`)).join('');
      const fresh = prevHeap[addr] === undefined || !same(prevHeap[addr], obj);
      return `<div class="viz-mem-node${fresh ? ' fresh' : ''}">
        <div class="viz-mem-tags top">${chips(`heap:${addr}`)}</div>
        <div class="viz-mem-node-box">${body}</div>
        <div class="viz-mem-node-lbl">${escapeHtml(obj && obj.k ? obj.k.replace(/^struct /, '') : 'heap')} ${escapeHtml(addr.slice(-4))}</div>
      </div>${wire}`;
    }).join('');

    const notes = memNotes(vars, prevVars);
    const status = notes.length ? notes.join('  ·  ') : (lines[step.line - 1] || '').trim();
    const rows = ptrs.map(([name, v]) => {
      const out = !v.p.null && v.p.to && vars[v.p.to]?.l && (v.p.i < 0 || v.p.i > vars[v.p.to].l.length);
      return `<tr class="${out ? 'bad' : ''}"><td class="var-key">${escapeHtml(name)}<small>${escapeHtml(types[name] || v.t || '')}</small></td><td class="var-val">${escapeHtml(fmtVal(v))}</td><td class="var-val deref">${escapeHtml(`*${name} = ${derefOf(v, vars, heap)}`)}</td></tr>`;
    }).join('');

    mount.innerHTML = `
      <div class="viz-ptr-container viz-mem">
        <div class="viz-ptr-status-box">line ${step.line}: <span class="viz-mem-note">${escapeHtml(status)}</span></div>
        <div class="viz-dotted-divider"></div>
        ${arrayHtml}${scalarHtml}
        ${nodeHtml ? `<div class="viz-mem-heap"><div class="viz-mem-label">heap</div><div class="viz-mem-chain">${nodeHtml}</div></div>` : ''}
        ${rows ? `<table class="viz-var-table viz-mem-ptrs" style="margin-top: 14px;"><tr class="head"><td>pointer</td><td>points to</td><td>value there</td></tr>${rows}</table>` : ''}
        <table class="viz-var-table" style="margin-top: 10px;">${renderVarRows(Object.fromEntries(Object.entries(vars).filter(([, v]) => !isPtr(v))))}</table>
      </div>
    `;
    animateMemory(mount, ptrs);
  }

  function animateMemory(mount, ptrs) {
    const cols = mount.querySelectorAll('.viz-mem-row .viz-mem-col');
    const pitch = cols.length > 1 ? cols[1].getBoundingClientRect().left - cols[0].getBoundingClientRect().left : 0;
    const now = {};
    for (const [name, v] of ptrs) now[name] = tagKey(v.p) || 'null';
    mount.querySelectorAll('.viz-mem-ptr').forEach((chip) => {
      const was = lastMem?.[chip.dataset.name];
      const is = now[chip.dataset.name];
      if (lastMem && was === undefined) {
        chip.animate([{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 320 });
      } else if (was !== undefined && was !== is) {
        const [a, ai] = was.split('#');
        const [b, bi] = is.split('#');
        if (a === b && ai !== undefined && bi !== undefined && pitch) {
          chip.animate([{ transform: `translateX(${(Number(ai) - Number(bi)) * pitch}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.3,.7,.3,1)' });
        } else {
          chip.animate([{ opacity: 0.15 }, { opacity: 1 }], { duration: 360 });
        }
      }
    });
    lastMem = now;
  }

  function callsItself(lines, fn) {
    const start = lines.findIndex((l) => new RegExp(`^\\s*def\\s+${fn}\\s*\\(`).test(l));
    if (start < 0) return false;
    const base = lines[start].match(/^\s*/)[0].length;
    for (let i = start + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      if (lines[i].match(/^\s*/)[0].length <= base) break;
      if (new RegExp(`\\b${fn}\\s*\\(`).test(lines[i])) return true;
    }
    return false;
  }

  function renderActiveBlock(step, prev, idx) {
    const mount = $('vizActiveBlockMount');
    if (!mount || !step) return;

    const code = deps?.code?.() || '';
    const lines = code.split('\n');
    const curLineText = lines[step.line - 1] || '';
    const vars = step.vars || {};
    const isModule = step.fn === '<module>';
    const funcName = step.fn || (flowModel ? flowModel.funcName : 'main');

    if (hasPointers(vars, step)) {
      markKind(mount, 'memory');
      renderMemoryActiveBlock(mount, step, prev, idx, vars);
      return;
    }

    if (!isModule && (recursiveFns.has(step.fn) || (isPy() && callsItself(lines, step.fn)))) {
      markKind(mount, 'recursion');
      renderRecursionActiveBlock(mount, step, prev, idx, funcName, vars);
      return;
    }

    // 1. Is it Return State (Image 3)?
    const isReturn = (
      step.event === 'return' ||
      (flowModel && flowModel.returnLine && step.line === flowModel.returnLine) ||
      /^\s*return\b/.test(curLineText) ||
      (!isModule && (idx === currentSteps.length - 1 || (currentSteps[idx + 1] && currentSteps[idx + 1].fn === '<module>')))
    );

    if (isReturn) {
      markKind(mount, 'return');
      renderReturnActiveBlock(mount, step, prev, idx, funcName, vars);
      return;
    }

    // 2. Is it Pointer Tracking / Linked List State (Image 1)?
    const isPointer = (
      code.includes('Node(') ||
      code.includes('linkedlist') ||
      vars.head !== undefined ||
      (code.includes('inserting') && code.includes('status'))
    );

    if (isPointer) {
      markKind(mount, 'pointer');
      renderPointerActiveBlock(mount, step, prev, idx, vars);
      return;
    }

    // 3. Is it Recursion Stack State (Image 2)?
    const isRecursive = (
      code.includes('factorial(x - 1)') ||
      code.includes('factorial(n - 1)') ||
      (currentSteps.filter((s) => s.fn && s.fn === step.fn).length > 6 && !code.includes('for ') && !code.includes('while '))
    );

    if (isRecursive && !isModule) {
      markKind(mount, 'recursion');
      renderRecursionActiveBlock(mount, step, prev, idx, funcName, vars);
      return;
    }

    // 4. Is it Active Loop State (Image 4)?
    const isLoop = (
      (flowModel && (step.line === flowModel.loopLine || flowModel.bodyLines.includes(step.line))) ||
      /^\s*(for|while)\b/.test(curLineText) ||
      (prev && /^\s*(for|while)\b/.test(lines[prev.line - 1] || '')) ||
      vars.i !== undefined || vars.j !== undefined
    );

    if (isLoop) {
      markKind(mount, 'loop');
      renderLoopActiveBlock(mount, step, prev, idx, vars);
      return;
    }

    // 5. Function Call Entry (before loop)
    if (!isModule) {
      markKind(mount, 'call');
      renderCallActiveBlock(mount, step, prev, idx, funcName, vars);
      return;
    }

    // 6. Script Start (Main Window)
    markKind(mount, 'script');
    renderScriptStartActiveBlock(mount, step, vars);
  }

  /* Every loop in progress at a step, across the whole call stack */
  let loopTable = [];
  let loopTableFor = null;

  function indentOf(line) {
    return line.match(/^\s*/)[0].length;
  }

  function loopVarsFromText(text) {
    const t = text.trim();
    let m = /\bfor\s*\(\s*(?:(?:let|const|var|int|long|short|size_t|unsigned|auto|char|float|double)\s+)*([A-Za-z_]\w*)\s*(?:=|of\b|in\b|:)/.exec(t);
    if (m) return [m[1]];
    m = /\bfor\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?::=|=|in\b)/.exec(t);
    if (m) return m[1].split(',').map((v) => v.trim()).filter((v) => v !== '_');
    m = /\bfor\s+\(?\s*([A-Za-z_]\w*)/.exec(t);
    return m ? [m[1]] : [];
  }

  /* Loops found from the trace itself: a header is a line the same frame jumps back to. */
  function buildTraceLoops(steps, lines) {
    const found = new Map();
    for (let i = 1; i < steps.length; i++) {
      const a = steps[i - 1];
      const b = steps[i];
      if (a.fn !== b.fn || a.d !== b.d || b.line > a.line) continue;
      const header = b.line;
      const text = (lines[header - 1] || '').trim();
      if (!/\b(for|while|until|loop|repeat)\b/.test(text)) continue;
      if (b.line === a.line && !/^(for|while|until|loop|repeat)\b|^\}?\s*(while|until)\b/.test(text)) continue;
      let prevVisit = -1;
      for (let k = i - 2; k >= 0; k--) {
        if (steps[k].d < b.d) break;
        if (steps[k].d === b.d && steps[k].fn === b.fn && steps[k].line === header) { prevVisit = k; break; }
      }
      let end = Math.max(a.line, header);
      if (prevVisit >= 0) {
        for (let k = prevVisit; k < i; k++) if (steps[k].d === b.d && steps[k].fn === b.fn) end = Math.max(end, steps[k].line);
      }
      const key = `${b.fn}|${header}`;
      const kind = /^(?:\}\s*)?for\b|\bfor\b/.test(text) && !/\bwhile\b/.test(text.split('for')[0]) ? 'for' : 'while';
      const prev = found.get(key);
      if (prev) prev.end = Math.max(prev.end, end);
      else found.set(key, { line: header, end, fn: b.fn, kind, vars: kind === 'for' ? loopVarsFromText(text) : [], text: text.replace(/\s*[{:]\s*$/, '').slice(0, 80) });
    }
    return [...found.values()].sort((x, y) => x.line - y.line);
  }

  function buildLoopTable(code) {
    const lines = (code || '').split('\n');
    if (!isPy()) return buildTraceLoops(currentSteps, lines);
    const table = [];
    lines.forEach((text, i) => {
      const m = /^(\s*)(for|while)\b(.*):\s*(#.*)?$/.exec(text);
      if (!m) return;
      const base = m[1].length;
      let end = i + 1;
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].trim()) continue;
        if (indentOf(lines[j]) <= base) break;
        end = j + 1;
      }
      let fn = '<module>';
      let threshold = base;
      for (let j = i - 1; j >= 0 && threshold > 0; j--) {
        if (!lines[j].trim() || indentOf(lines[j]) >= threshold) continue;
        const def = /^\s*def\s+(\w+)/.exec(lines[j]);
        if (def) { fn = def[1]; break; }
        threshold = indentOf(lines[j]);
      }
      const forM = /^for\s+(.+?)\s+in\s+(.+)$/.exec(`${m[2]}${m[3]}`.trim());
      table.push({
        line: i + 1, end, fn, kind: m[2],
        vars: forM ? forM[1].split(',').map((v) => v.trim()) : [],
        text: `${m[2]}${m[3]}`.trim(),
      });
    });
    return table;
  }

  function callStackAt(idx) {
    const stack = [];
    for (const ev of currentTrace?.events || []) {
      if (ev.at > idx) break;
      if (ev.e === 'call') stack.push({ fn: ev.fn, callerLine: ev.caller?.line });
      else stack.pop();
    }
    return stack;
  }

  function loopProgress(loop, idx) {
    const steps = currentSteps;
    const inside = (s) => s.fn === loop.fn && s.line >= loop.line && s.line <= loop.end;
    let hits = 0;
    let vars = null;
    for (let i = idx; i >= 0; i--) {
      const s = steps[i];
      if (s.fn !== loop.fn) continue;
      if (!inside(s)) break;
      if (!vars && s.vars) vars = s.vars;
      if (s.line === loop.line) hits++;
    }
    let total = hits;
    for (let i = idx + 1; i < steps.length; i++) {
      const s = steps[i];
      if (s.fn !== loop.fn) continue;
      if (!inside(s)) break;
      if (s.line === loop.line) total++;
    }
    return { hits, total, vars: vars || {} };
  }

  function renderLanes(step, idx) {
    const host = $('vizLoopLanes');
    if (!host || !currentSteps.length) return;
    const code = deps?.code?.() || '';
    if (loopTableFor !== code) { loopTable = buildLoopTable(code); loopTableFor = code; }
    const stack = callStackAt(idx);
    const lanes = [];
    stack.forEach((frame, k) => {
      const line = k === stack.length - 1 ? step.line : stack[k + 1].callerLine;
      if (!line) return;
      for (const loop of loopTable) {
        if (loop.fn === frame.fn && line >= loop.line && line <= loop.end) lanes.push(loop);
      }
    });
    if (!lanes.length) { host.replaceChildren(); host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML = lanes.map((loop, n) => {
      const p = loopProgress(loop, idx);
      const known = loop.kind === 'for';
      const count = known ? Math.max(0, p.total - 1) : null;
      const cur = known ? Math.min(p.hits, Math.max(count, 1)) : p.hits;
      const pct = known && count ? Math.round((cur / count) * 100) : 0;
      const value = loop.vars.length ? loop.vars.map((v) => `${v} = ${fmtVal(p.vars[v])}`).join(', ') : '';
      const hit = step.line === loop.line && step.fn === loop.fn;
      return `
        <div class="viz-lane ${n === lanes.length - 1 ? 'inner' : ''} ${hit ? 'hit' : ''}">
          <span class="viz-lane-fn">${escapeHtml(loop.fn === '<module>' ? 'script' : loop.fn)}</span>
          <span class="viz-lane-stmt">${escapeHtml(loop.text)}</span>
          <span class="viz-lane-val">${escapeHtml(value)}</span>
          <span class="viz-lane-count">${known ? `${cur}/${count}` : `#${cur}`}</span>
          <div class="viz-lane-bar ${known ? '' : 'open'}"><b style="width:${known ? pct : 100}%"></b></div>
        </div>`;
    }).join('');
  }

  function goToStep(index) {
    if (!currentSteps.length) return;
    currentIdx = Math.max(0, Math.min(index, currentSteps.length - 1));

    const step = currentSteps[currentIdx];
    const prev = currentSteps[currentIdx - 1] || null;

    // Update scrubber & counter
    const scrubber = $('vizScrubber');
    const counter = $('vizStepCounter');
    if (scrubber) scrubber.value = currentIdx;
    if (counter) counter.textContent = `${currentIdx + 1}/${currentSteps.length}`;

    // Highlight line in editor
    if (deps?.editor && step.line) {
      const ed = deps.editor();
      ed.revealLineInCenterIfOutsideViewport?.(step.line);
    }

    // Render ONLY Active Block on the stage canvas (Primary View)
    renderActiveBlock(step, prev, currentIdx);
    renderLanes(step, currentIdx);


    // Button states
    if ($('vizBtnPrev')) $('vizBtnPrev').disabled = currentIdx === 0;
    if ($('vizBtnNext')) $('vizBtnNext').disabled = currentIdx === currentSteps.length - 1;
  }

  function stepDelta(delta) {
    if (!currentSteps.length) return;
    const target = currentIdx + delta;
    if (target >= 0 && target < currentSteps.length) {
      goToStep(target);
    } else {
      pause();
    }
  }

  // Jump to the next iteration of the current loop or start of next loop
  function stepNextLoop() {
    if (!currentSteps.length) return;
    const currentStep = currentSteps[currentIdx];
    const curLine = currentStep.line;

    // Find the loop matching this step
    const matchedLoop = loopAnalysis.find((l) => l.line === curLine) || loopAnalysis[0];
    if (!matchedLoop) {
      stepDelta(1);
      return;
    }

    // Scan forward for next hit on the loop line
    for (let i = currentIdx + 1; i < currentSteps.length; i++) {
      if (currentSteps[i].line === matchedLoop.line) {
        goToStep(i);
        return;
      }
    }

    // If no more loop iterations, jump to end
    goToStep(currentSteps.length - 1);
  }

  function togglePlay() {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }

  function play() {
    if (!currentSteps.length) return;
    if (currentIdx >= currentSteps.length - 1) currentIdx = 0;
    isPlaying = true;

    const playLabel = $('vizPlayLabel');
    if (playLabel) playLabel.textContent = 'Pause';

    if (activeInspection && !activeInspection.timer && activeInspection.tick) {
      activeInspection.tick();
    } else {
      scheduleTick();
    }
  }

  function pause() {
    isPlaying = false;
    clearTimeout(playTimer);
    playTimer = null;
    if (activeInspection) {
      clearTimeout(activeInspection.timer);
      activeInspection.timer = null;
    }
    const playLabel = $('vizPlayLabel');
    if (playLabel) playLabel.textContent = 'Play';
  }

  function scheduleTick() {
    if (!isPlaying) return;
    playTimer = setTimeout(() => {
      if (currentIdx >= currentSteps.length - 1) {
        pause();
        return;
      }
      stepDelta(1);
      scheduleTick();
    }, 600 / playbackSpeed);
  }

  /* --- Render Component: Loop Inspector --- */
  function renderLoopInspector(step, prev) {
    const loopCard = $('vizLoopSection');
    const badge = $('vizLoopBadge');
    const typeLabel = $('vizLoopType');
    const lineLabel = $('vizLoopLine');
    const stmtBox = $('vizLoopStmt');
    const condBox = $('vizCondBox');
    const condExpr = $('vizCondExpr');
    const condResult = $('vizCondResult');
    const iterCounter = $('vizIterCounter');
    const iterPercent = $('vizIterPercent');
    const iterProgressFill = $('vizIterProgressFill');
    const iterTrail = $('vizIterTrail');

    if (!loopCard) return;

    // Detect if current step is inside a known loop
    const matchedLoop = loopAnalysis.find((l) => Math.abs(l.line - step.line) <= 4);

    if (matchedLoop) {
      loopCard.classList.add('active-loop');
      if (typeLabel) typeLabel.textContent = `${matchedLoop.type.toUpperCase()} LOOP`;
      if (lineLabel) lineLabel.textContent = String(matchedLoop.line);
      if (stmtBox) stmtBox.textContent = matchedLoop.raw;

      // Extract loop variable value if present
      let iterVal = null;
      if (matchedLoop.vars) {
        for (const vName of matchedLoop.vars) {
          if (step.vars && step.vars[vName] !== undefined) {
            iterVal = step.vars[vName];
            break;
          }
        }
      }

      // Condition simulation
      if (condBox) {
        condBox.style.display = 'flex';
        if (matchedLoop.type === 'for') {
          const iterStr = iterVal !== null ? ` (element = ${iterVal})` : '';
          condExpr.textContent = `Iterating ${matchedLoop.iterable}${iterStr}`;
          condResult.className = 'viz-cond-result true';
          condResult.textContent = 'IN PROGRESS';
        } else {
          condExpr.textContent = `Condition: ${matchedLoop.cond}`;
          condResult.className = 'viz-cond-result true';
          condResult.textContent = 'EVAL: TRUE';
        }
      }

      // Calculate iteration index across history
      let loopVisits = 0;
      let totalVisits = 0;
      currentSteps.forEach((st, idx) => {
        if (st.line === matchedLoop.line) {
          totalVisits++;
          if (idx <= currentIdx) loopVisits++;
        }
      });

      if (iterCounter) iterCounter.textContent = `Iteration #${loopVisits} of ${Math.max(1, totalVisits)}`;
      const pct = totalVisits > 0 ? Math.round((loopVisits / totalVisits) * 100) : 100;
      if (iterPercent) iterPercent.textContent = `${pct}%`;
      if (iterProgressFill) iterProgressFill.style.width = `${pct}%`;

      // Iteration breadcrumbs
      if (iterTrail) {
        iterTrail.innerHTML = '';
        const visitsList = [];
        currentSteps.forEach((st, idx) => {
          if (st.line === matchedLoop.line) visitsList.push(idx);
        });

        visitsList.slice(0, 10).forEach((stepIdx, i) => {
          const chip = document.createElement('button');
          chip.className = `viz-iter-chip${i + 1 === loopVisits ? ' active' : ''}`;
          chip.textContent = `Iter ${i + 1}`;
          chip.title = `Jump to iteration ${i + 1} (step ${stepIdx + 1})`;
          chip.addEventListener('click', () => { pause(); goToStep(stepIdx); });
          iterTrail.appendChild(chip);
        });
      }
    } else {
      loopCard.classList.remove('active-loop');
      if (typeLabel) typeLabel.textContent = 'Statement Execution';
      if (lineLabel) lineLabel.textContent = String(step.line);
      if (stmtBox) stmtBox.textContent = `Line ${step.line} in ${step.fn || '<module>'}`;
      if (condBox) condBox.style.display = 'none';
      if (iterCounter) iterCounter.textContent = 'Linear step';
      if (iterPercent) iterPercent.textContent = '100%';
      if (iterProgressFill) iterProgressFill.style.width = '100%';
      if (iterTrail) iterTrail.innerHTML = '';
    }
  }

  /* --- Render Component: Plain-English Narrator --- */
  function renderNarrator(step, prev) {
    const lineLabel = $('vizNarrativeLine');
    const textLabel = $('vizNarrativeText');
    if (!lineLabel || !textLabel) return;

    lineLabel.textContent = `Line ${step.line}:`;

    // Detect what changed between previous step and this step
    const changedVars = [];
    if (prev && prev.vars && step.vars) {
      Object.keys(step.vars).forEach((k) => {
        if (!same(prev.vars[k], step.vars[k])) {
          changedVars.push({ name: k, oldVal: fmtVal(prev.vars[k]), newVal: fmtVal(step.vars[k]) });
        }
      });
    }

    if (changedVars.length > 0) {
      const descriptions = changedVars.map((c) => `\`${c.name}\` updated to ${c.newVal}`).join(', ');
      textLabel.innerHTML = `Variables mutated: <strong>${descriptions}</strong>.`;
    } else if (step.line && loopAnalysis.some((l) => l.line === step.line)) {
      const loop = loopAnalysis.find((l) => l.line === step.line);
      textLabel.innerHTML = `Loop header evaluated: <em>${loop.raw}</em>. Checking condition and advancing iteration.`;
    } else if (step.fn === '<module>') {
      textLabel.textContent = `Executing in main script window on line ${step.line}.`;
    } else {
      textLabel.textContent = `Executing line ${step.line} inside function ${step.fn || 'main'}().`;
    }
  }

  /* --- Render Component: Animated Array & Pointer Stage --- */
  function renderDataGraphics(step, prev) {
    const stage = $('vizDataSection');
    const canvas = $('vizBarsCanvas');
    const nameLabel = $('vizArrayName');
    const sizeLabel = $('vizArraySize');

    if (!stage || !canvas) return;

    const arrInfo = getNumericArray(step.vars || {});
    if (!arrInfo || !arrInfo.items.length) {
      stage.style.display = 'none';
      return;
    }

    stage.style.display = '';
    if (nameLabel) nameLabel.textContent = `Array: ${arrInfo.name}`;
    if (sizeLabel) sizeLabel.textContent = `${arrInfo.items.length} elements`;

    const items = arrInfo.items;
    const minVal = Math.min(...items);
    const maxVal = Math.max(...items);
    const range = Math.max(1, maxVal - minVal);

    // Identify pointer indices from scalar vars
    const pointerMap = new Map(); // index -> array of pointer names
    if (step.vars) {
      Object.entries(step.vars).forEach(([k, v]) => {
        if (typeof v === 'number' && Number.isInteger(v) && POINTER_RE.test(k)) {
          if (v >= 0 && v < items.length) {
            if (!pointerMap.has(v)) pointerMap.set(v, []);
            pointerMap.get(v).push(k);
          }
        }
      });
    }

    // Detect if a swap occurred compared to previous step
    const prevArr = prev ? getNumericArray(prev.vars || {}) : null;
    const swappedIndices = new Set();
    if (prevArr && prevArr.name === arrInfo.name && prevArr.items.length === items.length) {
      items.forEach((val, idx) => {
        if (val !== prevArr.items[idx]) swappedIndices.add(idx);
      });
    }

    // Render bars
    canvas.innerHTML = '';
    items.forEach((val, idx) => {
      const col = document.createElement('div');
      col.className = 'viz-bar-col';

      const hasPointers = pointerMap.has(idx);
      if (hasPointers) col.classList.add('active-point');
      if (swappedIndices.has(idx)) col.classList.add('swapping');

      // Pointer stack hovering on top
      if (hasPointers) {
        const stack = document.createElement('div');
        stack.className = 'viz-pointer-stack';
        pointerMap.get(idx).forEach((pName) => {
          const pill = document.createElement('div');
          pill.className = `viz-pointer-pill p-${pName.toLowerCase()}`;
          pill.textContent = pName;
          const arrow = document.createElement('div');
          arrow.className = 'viz-pointer-arrow';
          stack.appendChild(pill);
          stack.appendChild(arrow);
        });
        col.appendChild(stack);
      }

      // Height calculation
      const heightPct = Math.round(18 + ((val - minVal) / range) * 78);

      const track = document.createElement('div');
      track.className = 'viz-bar-track';
      const body = document.createElement('div');
      body.className = 'viz-bar-body';
      body.style.height = `${heightPct}%`;
      track.appendChild(body);

      const valLabel = document.createElement('div');
      valLabel.className = 'viz-bar-value';
      valLabel.textContent = String(val);

      const idxLabel = document.createElement('div');
      idxLabel.className = 'viz-bar-idx';
      idxLabel.textContent = `[${idx}]`;

      col.appendChild(track);
      col.appendChild(valLabel);
      col.appendChild(idxLabel);

      canvas.appendChild(col);
    });
  }

  /* --- Render Component: Variables & Sparkline Trends --- */
  function renderVariables(step, prev) {
    const grid = $('vizVarsGrid');
    if (!grid) return;

    grid.innerHTML = '';
    const vars = step.vars || {};
    const entries = Object.entries(vars);

    if (!entries.length) {
      grid.innerHTML = '<span style="color: var(--text-faint); font-size: 11px;">No local variables in current frame.</span>';
      return;
    }

    entries.forEach(([name, val]) => {
      const isArray = val && val.l;
      const isDict = val && val.d;
      const typeStr = isArray ? `list[${val.n}]` : isDict ? `dict[${val.n}]` : typeof val;
      const displayVal = fmtVal(val);

      const card = document.createElement('div');
      card.className = 'viz-var-card';

      const wasChanged = prev && prev.vars && !same(prev.vars[name], val);
      if (wasChanged) card.classList.add('mutated');

      const header = document.createElement('div');
      header.className = 'viz-var-header';
      header.innerHTML = `
        <span class="viz-var-name">${name}</span>
        <span class="viz-var-type">${typeStr}</span>
      `;

      const valDiv = document.createElement('div');
      valDiv.className = 'viz-var-value';
      valDiv.textContent = displayVal.length > 22 ? `${displayVal.slice(0, 20)}…` : displayVal;

      card.appendChild(header);
      card.appendChild(valDiv);

      // Render SVG sparkline for changing numbers
      if (typeof val === 'number' && varHistory.has(name) && varHistory.get(name).length > 2) {
        const history = varHistory.get(name);
        const sparkSvg = createSparklineSvg(history);
        card.appendChild(sparkSvg);
      }

      grid.appendChild(card);
    });
  }

  function createSparklineSvg(values) {
    const width = 110;
    const height = 20;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);

    const points = values.map((v, i) => {
      const x = Math.round((i / (values.length - 1)) * width);
      const y = Math.round(height - 2 - ((v - min) / range) * (height - 4));
      return `${x},${y}`;
    }).join(' ');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'viz-var-sparkline');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${points.replace(/ /g, ' L ')}`);
    svg.appendChild(path);

    return svg;
  }

  /* --- Render Component: Console Output Stream --- */
  function renderConsoleOutput(step) {
    const outPre = $('vizConsoleStream');
    const outWrap = $('vizOutputSection');
    if (!outPre || !outWrap || !currentTrace) return;

    const outText = currentTrace.stdout ? currentTrace.stdout.slice(0, step.out || 0) : '';
    if (!outText && !currentTrace.stderr) {
      outWrap.style.display = 'none';
      return;
    }

    outWrap.style.display = '';
    outPre.textContent = outText + (currentTrace.stderr ? `\n[stderr]: ${currentTrace.stderr}` : '');
  }

  // Public interface called by Timeline or IDE
  function render(step, prev, extra = {}, fullTrace = null, idx = 0) {
    ensureStructure();
    if (fullTrace && fullTrace !== currentTrace) {
      loadTrace(fullTrace, extra.err || '');
    }
    if (step) {
      if (idx !== undefined && currentSteps[idx] === step) {
        goToStep(idx);
      } else {
        const foundIdx = currentSteps.indexOf(step);
        if (foundIdx >= 0) goToStep(foundIdx);
      }
    }
  }

  /* --- Flow Mode Synchronization & Function Loop Inspection --- */
  let activeInspection = null;

  function isOpen() {
    const panel = document.querySelector('[data-panel="viz"]');
    return Boolean(panel && !panel.hidden && panel.offsetWidth > 0);
  }

  function isInspecting() {
    return Boolean(activeInspection);
  }

  function stopInspection() {
    if (!activeInspection) return;
    clearTimeout(activeInspection.timer);
    activeInspection.stopped = true;
    document.getElementById('vizFlowHandoffBanner')?.remove();
    const cb = activeInspection.onComplete;
    activeInspection = null;
    if (cb) cb();
  }

  function inspectFunction({ trace, funcName, startIdx = 0, endIdx = null, speed = 1, onComplete }) {
    stopInspection();
    pause();
    ensureStructure();

    // Ensure the Visualizer panel is visible side-by-side with Flow Chart
    if (typeof Workspace !== 'undefined') {
      Workspace.show('viz', true);
    }

    const code = deps?.code?.() || '';
    loadTrace(trace, '', code);

    const steps = currentSteps;
    let fromIdx = 0;
    let toIdx = steps.length - 1;

    if (startIdx !== undefined && startIdx !== null) {
      fromIdx = Math.max(0, Math.min(startIdx, steps.length - 1));
    } else {
      fromIdx = steps.findIndex((s) => s.fn === funcName);
      if (fromIdx < 0) fromIdx = 0;
    }

    if (endIdx !== undefined && endIdx !== null && endIdx > fromIdx) {
      toIdx = Math.max(fromIdx, Math.min(endIdx - 1, steps.length - 1));
    } else {
      for (let i = fromIdx; i < steps.length; i++) {
        if (steps[i].fn === funcName) toIdx = i;
        else if (i > fromIdx && steps[i].fn !== funcName) break;
      }
    }

    // Insert handoff banner at the top of active stage
    const activeStage = $('vizActiveStage');
    document.getElementById('vizFlowHandoffBanner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'vizFlowHandoffBanner';
    banner.className = 'viz-handoff-banner';
    banner.innerHTML = `
      <div class="viz-handoff-info">
        <span class="viz-handoff-dot"></span>
        <span>Inside <strong>${funcName === '<module>' ? 'the script' : `${funcName}()`}</strong></span>
      </div>
      <button id="vizBtnResumeFlow" class="viz-btn primary" style="height: 24px; padding: 0 10px; font-size: 11px;">
        Skip ➔
      </button>
    `;
    activeStage.prepend(banner);

    document.getElementById('vizBtnResumeFlow')?.addEventListener('click', () => {
      stopInspection();
    });

    let currentStepIdx = fromIdx;
    goToStep(currentStepIdx);

    const inspection = {
      funcName,
      fromIdx,
      toIdx,
      timer: null,
      stopped: false,
      onComplete,
    };
    activeInspection = inspection;

    const stepDelay = Math.max(300, Math.round(650 / (speed || playbackSpeed || 1)));

    function tick() {
      if (!activeInspection || activeInspection !== inspection || inspection.stopped) return;

      if (currentStepIdx >= toIdx) {
        goToStep(toIdx);

        inspection.timer = setTimeout(() => {
          document.getElementById('vizFlowHandoffBanner')?.remove();
          activeInspection = null;
          if (onComplete) onComplete();
        }, 250);
        return;
      }

      currentStepIdx++;
      goToStep(currentStepIdx);
      inspection.timer = setTimeout(tick, stepDelay);
    }

    inspection.tick = tick;
    inspection.timer = setTimeout(tick, stepDelay);
  }

  function clear() {
    stopInspection();
    pause();
    currentTrace = null;
    currentSteps = [];
    currentIdx = 0;
    tracedCode = null;
    lastMem = null;
    recursiveFns = new Set();
    varHistory.clear();
    flowModel = null;

    const emptyStage = $('vizEmptyStage');
    const activeStage = $('vizActiveStage');
    const scrubber = $('vizScrubber');
    const mount = $('vizActiveBlockMount');

    if (mount) mount.innerHTML = '';
    $('vizLoopLanes')?.replaceChildren();
    if (emptyStage) emptyStage.style.display = 'flex';
    if (activeStage) activeStage.style.display = 'none';

    if (scrubber) {
      scrubber.disabled = true;
      scrubber.value = 0;
      scrubber.max = 0;
    }
  }

  function init(d) {
    deps = d;
    ensureStructure();
    const panel = document.querySelector('[data-panel="viz"]');
    if (panel) new MutationObserver(() => scheduleAutoTrace(50)).observe(panel, { attributes: true, attributeFilter: ['class', 'hidden'] });
    deps.editor?.()?.onDidChangeModelContent?.(() => scheduleAutoTrace());
    scheduleAutoTrace(1200);
  }

  return {
    init,
    render,
    clear,
    triggerTrace,
    loadTrace,
    loadSample,
    isOpen,
    isInspecting,
    inspectFunction,
    stopInspection,
  };
})();
