# Loopline test project

Import this folder, then work down the checklist. Each file is small on purpose. Open it, press **Execute** in Flow (or **Run**), open the **Visualizer** from the left stripe, and press Play.

How to import: on the empty screen or in the sidebar choose **Import folder**, or drag the folders onto the sidebar.

Mark each row Pass or Fail and note anything odd. The output column and the error and limit results come from running every file on the local Windows server when this project was built. The descriptions of what the Visualizer draws are what it should show; they were checked by eye only for `c/pointer_array.c`, `python/linked_list.py` and the seven examples. Rows marked (Replit) have not been seen on Replit yet.

## 1. Tracing, one file per language

| File | Expected in the Visualizer | Expected output |
| --- | --- | --- |
| `python/recursion.py` | Call stack grows for `fact` and `fib`, return values shown | `120` then `5` |
| `python/bubble_sort.py` | Array bars with swaps, nested loop lanes | `[1, 2, 3, 4, 5]` |
| `python/linked_list.py` | Memory view: `head` and `cur` chips, node chain, `next` arrows ending at NULL | `30` |
| `python/objects_and_dicts.py` | Object `acct` as a heap node, dict with a list inside | `Ada 175 {'deposits': [25, 50], 'count': 2}` |
| `c/pointer_array.c` | Array cells, `nPtr` chip slides from 0 to 3 to 4, cell 4 becomes 40 | `0`, `3`, `40` |
| `c/linked_list.c` | Heap nodes created by `push`, chain follows `next`, traversal pointer `cur` | `60` |
| `c/recursion.c` | Call stack for `fact` | `120` |
| `c/bubble_sort.c` | Array with swaps and loop lanes | `1 2 3 4 5` |
| `cpp/vector_sum.cpp` | Calls to `square`, vector contents shown | `total 30` |
| `cpp/counter_class.cpp` | `bump` calls, `c.count` grows | `6` |
| `java/Main.java` | `fact` stack, `Node` chain in the memory view | `total 9, head 30` |
| `javascript/fib.js` | Deep call tree for `fib(5)` | `5` |
| `javascript/objects_and_arrays.js` | `cart` object, items array grows | printed object |
| `typescript/typed_sum.ts` | Runs as TypeScript, `total` ends at 30 | `30` |
| `lua/factorial.lua` | Calls to `fact`, loop in `i` | `33` |
| `shell/loop.sh` | Lines of the loop, `total` grows | `total=6` |
| `rust/main.rs` | Calls to `square` | `14` |
| `go/main.go` | Calls to `square`. Go stops after a few lines with gdb on Windows, so check this one on Replit (Replit) | `14` |

## 2. Failure and limit cases

| File | Expected |
| --- | --- |
| `c/compile_error.c` | A notice starting "Compile error:" with the line, no steps |
| `c/crash_segfault.c` | Steps up to the bad write, then "Program stopped: Segmentation fault". Text printed just before the crash may be missing on Windows (Replit) |
| `c/step_limit.c` | 1500 steps, then "Trace stopped early (step limit)" |
| `python/step_limit.py` | Same, 1500 steps and a step-limit notice |
| `python/raises_error.py` | Two lines of output (`2.0`, `4.0`), then a divide-by-zero error in the console |
| `javascript/throws_error.js` | Steps down three `check` calls, then the thrown error in the console |
| `java/ThrowsError.java` | Steps into `div`, then the `ArithmeticException` in the console. The class is not named `Main`, which is fine |
| `c/reads_input.c` | Prints `n = 7`. Input is not connected, so `scanf` gets end of file |

## 3. Multi-file C

Open `c-multifile/main.c`. Expect `total = 20, buffer sum = 86`. The trace should step into `add`, `scale`, `fill` and `buffer_sum`, which live in the other two files. In **Map**, the three files show as linked. The headers `mathops.h` and `buffer.h` do not exist on disk; Loopline generates them.

## 4. Views and editor features

Try these on `python/recursion.py` and `c/linked_list.c`.

- **Flow**: cells for each function, wires for calls, comets and call labels travelling during Execute. Real calls and returns for every language above, not a fixed order. Pause, Step and Reset work.
- **Map**: shows folders and files, drag a file onto a folder to move it.
- **Text**: Alt+M toggles. Syntax highlighting and completions work.
- **Visualizer**: Play, step back and forward, speed buttons, dock below the flow, loop lanes for nested loops.
- **History**: edit a file twice, open History, check the diff and restore.
- **Format on save**: for Python (Ruff) and C/C++ (clang-format) if installed. Missing formatters should not break saving.
- **Rename refactor**: rename `add` in `c-multifile/mathops.c`; Loopline should offer to update `main.c`.
- **Refresh**: reload the page and check files and folders are still there. On Replit with a database this should survive a republish.
- **Other files**: the files in `other-files/` open as text with highlighting and show no Run button.

## 5. Examples

Close all tabs so the empty screen shows. Click each of the seven examples. Each opens a file with the Visualizer visible; press Execute.

## Known limits

- Go traces are short with gdb on Windows.
- Lines run inside `$( ... )` in a shell script are not shown in the trace, though the program still behaves correctly.
- Single-line infinite loops in compiled languages return a partial trace marked as cut by time.
- The Docker sandbox traces Python only.
