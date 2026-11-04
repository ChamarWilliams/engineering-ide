# Loopline: Browser IDE with a Step-by-Step Code Visualizer

![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Monaco](https://img.shields.io/badge/Monaco_Editor-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

A browser IDE that runs your code and then replays it one line at a time. Variables, call stacks, loops, pointers and heap objects are drawn as the program executes, for Python, JavaScript, TypeScript, Lua, shell, Java, C, C++, Rust and Go.

---

## Architecture Overview

```text
        +-------------------------------------------+
        |  Browser: Monaco editor, Flow / Map / Text |
        |  views, Visualizer panel, terminal         |
        +---------------------+---------------------+
                              |
                              | JSON / REST + WebSocket
                              v
        +-------------------------------------------+
        |  FastAPI backend: runner, tracers, history |
        +----------+------------------+-------------+
                   |                  |
                   v                  v
        +----------------+   +-----------------------+
        | SQLite / Postgres |   | Tracers (per language) |
        | files, history    |   | trace.js, trace.lua,   |
        +----------------+   | trace.sh, gdb, JDI,    |
                              | sys.settrace           |
                              +-----------------------+
```

Every tracer writes the same language-neutral trace (steps, call and return events, variables, heap objects, stdout), so one Visualizer renders all ten languages.

---

## Core Engineering Problem Solved

Debuggers show state, but they make you drive. Loopline records one full run in a sandbox and replays it, so you can scrub forwards and backwards through it.

* **One trace format:** `sys.settrace` for Python, the inspector protocol for Node, hooks for Lua, `trap DEBUG` for shell, JDI for Java and gdb for C, C++, Rust and Go all produce the same step and event shape.
* **Memory view:** programs with pointers or objects show array cells, pointer chips that move when reassigned, and heap nodes with their links.
* **Bounded runs:** traces stop at 1500 steps or the time limit and say so, and compile errors and crashes show a notice instead of failing silently.

---

## Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Backend** | Python 3.12, FastAPI | Run and trace API, version history, GitHub export |
| **Frontend** | Vanilla JavaScript, Monaco | Editor, Flow and Map views, Visualizer |
| **Storage** | SQLite, or Postgres via `DATABASE_URL` | Files and history per visitor |
| **Tracing** | gdb, JDK (JDI), Node inspector, Lua debug hooks | Step-level execution capture |
| **Runner agent** | Python, WebSocket, optional Docker | Runs code on your own computer |

## About this project

Loopline was built with AI-assisted development (Claude Code) as my entry for a Handshake challenge. It is shared so other people can use it and build on it, not as a finished commercial product. Expect rough edges.

Released under the [MIT License](LICENSE): use it, change it, and build on it freely, keeping the copyright notice.

## Quickstart

```bash
git clone https://github.com/ChamarWilliams/engineering-ide.git
cd engineering-ide
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # Linux and macOS: .venv/bin/pip
.venv/Scripts/pip install -r requirements-libs.txt # optional: numpy, pandas, matplotlib, cloud SDKs
.venv/Scripts/python -m uvicorn backend.main:app --port 8000
```

On Replit the `.replit` file does the same and installs `gcc` and Lua through Nix. Set `DATABASE_URL` to a Postgres URL to use Postgres instead of the local SQLite file in `data/`.

## What is in it

| Area | Where | Notes |
| --- | --- | --- |
| Editor, themes, layouts, floating panels | `static/app.js`, `themes.js`, `workspace.js` | Layout and theme choices persist per browser |
| Timeline and visualizer | `static/timeline.js`, `visualizer.js`, `backend/runner.py`, `backend/tracers.py`, `backend/tracer_scripts/` | Python, JS, TS, Lua, shell, Java, C, C++, Rust, Go; capped at 1500 steps |
| Completions, snippets, indent colours | `static/completions.js`, `indent.js` | Hand-written library tables, not a language server |
| Charts and tables from Python | `backend/runner.py` (`RUNNER`) | `display(df)` and matplotlib figures render in the console |
| Version history, diff, blame, restore | `backend/history.py`, `static/history.js` | Last 200 saves per file |
| GitHub push, import, gist | `static/github.js` | Talks to api.github.com from the browser. Your token stays in localStorage |
| Formatters and linters | `backend/tools.py`, `static/plugins.js` | Ruff, clang-format, gcc warnings, StyLua if installed |
| Runner agent | `agent/agent.py`, `backend/agents.py`, `static/runner.js` | See below |

## Runner agent

The agent runs on your computer and connects out to the IDE over a WebSocket, so nothing is port-forwarded.

1. In the IDE open the runner menu in the toolbar and choose Pair a computer.
2. Download the agent from the dialog (`/agent.zip`), unzip it, and run `pip install websockets`.
3. Run the command the dialog shows, for example `python agent.py --server https://your-ide --code ABCD-2345`.

Options:

- `--docker` runs every job in a container with no network, 256 MB of memory, 64 processes and dropped capabilities. Run `python agent.py --build-images` once to build the images from `agent/Dockerfile.python` and `agent/Dockerfile.native`.
- `--allow-network` lets Docker programs reach the network when they run, for cloud SDKs.
- `--pass-env NAME` passes one of your environment variables, such as `AWS_ACCESS_KEY_ID`, into programs. Repeat it for each variable.

How it is protected:

- A pairing code works once and expires after five minutes.
- Pairing issues a per-computer token. The server keeps only its hash.
- The IDE has no accounts, so the browser creates a random owner key and sends it with each request. Only the browser that paired a computer can list it or send it code.

## Tests

```bash
pip install -r requirements-dev.txt
python -m pytest
```

The suite in `tests/` runs every file in `samples/loopline-test-project` through the real API (trace and plain run), plus files, folders, history, search, graph, multi-file C and the tracer helpers. It uses a throwaway database. A language whose tools are not installed (gcc, g++, gdb, a JDK, Lua, Go, rustc) is skipped, and `-ra` prints each skip reason. `python -m pytest tests/test_tracing.py -k go` runs one language. The sample files and the manual checklist are in `samples/loopline-test-project/TESTING.md`.

## Limits

- Without `--docker` the agent runs programs directly on your machine with a time limit only. There is no memory cap and the network is open.
- Replit's sandbox has no outbound network, so cloud SDK code only reaches a cloud through your own agent.
- Memory limits on the server runner use POSIX rlimits and are not enforced on Windows.
- Importing every bundled library at once can exceed the five-second run limit.
- Tracing C, C++, Rust and Go needs gdb on the server; Java needs a JDK. Go traces stop early with gdb on Windows. Single-line infinite loops stop gdb stepping and return a partial trace.
- StyLua is not on PyPI. Install it separately and put it on PATH to format Lua.
- Docker mode was tested for Python only (python:3.12-slim). The C, C++ and Lua images and the data-science image are untested.

## Flow view

Flow is the main view; the text editor stays one click (or Alt+M) away and can be made the default in Settings.

- **Flow**: each function is a draggable cell on an infinite grid, and each call is a wire. Cells edit in place and write straight back to the file. Execute replays a real Python trace (call, return, mutation) with comets and call labels travelling along the wires; C, C++ and Lua replay their static call order after a normal run. Positions persist per session.
- **Map**: the project as a flowchart. Click a folder to open the next level, drag a file onto a folder to move it, and open any script as Flow or Text.
- **Settings > Views and flow**: start view, open scripts as, wire style (curved, straight, stepped), animated runs, dot grid, and the tab-bar switch.

API additions: `POST /api/graph`, `GET /api/tree`, `POST/DELETE /api/folders`, `PUT /api/sessions/{id}/folder`; sessions also store a `layout`.

### Sample project

`python scripts/sample_project.py` creates a three-file C project in a `calc` folder (`main` includes `mathops` and `buffer`). In the Map, hover a link between files to see what crosses it. Open `main` as a Flow and hover a wire to see each argument and return value with its C type and size (64-bit sizes). Python wires show the runtime type and `sys.getsizeof` size after a run. Files are analysed individually, so Execute on `main` does not link the other two files.

## File types, terminal, and command palette

- **New file** (Alt+N, tab "+", sidebar "+", Map "New file") opens a type picker. C, C++, Lua and Python run and open in Flow. JavaScript, TypeScript, HTML, CSS, JSON, YAML, SQL, Markdown, Shell, Java, Go, Rust and plain text open as text with syntax highlighting; they do not run from the editor yet.
- **Terminal**: the "+" next to the Run tab opens a local shell (PowerShell, bash, or `EIDE_SHELL`) or an SSH connection (password, private key, or default keys). Host keys are confirmed on first use and remembered in the browser; a changed key warns before connecting. Credentials are never stored.
- Terminal access is fail-closed: only loopback clients by default. `EIDE_TERMINAL=off` disables it; `EIDE_TERMINAL=token` with `EIDE_TERMINAL_TOKEN=...` allows remote use behind a token. Needs `asyncssh` and, on Windows, `pywinpty`.
- **Command palette**: Ctrl+P files, Ctrl+Shift+P commands, Ctrl+Shift+O cells in the current Flow. F1 lists all shortcuts. Editor options (font size, tab size, word wrap, minimap, line numbers, ligatures, sticky scroll, whitespace, bracket colours) are in Settings; Ctrl+= / Ctrl+- / Ctrl+0 change the font size.

## More languages, search, and file management

- JavaScript, TypeScript, Shell, Java, Go and Rust run and open in Flow. The server needs `node` (TypeScript uses `tsx` if present, otherwise Node's type stripping), `bash`, a JDK, `go` or `rustc`.
- Running a C or C++ file compiles the other files in its folder with it. Headers are generated from the source files, so `#include "name.h"` works for a file called `name`.
- Ctrl+Shift+F searches every file. Alt+Z toggles zen mode. Right-click files and folders in the sidebar to rename, move, duplicate or delete.

## Refactor everywhere

Rename a function in Flow, or rename a file, and the IDE offers to update the other files that import it. It shows each file and the lines that change, and you pick which to update. It covers C/C++ includes and calls, Python imports, and Lua requires; only files that import the renamed file are considered.

## Canvas and editor polish

- Flow cells snap to their neighbours with guide lines (hold Alt to drag freely), lock with a padlock, and collapse to a chip on header double-click. Ctrl+F finds a cell, Ctrl+Shift+1-4 saves a view bookmark and Ctrl+1-4 jumps back, and Export saves the canvas as PNG or SVG. Drag the arrow end of a wire onto another function to reroute the call.
- Files format on save when a formatter is installed, line endings normalise to LF, Ctrl+Tab cycles tabs by recent use, files can be dropped on the sidebar, pasted code offers missing imports, and `.http` files run as requests.

## Publish on Replit

1. Open the project in Replit. The `.replit` file already has the run command, the compilers (gcc, Lua) and a `[deployment]` block that installs `requirements.txt` and starts the server with terminals turned off.
2. Add a Postgres database (Tools, Database) so files survive republishing. Replit's deployed disk is wiped on each publish, so without `DATABASE_URL` the SQLite file is lost. The app uses Postgres automatically when `DATABASE_URL` is set. `GET /healthz` reports which one is in use.
3. Optional secrets: `EIDE_PASSWORD` puts the whole site behind a browser password prompt (any username). `EIDE_RUNS_PER_MIN` sets the per-visitor run limit (default 30, over the limit the app says to wait).
4. Press Publish, then Republish after any later change.
5. Open the link in a private window and on your phone. Create a file, refresh, and check it is still there. Run it once and compare with `/healthz`.

Each browser gets its own private file list on the deployed site (`EIDE_MULTIUSER=1`, already set in `.replit`): a cookie names the visitor, other visitors cannot list, open, change, delete or read the history of those files, and two visitors can use the same folder name. Clearing cookies or switching to another browser or phone starts an empty workspace, so use `EIDE_PASSWORD` plus one browser if you want the same files everywhere. Locally the variable is unset and everything stays in one list. Code runs on the server with a 5 second limit and none of the server's secrets in its environment. The local terminal only works on localhost.
