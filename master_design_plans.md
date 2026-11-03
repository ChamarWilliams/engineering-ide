# Master Design Plans: Interactive Engineering IDE & Visualization Platform

## 1. Executive Summary & Vision

This document consolidates the complete architectural and operational master plans for building a lightweight, high-performance web IDE and execution engine on Replit. 

The platform is designed to fulfill two strategic milestones:
1. **Immediate Core**: A responsive, browser-based code editor supporting common engineering languages (from low-level C and Lua to Python), featuring zero-maintenance database session persistence and secure, sub-second code execution.
2. **Evolutionary Target**: A physics-based motion visualizer embedded into students' daily coding workflows that dynamically animates in-memory data structures (arrays, linked lists, trees, graphs) and relational database state transitions in real time.

---

## 2. High-Level System Architecture

The system utilizes an asynchronous, event-driven pattern designed to run cost-effectively on a single Replit instance while remaining architecturally decoupled for multi-node horizontal scaling.

```
┌────────────────────────────────────────────────────────────────────────┐
│                              CLIENT TIER                               │
│  ┌───────────────────────┐  ┌───────────────────────────────────────┐  │
│  │ Monaco Code Editor    │  │ Motion & Visualizer Canvas            │  │
│  │ (Syntax, Auto-save)   │  │ (Motion, React Flow, xterm.js Console)│  │
│  └───────────┬───────────┘  └───────────────────▲───────────────────┘  │
│              │ (Auto-Save & Run Requests)       │ (Real-time Stream)    │
└──────────────┼──────────────────────────────────┼──────────────────────┘
               ▼                                  │
┌─────────────────────────────────────────────────┴──────────────────────┐
│                    API GATEWAY & PERSISTENCE TIER                      │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ FastAPI Server (Asynchronous Routing & Process Dispatcher)       │  │
│  └───────────────────┬──────────────────────────┬───────────────────┘  │
│                      │                          │                      │
│                      ▼                          ▼                      │
│  ┌──────────────────────────────────┐ ┌─────────────────────────────┐  │
│  │ Replit Managed PostgreSQL        │ │ Temporary Sandbox Scratchpad│  │
│  │ (Serverless Session Persistence) │ │ (Ephemeral tmpfs Lifecycle) │  │
│  └──────────────────────────────────┘ └──────────────┬──────────────┘  │
└──────────────────────────────────────────────────────┼─────────────────┘
                                                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        EXECUTION RUNNER TIER                           │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Sandboxed Child Processes / nsjail Runners                       │  │
│  │ • C / C++: gcc -O2 compile pipeline                              │  │
│  │ • Lua: Lua 5.4 / LuaJIT sub-50ms execution                       │  │
│  │ • Python: CPython 3.12 / WebAssembly (Pyodide) client fallback   │  │
│  │ • Guardrails: 5.0s Timeout, 256MB RAM Cap, pids.max = 30         │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack Specification

| Tier | Component | Technology Selection | Rationale |
| :--- | :--- | :--- | :--- |
| **Frontend Editor** | Core Code Editor | Monaco Editor (via CDN) | Industry-standard VS Code engine providing syntax highlighting, autocomplete, and language modes without complex build bundles. |
| **Frontend UI** | Terminal & Layout | Vanilla JS / React + xterm.js | Lightweight layout with dedicated console streaming, minimap controls, and responsive split-panel viewing. |
| **Motion & Nodes** | Physics & Diagrams | Motion + React Flow | Physics-based spring animations for array swaps and fluid node-and-edge graphs for trees and linked lists. |
| **Backend API** | Web Framework | FastAPI (Python 3.12) | High-performance asynchronous event loop, automatic Pydantic request validation, and clean child process orchestration. |
| **Database** | Session Persistence | Replit Managed PostgreSQL | Fully serverless, zero-maintenance relational database natively integrated into Replit via `DATABASE_URL` (with SQLite fallback). |
| **Execution Sandboxing**| Process Isolation | Linux cgroups v2 + nsjail / subshells | Restricts CPU, memory, process spawning, execution duration, and network access for untrusted code. |

---

## 4. Database Schema & Session Persistence Model

To maintain zero operational overhead, session state is stored in a clean, single-table relational schema that automatically initializes on application startup.

### Relational Schema Definition
```sql
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(36) PRIMARY KEY,         -- Unique 8-character slug or UUID
    title VARCHAR(100) DEFAULT 'Untitled',
    language VARCHAR(20) NOT NULL,      -- 'c', 'cpp', 'lua', 'python'
    code TEXT NOT NULL,                 -- Full source code text
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
```

### Session Lifecycle & Synchronization
1. **Debounced Auto-Save**: The frontend tracks keystrokes and dispatches a `POST /api/sessions` request 1.5 seconds after editing stops.
2. **URL State Binding**: Upon saving, the browser updates its URL query parameter (`?id=xyz123`) using `window.history.pushState` without triggering a page reload.
3. **Instant Sharing & Reload**: Loading a URL containing `?id=...` causes the client to query `GET /api/sessions/{id}`, dynamically setting the editor contents and language mode.

---

## 5. Multi-Language Compilation & Execution Engine

The execution pipeline handles both compiled binaries and interpreted runtimes within isolated scratchpad directories.

### Language Execution Pipeline

#### 1. C & C++ (Compiled Ahead-of-Time)
* **Compilation Phase**: Invokes `gcc -O2 main.c -o out.bin` (or `g++ -std=c++20`) within a temporary directory. Compilation errors are captured from `stderr` and returned immediately with exit code 1.
* **Execution Phase**: If compilation succeeds, the binary `./out.bin` is executed under a strict 5.0-second timeout.
* **Optimization**: Intermediate object files and binaries are discarded immediately upon process termination.

#### 2. Lua (Interpreted / JIT)
* **Execution Phase**: Writes code to `main.lua` and invokes `lua main.lua` directly.
* **Performance**: Yields sub-50ms execution times with minimal memory footprint (<2 MB).

#### 3. Python (Bytecode / Interpreted)
* **Execution Phase**: Writes code to `main.py` and runs `python3 main.py` with unbuffered output (`PYTHONUNBUFFERED=1`).
* **Alternative In-Browser Execution**: Can be offloaded client-side to Pyodide (WebAssembly) for $0 server compute.

---

## 6. Cutting-Edge Motion Animation & Visualization Architecture

Modern web architecture is shifting from static, timeline-based keyframe animations to physics-based motion systems.

### 1. Spring Physics vs. Fixed Easing
* **Dynamic Springs**: Instead of artificial `0.3s ease-in-out` curves, elements move using mass, stiffness, and damping. Motion looks natural and tactile.
* **Interruptibility**: If an algorithm executes sequential steps rapidly (e.g., in a quicksort partition), the animation preserves current velocity and smoothly redirects to the new coordinate without visual glitching or snapping.
* **Automatic Layout Animations (FLIP)**: Motion detects when array indices change positions in the DOM, automatically computing the translation vectors to glide cards across each other.

### 2. Specialized Visualizer Components
* **Linear Structures (Arrays, Stacks, Queues)**: Powered by Motion layout cards with color-coded pointer badges (`i`, `j`, `pivot`).
* **Graph & Tree Structures (Binary Trees, Graphs, Linked Lists)**: Powered by React Flow, featuring smooth bezier edge connections, dynamic node insertion, and highlighted traversal paths.
* **Relational State (Databases)**: Powered by sql.js (in-memory SQLite) with dynamic table grids reflecting active transactions.

### 3. High-Frame-Rate Concurrency (Web Workers)
To prevent editor lag during animations, execution tracing and Abstract Syntax Tree (AST) parsing run inside dedicated background Web Workers, leaving the main UI thread completely unblocked to maintain a stable 60–120 FPS.

---

## 7. Security Hardening & Sandbox Guardrails

Executing arbitrary user-submitted code requires multi-layered defense to protect host infrastructure.

| Threat Category | Attack Mechanism | Hardened Architectural Defense |
| :--- | :--- | :--- |
| **Fork Bomb** | Recursive `fork()` process spawning | `pids.max = 30` enforced via Linux cgroups v2; `RLIMIT_NPROC` set to 30. |
| **Infinite Loop** | `while(1){}` consuming 100% CPU | Hard 5.0-second wall-clock timeout triggering immediate `SIGKILL`; CPU quota caps. |
| **Memory Exhaustion** | Large array/malloc memory grabs | Memory ceiling fixed at 256 MB per runner; exceeding threshold triggers `OOMKilled`. |
| **Host Disk Tampering**| Deleting or overwriting host files | Host root mounted read-only (`ro`); temporary scratchpad mounted on in-memory `tmpfs`. |
| **Network Abuse** | Botnets, outbound spam, port scans | Network namespace unshared with loopback-only configuration (`--disable_clone_newnet`). |

---

## 8. Elastic Scaling Strategy: 1 to 10,000+ Users

```
Stage 1: 1–50 Users        Stage 2: 50–500 Users       Stage 3: 500–10,000+ Users
[ Single Replit Host ] ──> [ Asynchronous Queue ] ──> [ Distributed Auto-Scaling Pods ]
  Zero idle cost             Redis task buffering        Queue-depth horizontal scaling
```

* **Scale Tier 1 (1–50 Concurrent Users)**:
  * Runs entirely on a single Replit container.
  * Direct execution via isolated subshells and in-browser WASM runtimes.
  * Idle infrastructure cost: $0 / month above base Repl.
* **Scale Tier 2 (50–500 Concurrent Users)**:
  * Separates the FastAPI web gateway from execution runners using an asynchronous Redis queue.
  * Pre-warms a "hot pool" of container runners with pre-mounted scratchpads, dropping process initialization latency to under 15ms.
* **Scale Tier 3 (500–10,000+ Users)**:
  * Deploys worker fleets across container platforms (such as Google Cloud Run or AWS ECS).
  * Autoscales runner nodes dynamically based on Redis queue depth rather than CPU thresholds, ensuring zero dropped compilation jobs during sudden classroom or campus traffic spikes.

---

## 9. Phased Implementation Roadmap

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PHASED EXECUTION ROADMAP                        │
├────────────────────────────────────────────────────────────────────────┤
│ PHASE 1: Core Foundation & Session Persistence                         │
│ • Provision Replit Managed PostgreSQL database                         │
│ • Implement FastAPI CRUD session routes (/api/sessions)                │
│ • Mount Monaco Editor with client-side auto-save and URL slug syncing  │
├────────────────────────────────────────────────────────────────────────┤
│ PHASE 2: Multi-Language Compilation & Execution Pipeline               │
│ • Build subprocess orchestration for C, Lua, and Python                │
│ • Standardize stdout, stderr, and exit code capture                    │
│ • Implement ephemeral scratchpad lifecycle management                  │
├────────────────────────────────────────────────────────────────────────┤
│ PHASE 3: Sandbox Hardening & Resource Containment                      │
│ • Enforce strict 5.0-second SIGKILL timeouts and 256MB memory ceilings │
│ • Restrict process limits (pids.max = 30) and strip network routing    │
├────────────────────────────────────────────────────────────────────────┤
│ PHASE 4: Motion Animation & Data Structure Visualizer                  │
│ • Integrate Motion for spring-animated array swaps                     │
│ • Implement React Flow canvas for tree and linked-list node graphs     │
│ • Offload AST trace parsing to background Web Workers                  │
├────────────────────────────────────────────────────────────────────────┤
│ PHASE 5: Distributed Scaling & Queue Orchestration                     │
│ • Introduce Redis queue for asynchronous job dispatching               │
│ • Establish queue-depth autoscaling runner pool for high concurrency   │
└────────────────────────────────────────────────────────────────────────┘
```


---

## 10. Implementation Status

The build follows this plan with these differences and additions:

- **Runner agent.** Code can run on the user's own computer through an outbound WebSocket (`/ws/agent`), which covers both local Docker execution and secure remote access without port forwarding. Pairing uses a single-use code, a hashed per-computer token, and a browser-held owner key because the IDE has no accounts. See `README.md`.
- **Developer tooling.** Ruff, clang-format and gcc warnings provide format and lint through `/api/format` and `/api/lint`. A plugin panel toggles these and the built-in editor features. There is no third-party plugin loader and no language server protocol.
- **History and GitHub.** Every save keeps a revision (200 per file) with diff, restore and inline blame. GitHub push, import and gist run in the browser against api.github.com.
- **Data libraries.** Python runs can render DataFrames and matplotlib figures in the console.
- **Layouts and themes.** Four layouts with floating panels and a token-based theme system replace the single fixed layout described earlier.
- **Known limits.** The Replit sandbox has no outbound network. Server-side memory caps are not enforced on Windows. Docker mode was tested for Python only. Tracing is Python only.
