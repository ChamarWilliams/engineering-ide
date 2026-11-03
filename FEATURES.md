# Engineering IDE: feature list

Status: **Verified** means I exercised it in the browser or with a test. **Built, untested** means the code is in place but I haven't checked it end to end.

## Look
- **Quiet design**: two neutral themes, Ink (dark, the default) and Chalk (light), one surface with hairline dividers, a single restrained accent, a flat toolbar, underline tabs and quieter cells and wires. The console panel stays hidden until you run something, and the Visualizer is off by default. The older themes are still in Settings. Verified in the browser at one window size only; Settings, the new-file dialog and the Map view were not re-checked after the restyle.

## Views
- **Flow** (main view): functions as draggable cells, call wires between them, pan and zoom, fit to screen, auto layout. Verified.
- **Map**: the project directory as a flowchart. Folders drill down with breadcrumbs, files open as Flow or Text, file-to-file connections (includes, imports, requires) show what is passed. Verified except dragging a file onto a folder (built, untested).
- **Text**: the classic Monaco editor, kept as a backup. Switch with the tab-bar toggle or Alt+M.
- **Memory** (Alt+Y): a Memory Lab that steps a small C program one statement at a time and draws its memory. It runs its own simulated C interpreter (ints, int arrays, pointers, `&`, `*`, `[]`, `p++`, `malloc`/`calloc`/`free`, functions and recursion, `if`/`while`/`for`, `printf`, a built-in `swap`), not compiled code, so programs outside that subset are rejected with a line error. Eight samples, or "Use current C file" if it fits the subset.
  - **Pointer tethers**: each pointer gets a coloured laser from a rail at the top to the capsule it points at. Capsules show value, hex address and byte offset. Tethers glide on a spring when `p++` or `p = ...` moves them, and written capsules ripple.
  - **Stack and heap**: calls drop a frame onto the stack and the frame dissolves on return. Heap blocks float with a beam when something points at them. A block whose last pointer is lost turns into a red leak asteroid, and anything still allocated at exit is reported.
  - **Swap rail**: `swap(&a[j], &a[j+1])` arcs the two capsules over each other. Index variables (`i`, `j`, ...) appear as hovering badges under the array slot they point at. Comparisons pulse amber, then green or red.
  - **Fault sandbox**: drag a tether's end onto another capsule to repoint it, onto NULL, or into empty space. A bad target shows static and a SEGFAULT banner marked as armed, and the next dereference stops the run with the real fault: null, wild, use after free, buffer overflow, dangling stack pointer, double free, bad free, division by zero.
  - **Raw bytes**: one toggle swaps the capsules for an address table with 4-byte ints and 8-byte pointers in little-endian hex.
  - Verified in the browser: stepping, frames and heap blocks, tethers, leak detection, null fault, drag repoint, armed banner then real fault, byte table. Not verified by eye: the swap arcs, the comparison colour pulse, frame dissolve timing and the leak asteroid animation. Pointer arithmetic assumes 4-byte ints.
- **Visualizer** (side panel): one graphic that changes with the line being run, driven by the Python trace. It shows a loop with array bars and swap arc, an accumulator, a call with its variables, a return, a recursion call stack, or a linked-list chain with the current node. The Flow, Loops and Detailed tabs and the loop-step button are gone. Recursion frames, return values, output and the list nodes now come from the trace instead of fixed sample values. Checked in the browser on the recursion and linked-list samples only; the bubble sort and factorial graphics were not re-checked by eye.
  - **Loop lanes**: every loop in progress at the current step gets its own lane above the graphic, across the whole call stack, so an outer loop in `main` and an inner loop in a function it calls show together. Each lane has the loop line, the loop variable, a pass counter with a progress bar (dots for 20 passes or fewer), and a flash when its header runs. `while` loops show an open bar and a pass count. Checked on a loop in `main` calling a function with its own loop; threads are not traced.
  - **Dock below the flow**: the dock button in the Visualizer header moves the panel under the editor at full width, with the lanes beside the graphic. Drag its top edge to resize. The choice is saved per layout.
  - **Flow handoff**: running the flow stops on each def while its lines play in the Visualizer, then continues with the flow effects. A def that calls another hands off at the call and again on return.
- Settings choose the start view, how scripts open, wire style (curved, straight, stepped), run animation, dot grid, and whether the switch shows.

## Flow
- Click a cell to edit it in a floating, centered editor. Verified.
- Right-click quick-options menu, including rename, duplicate and remove. Menu verified; rename/duplicate/remove built, untested.
- Add a cell, remove a section, Ctrl+Z / Ctrl+Shift+Z for script history. Undo and redo verified; remove section built, untested.
- Run replay with glowing comets, trailing lines and call labels. Verified for Python; C/C++/Lua replay built, untested.
- Hover a wire to see the exact type (integer, pointer, and so on) and size in bytes. Verified for C.
- Memory chips showing live variable values during replay.
- Ghost cells for functions in other files.
- **Snap and align**: while you drag, a cell snaps to the edges and centres of its neighbours and draws a guide line; hold Alt to drag freely. Dropped cells snap to an 8 px grid, or 4 px with the fine grid setting. Snapping verified; the guide lines are drawn but I did not see them mid-drag, and the fine grid is built, untested.
- **Lock**: a padlock on each cell header freezes its position. Locked cells still open for editing and keep their place on Auto layout. Verified, and saved with the layout.
- **Collapse to a chip**: double-click a header to fold the body away, leaving the title, signature, pins and dot. Verified, and saved with the layout. A single click now waits about a quarter of a second before opening the editor so a double-click can win.
- **Find a cell**: Ctrl+F in Flow opens the cell search, then pans and zooms the camera to the match and flashes it. Verified.
- **View bookmarks**: Ctrl+Shift+1-4 saves the current view, Ctrl+1-4 glides back to it. Also in the palette, since some browsers keep Ctrl+1-4 for their own tabs. Verified through the actions; the key chords themselves were not pressed in a real browser.
- **Export**: Export button (and palette) saves the whole canvas as SVG or PNG. Verified that both files are produced and the SVG is valid; I did not open the images. Code in the export is plain text, not syntax coloured.
- **Reroute a wire**: drag the arrow end of a wire onto another function and confirm; the calls in the source function are renamed to the new target. Verified on Python. Only the target end moves, arguments are not edited, and the new function should take the same arguments.

## Files and projects
- **Run and Flow**: C, C++, Lua, Python, JavaScript, TypeScript, Shell, Java, Go, Rust.
  - Verified: JavaScript (Flow + run), TypeScript and Shell (run), and the Flow analysis of all six new languages on sample code.
  - Built, untested: running Go, Rust and Java, because those toolchains aren't installed on this machine. They need Go, rustc and a JDK on the server.
  - Docker sandbox and the remote runner agent still run only C, C++, Lua and Python.
- **Text only** (highlighting, no run, no Flow): HTML, CSS, JSON, YAML, SQL, Markdown, plain text.
- **New popup** (Alt+N, the + buttons, palette): an IntelliJ-style list with a filter box, grouped and scrollable. Pick a type then name it, or type a name with an extension such as `pom.xml` and press Enter. Also offers Folder and Project. Verified.
- **Projects**: File > New project style dialog with Empty project, Python script, Flask, FastAPI, Django, Spring Boot (Maven), Node and Express, Static website, C, C++, Rust (Cargo) and Go. Each writes its base files into a project folder, opens the entry file, and also writes them to the terminal workspace so you can run `pip install`, `python manage.py runserver` or `mvn spring-boot:run` there. Verified: Django and Spring creation through the API, Django through the dialog. The scaffolds were not installed or run, so the framework versions in them are untested.
- **Import**: a folder from your computer (skips `.git`, `node_modules`, build output, binaries and files over 1 MB, up to 1500 files), or a GitHub repository. Verified through the API; the folder picker itself was not clicked through.
- Sidebar folders collapse, empty folders show, and the file list holds up to 300 files. New file types: XML, Properties and TOML.
- Python, Lua, JavaScript and TypeScript files in the same folder can now import each other when you run one. Verified for Python.
- "Write project to terminal workspace" (palette) re-syncs your edited files to the workspace folder.
- New-file dialog with type picker and extension detection (Alt+N). New files start empty, and Flow offers a Load example button. Verified.
- **Multi-file C and C++ builds**: running a file in a folder compiles the other C/C++ files in that folder with it and generates headers from them, so `#include "mathops.h"` resolves. Verified for the file set and compile command on the `calc` project; not compiled here because gcc isn't installed on this machine.
- **Sidebar**: right-click a file for open as Flow or text, rename, duplicate, move, delete; right-click a folder for new file, rename, delete with contents. Verified through the API and the menu; the rename and delete dialogs were not clicked through.
- **Find in files** (Ctrl+Shift+F): case, whole word and regex options, results grouped by file, jumps to the match. Verified.
- **Empty project**: closing the last tab or deleting the last file leaves a "No files open" screen with a New file button instead of forcing a blank file. Verified.
- **Zen mode** (Alt+Z, Esc to leave). Verified.
- **Refactor everywhere**: renaming a function (Flow cell menu, or the palette command "Refactor: rename function everywhere") or a file (sidebar, tab title, palette) asks whether to update the other files that import it, with a checklist of files and the lines that change. Works for C/C++ (`#include` and calls), Python (`import`, `from ... import`, `module.func`) and Lua (`require`, `module.func`). Comments and strings are left alone. Verified end to end for C, and on sample code for Python and Lua.
- Folders, tabs, import files, share, version history, GitHub import/export (live GitHub API untested).
- A sample `calc` project showing cross-file connections.

## Running
- Run (Shift+F10), Stop (Ctrl+F2), rerun, clear.
- Output panel with rich output (plots) and a step timeline.
- Runner agent and plugins for remote or sandboxed execution (Docker images for C/C++/Lua untested).

## Terminal
- Local shell (PowerShell, bash, or `EIDE_SHELL`) in the panel. Verified.
- SSH with password, private key or default keys. Backend verified against a test server; UI flow untested.
- Host key confirmation on first use, warning if the key changes, remembered per host.
- Multiple terminal tabs, resize, clickable links.
- Fail-closed access: localhost only by default, `EIDE_TERMINAL=off|local|token`.

## Editor
- Monaco 0.52 with indent colours, custom completions, data-library completions, themes.
- Command palette: Ctrl+P files, Ctrl+Shift+P commands, Ctrl+Shift+O cells. Verified.
- Settings: font size, tab size, word wrap (verified), minimap, line numbers, ligatures, sticky scroll, whitespace, bracket colours. They apply to the main editor and to the Flow cell editor.
- Ctrl+= / Ctrl+- / Ctrl+0 font zoom, F1 shortcuts list. Verified.
- Layouts and themes in Settings, floating and dockable panels.
- **Format on save**: runs the active formatter for the language when one is installed (Prettier support added for JS, TS, HTML, CSS, JSON, YAML, Markdown). Built, untested here: Prettier isn't installed on this machine.
- **Line endings**: CRLF is converted to LF on save, with a setting to turn it off. Verified.
- **Local history**: every save keeps a revision independent of Git, with a History panel to restore from. Verified earlier.
- **Multi-cursor**: Ctrl+D selects the next match, Alt+click adds cursors (Monaco defaults, listed in F1).
- **Ctrl+Tab** cycles tabs in most-recently-used order with a switcher overlay; Alt+Q jumps to the previous tab. Verified. A regular browser may keep Ctrl+Tab for itself, which is why Alt+Q exists.
- **Drag files into the sidebar** to import them, dropping on a folder puts them in it; unsupported types are skipped. Verified.
- **Auto-import on paste**: pasting code that uses a missing `#include` or Python `import` offers to add it (also in the palette: "Add missing imports"). Tables cover C, C++ and Python only. Verified for C.
- **Terminal history** and scrollback survive a reload (plain text, no keystroke capture), with a setting to turn it off. Verified.
- **Bracket pair colours** and **sticky scroll** are on by default. Sticky scroll is Monaco's, verified setting only.
- **Run badge**: milliseconds and peak memory beside Run after each run. Verified for Node (Windows peak working set); on Linux/macOS the memory figure is an approximate delta.
- **Theme follows the system** light/dark with a manual override, and an optional completion chime. Built, untested.
- **`.http` scratch files**: write `GET http://...` requests and run them; shows status, headers and a formatted body. Verified against a local URL. Requests go from the browser, so other hosts need CORS to allow them.

## Publishing
- **Replit ready**: `.replit` has the compilers, a deployment build and run command, and terminals turned off for the live site. README has the publish steps.
- **Health check**: `GET /healthz` says the server is up and whether files are in Postgres or SQLite.
- **Optional password**: set `EIDE_PASSWORD` and the whole site asks for it (health check excepted). Tested with right, wrong and missing passwords.
- **Private workspaces**: with `EIDE_MULTIUSER=1` (set in `.replit`) each browser gets its own files, folders and history through a cookie. Tested with two visitors: neither can see, open, overwrite, delete or read the history of the other's files, and both can have a folder with the same name. Existing local files are kept as the single-user list. The same file list does not follow you to another browser or phone.
- **Run limit**: each visitor gets 30 runs or traces a minute (`EIDE_RUNS_PER_MIN`), then a clear "wait and try again" message. Tested at a limit of 2.
- **Not done**: I have not pressed Publish or opened a live link, so the live version is untested. On Replit you must add a Postgres database or files vanish on each republish. 

## Not built yet
- Rerouting the source end of a wire, and wires that carry different arguments after a reroute.
- Flow view zoom keeps the dot grid static during the camera glide.
- Running Go, Rust and Java has not been exercised on a machine with those tools.
- Flow cell types and tracing: only Python gets a real traced replay; other languages replay the static call order after a run.
- HTML preview, JSON/YAML validation and SQL execution.
- Multi-file builds for the remote runner agent and Docker sandbox (they compile the single open file).
- Hover type details on Flow wires for languages other than C and C++.
