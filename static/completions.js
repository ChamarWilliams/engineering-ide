const Completions = (() => {
  const C = [
    ['printf', 'int printf(const char *format, ...)', 'Print formatted output to stdout.'],
    ['scanf', 'int scanf(const char *format, ...)', 'Read formatted input from stdin.'],
    ['puts', 'int puts(const char *s)', 'Write a string and a newline to stdout.'],
    ['putchar', 'int putchar(int c)', 'Write one character to stdout.'],
    ['getchar', 'int getchar(void)', 'Read one character from stdin.'],
    ['fgets', 'char *fgets(char *s, int size, FILE *stream)', 'Read a line into a buffer.'],
    ['fopen', 'FILE *fopen(const char *path, const char *mode)', 'Open a file.'],
    ['fclose', 'int fclose(FILE *stream)', 'Close a file.'],
    ['fprintf', 'int fprintf(FILE *stream, const char *format, ...)', 'Print formatted output to a stream.'],
    ['snprintf', 'int snprintf(char *buf, size_t size, const char *format, ...)', 'Print formatted output into a buffer with a size limit.'],
    ['malloc', 'void *malloc(size_t size)', 'Allocate uninitialized memory.'],
    ['calloc', 'void *calloc(size_t n, size_t size)', 'Allocate zeroed memory for an array.'],
    ['realloc', 'void *realloc(void *ptr, size_t size)', 'Resize an allocation.'],
    ['free', 'void free(void *ptr)', 'Release an allocation.'],
    ['memcpy', 'void *memcpy(void *dst, const void *src, size_t n)', 'Copy n bytes; regions must not overlap.'],
    ['memmove', 'void *memmove(void *dst, const void *src, size_t n)', 'Copy n bytes; regions may overlap.'],
    ['memset', 'void *memset(void *s, int c, size_t n)', 'Fill memory with a byte value.'],
    ['memcmp', 'int memcmp(const void *a, const void *b, size_t n)', 'Compare n bytes.'],
    ['strlen', 'size_t strlen(const char *s)', 'Length of a string.'],
    ['strcpy', 'char *strcpy(char *dst, const char *src)', 'Copy a string. Does not check bounds.'],
    ['strncpy', 'char *strncpy(char *dst, const char *src, size_t n)', 'Copy at most n characters.'],
    ['strcat', 'char *strcat(char *dst, const char *src)', 'Append a string.'],
    ['strcmp', 'int strcmp(const char *a, const char *b)', 'Compare two strings.'],
    ['strncmp', 'int strncmp(const char *a, const char *b, size_t n)', 'Compare at most n characters.'],
    ['strchr', 'char *strchr(const char *s, int c)', 'Find the first occurrence of a character.'],
    ['strstr', 'char *strstr(const char *haystack, const char *needle)', 'Find a substring.'],
    ['atoi', 'int atoi(const char *s)', 'Convert a string to int.'],
    ['strtol', 'long strtol(const char *s, char **end, int base)', 'Convert a string to long with error checking.'],
    ['abs', 'int abs(int x)', 'Absolute value of an int.'],
    ['rand', 'int rand(void)', 'Pseudo-random number from 0 to RAND_MAX.'],
    ['srand', 'void srand(unsigned seed)', 'Seed the random generator.'],
    ['qsort', 'void qsort(void *base, size_t n, size_t size, int (*cmp)(const void *, const void *))', 'Sort an array with a comparison function.'],
    ['exit', 'void exit(int status)', 'End the program.'],
    ['sqrt', 'double sqrt(double x)', 'Square root. Link with -lm.'],
    ['pow', 'double pow(double x, double y)', 'x raised to the power y.'],
    ['fabs', 'double fabs(double x)', 'Absolute value of a double.'],
    ['floor', 'double floor(double x)', 'Round down.'],
    ['ceil', 'double ceil(double x)', 'Round up.'],
    ['sin', 'double sin(double x)', 'Sine in radians.'],
    ['cos', 'double cos(double x)', 'Cosine in radians.'],
    ['log', 'double log(double x)', 'Natural logarithm.'],
    ['time', 'time_t time(time_t *t)', 'Current time in seconds since the epoch.'],
    ['clock', 'clock_t clock(void)', 'Processor time used by the program.'],
    ['isdigit', 'int isdigit(int c)', 'True for 0-9.'],
    ['isalpha', 'int isalpha(int c)', 'True for letters.'],
    ['toupper', 'int toupper(int c)', 'Convert to uppercase.'],
    ['tolower', 'int tolower(int c)', 'Convert to lowercase.'],
  ];

  const CPP = [
    ['std::vector', 'template <class T> class vector', 'Dynamic array. #include <vector>'],
    ['std::string', 'class string', 'Owning string. #include <string>'],
    ['std::map', 'template <class K, class V> class map', 'Ordered key-value map. #include <map>'],
    ['std::unordered_map', 'template <class K, class V> class unordered_map', 'Hash map. #include <unordered_map>'],
    ['std::set', 'template <class T> class set', 'Ordered set. #include <set>'],
    ['std::unordered_set', 'template <class T> class unordered_set', 'Hash set. #include <unordered_set>'],
    ['std::array', 'template <class T, size_t N> class array', 'Fixed-size array. #include <array>'],
    ['std::deque', 'template <class T> class deque', 'Double-ended queue. #include <deque>'],
    ['std::queue', 'template <class T> class queue', 'FIFO queue adapter. #include <queue>'],
    ['std::stack', 'template <class T> class stack', 'LIFO stack adapter. #include <stack>'],
    ['std::priority_queue', 'template <class T> class priority_queue', 'Max-heap by default. #include <queue>'],
    ['std::pair', 'template <class A, class B> struct pair', 'Two values together. #include <utility>'],
    ['std::optional', 'template <class T> class optional', 'A value that may be absent. #include <optional>'],
    ['std::unique_ptr', 'template <class T> class unique_ptr', 'Sole-owner smart pointer. #include <memory>'],
    ['std::shared_ptr', 'template <class T> class shared_ptr', 'Shared-owner smart pointer. #include <memory>'],
    ['std::make_unique', 'std::unique_ptr<T> make_unique<T>(Args&&... args)', 'Construct a unique_ptr.'],
    ['std::make_shared', 'std::shared_ptr<T> make_shared<T>(Args&&... args)', 'Construct a shared_ptr.'],
    ['std::sort', 'void sort(RandomIt first, RandomIt last, Compare comp)', 'Sort a range. #include <algorithm>'],
    ['std::find', 'InputIt find(InputIt first, InputIt last, const T &value)', 'Find a value in a range.'],
    ['std::reverse', 'void reverse(BidirIt first, BidirIt last)', 'Reverse a range.'],
    ['std::max', 'const T &max(const T &a, const T &b)', 'Larger of two values.'],
    ['std::min', 'const T &min(const T &a, const T &b)', 'Smaller of two values.'],
    ['std::swap', 'void swap(T &a, T &b)', 'Swap two values.'],
    ['std::accumulate', 'T accumulate(InputIt first, InputIt last, T init)', 'Sum a range. #include <numeric>'],
    ['std::cout', 'std::ostream cout', 'Standard output stream. #include <iostream>'],
    ['std::cin', 'std::istream cin', 'Standard input stream. #include <iostream>'],
    ['std::endl', 'std::ostream &endl(std::ostream &os)', 'Newline and flush.'],
    ['std::to_string', 'std::string to_string(T value)', 'Convert a number to a string.'],
    ['std::getline', 'std::istream &getline(std::istream &is, std::string &s)', 'Read a line into a string.'],
    ['std::move', 'T &&move(T &t)', 'Cast to an rvalue to allow moving.'],
  ];

  const LUA = [
    ['print', 'print(...)', 'Print values separated by tabs.'],
    ['type', 'type(v)', 'Name of the value type.'],
    ['tostring', 'tostring(v)', 'Convert a value to a string.'],
    ['tonumber', 'tonumber(v, base)', 'Convert a value to a number, or nil.'],
    ['pairs', 'pairs(t)', 'Iterate all key-value pairs of a table.'],
    ['ipairs', 'ipairs(t)', 'Iterate the array part of a table in order.'],
    ['next', 'next(t, key)', 'Next key-value pair in a table.'],
    ['select', 'select(n, ...)', 'Pick arguments from n onward, or count them with "#".'],
    ['assert', 'assert(v, message)', 'Raise an error if v is false or nil.'],
    ['error', 'error(message, level)', 'Raise an error.'],
    ['pcall', 'pcall(f, ...)', 'Call f in protected mode. Returns ok, result.'],
    ['xpcall', 'xpcall(f, handler, ...)', 'Protected call with an error handler.'],
    ['setmetatable', 'setmetatable(t, mt)', 'Set the metatable of a table.'],
    ['getmetatable', 'getmetatable(t)', 'Get the metatable of a table.'],
    ['rawget', 'rawget(t, k)', 'Get a field without metamethods.'],
    ['rawset', 'rawset(t, k, v)', 'Set a field without metamethods.'],
    ['require', 'require(name)', 'Load a module.'],
    ['string.format', 'string.format(fmt, ...)', 'Format values like printf.'],
    ['string.sub', 'string.sub(s, i, j)', 'Substring from i to j.'],
    ['string.find', 'string.find(s, pattern, init, plain)', 'Find a pattern. Returns start and end.'],
    ['string.match', 'string.match(s, pattern, init)', 'Return captures of a pattern match.'],
    ['string.gmatch', 'string.gmatch(s, pattern)', 'Iterate over pattern matches.'],
    ['string.gsub', 'string.gsub(s, pattern, repl, n)', 'Replace pattern matches.'],
    ['string.rep', 'string.rep(s, n, sep)', 'Repeat a string n times.'],
    ['string.upper', 'string.upper(s)', 'Uppercase.'],
    ['string.lower', 'string.lower(s)', 'Lowercase.'],
    ['string.len', 'string.len(s)', 'Length of a string.'],
    ['table.insert', 'table.insert(t, pos, value)', 'Insert a value. Omit pos to append.'],
    ['table.remove', 'table.remove(t, pos)', 'Remove and return a value.'],
    ['table.concat', 'table.concat(t, sep, i, j)', 'Join array elements into a string.'],
    ['table.sort', 'table.sort(t, comp)', 'Sort in place.'],
    ['table.unpack', 'table.unpack(t, i, j)', 'Return array elements as separate values.'],
    ['math.floor', 'math.floor(x)', 'Round down.'],
    ['math.ceil', 'math.ceil(x)', 'Round up.'],
    ['math.max', 'math.max(x, ...)', 'Largest argument.'],
    ['math.min', 'math.min(x, ...)', 'Smallest argument.'],
    ['math.abs', 'math.abs(x)', 'Absolute value.'],
    ['math.sqrt', 'math.sqrt(x)', 'Square root.'],
    ['math.random', 'math.random(m, n)', 'Random number.'],
    ['math.huge', 'math.huge', 'Positive infinity.'],
    ['os.time', 'os.time(table)', 'Current time in seconds.'],
    ['os.clock', 'os.clock()', 'CPU time used, in seconds.'],
    ['io.write', 'io.write(...)', 'Write to stdout without a newline.'],
    ['io.read', 'io.read(format)', 'Read from stdin.'],
  ];

  const PY = [
    ['print', 'print(*values, sep=" ", end="\\n")', 'Print values to stdout.'],
    ['len', 'len(obj)', 'Number of items.'],
    ['range', 'range(start, stop, step)', 'Sequence of integers.'],
    ['enumerate', 'enumerate(iterable, start=0)', 'Pairs of (index, item).'],
    ['zip', 'zip(*iterables)', 'Iterate several iterables together.'],
    ['map', 'map(function, iterable)', 'Apply a function to each item.'],
    ['filter', 'filter(function, iterable)', 'Keep items where the function is true.'],
    ['sorted', 'sorted(iterable, key=None, reverse=False)', 'New sorted list.'],
    ['reversed', 'reversed(seq)', 'Iterate in reverse.'],
    ['sum', 'sum(iterable, start=0)', 'Sum of items.'],
    ['min', 'min(iterable, key=None)', 'Smallest item.'],
    ['max', 'max(iterable, key=None)', 'Largest item.'],
    ['abs', 'abs(x)', 'Absolute value.'],
    ['round', 'round(number, ndigits=None)', 'Round to ndigits decimals.'],
    ['any', 'any(iterable)', 'True if any item is true.'],
    ['all', 'all(iterable)', 'True if all items are true.'],
    ['isinstance', 'isinstance(obj, cls)', 'Check the type of an object.'],
    ['open', 'open(file, mode="r", encoding=None)', 'Open a file.'],
    ['input', 'input(prompt="")', 'Read a line from stdin.'],
    ['int', 'int(x, base=10)', 'Convert to int.'],
    ['float', 'float(x)', 'Convert to float.'],
    ['str', 'str(obj)', 'Convert to string.'],
    ['list', 'list(iterable)', 'Create a list.'],
    ['dict', 'dict(**kwargs)', 'Create a dictionary.'],
    ['set', 'set(iterable)', 'Create a set.'],
    ['tuple', 'tuple(iterable)', 'Create a tuple.'],
    ['display', 'display(obj)', 'Show a DataFrame or Series as a table in the Run panel.'],
  ];

  const MODULES = {
    math: [
      ['sqrt', 'math.sqrt(x)', 'Square root.'], ['floor', 'math.floor(x)', 'Round down to int.'], ['ceil', 'math.ceil(x)', 'Round up to int.'],
      ['pi', 'math.pi', 'The constant pi.'], ['e', 'math.e', 'Euler\'s number.'], ['sin', 'math.sin(x)', 'Sine in radians.'],
      ['cos', 'math.cos(x)', 'Cosine in radians.'], ['log', 'math.log(x, base)', 'Logarithm.'], ['pow', 'math.pow(x, y)', 'x to the power y.'],
      ['gcd', 'math.gcd(*integers)', 'Greatest common divisor.'], ['factorial', 'math.factorial(n)', 'n factorial.'], ['inf', 'math.inf', 'Positive infinity.'],
    ],
    random: [
      ['random', 'random.random()', 'Float in [0, 1).'], ['randint', 'random.randint(a, b)', 'Integer in [a, b].'], ['choice', 'random.choice(seq)', 'Pick one item.'],
      ['shuffle', 'random.shuffle(x)', 'Shuffle a list in place.'], ['sample', 'random.sample(population, k)', 'k unique items.'], ['seed', 'random.seed(a)', 'Seed the generator.'],
    ],
    os: [
      ['getcwd', 'os.getcwd()', 'Current directory.'], ['listdir', 'os.listdir(path)', 'Names in a directory.'], ['environ', 'os.environ', 'Environment variables.'],
      ['path', 'os.path', 'Path helpers.'], ['makedirs', 'os.makedirs(name, exist_ok=False)', 'Create directories.'],
    ],
    sys: [['argv', 'sys.argv', 'Command-line arguments.'], ['exit', 'sys.exit(status)', 'End the program.'], ['stdout', 'sys.stdout', 'Standard output stream.'], ['path', 'sys.path', 'Module search path.']],
    json: [['dumps', 'json.dumps(obj, indent=None)', 'Serialize to a JSON string.'], ['loads', 'json.loads(s)', 'Parse a JSON string.'], ['dump', 'json.dump(obj, fp)', 'Write JSON to a file.'], ['load', 'json.load(fp)', 'Read JSON from a file.']],
    re: [['match', 're.match(pattern, string)', 'Match at the start.'], ['search', 're.search(pattern, string)', 'Find the first match.'], ['findall', 're.findall(pattern, string)', 'All matches as a list.'], ['sub', 're.sub(pattern, repl, string)', 'Replace matches.'], ['compile', 're.compile(pattern)', 'Compile a pattern.']],
    time: [['time', 'time.time()', 'Seconds since the epoch.'], ['sleep', 'time.sleep(seconds)', 'Pause.'], ['perf_counter', 'time.perf_counter()', 'High-resolution timer.']],
    collections: [['Counter', 'collections.Counter(iterable)', 'Count hashable items.'], ['defaultdict', 'collections.defaultdict(default_factory)', 'Dict with default values.'], ['deque', 'collections.deque(iterable)', 'Double-ended queue.'], ['namedtuple', 'collections.namedtuple(typename, fields)', 'Tuple with named fields.']],
    numpy: [
      ['array', 'np.array(object, dtype=None)', 'Create an array.'], ['zeros', 'np.zeros(shape)', 'Array of zeros.'], ['ones', 'np.ones(shape)', 'Array of ones.'],
      ['arange', 'np.arange(start, stop, step)', 'Evenly spaced values.'], ['linspace', 'np.linspace(start, stop, num)', 'num points between start and stop.'],
      ['mean', 'np.mean(a, axis=None)', 'Average.'], ['median', 'np.median(a, axis=None)', 'Median.'], ['std', 'np.std(a, axis=None)', 'Standard deviation.'],
      ['sum', 'np.sum(a, axis=None)', 'Sum.'], ['dot', 'np.dot(a, b)', 'Dot product.'], ['reshape', 'np.reshape(a, newshape)', 'Change shape.'],
      ['random', 'np.random', 'Random number tools.'], ['where', 'np.where(condition, x, y)', 'Choose by condition.'], ['sort', 'np.sort(a, axis=-1)', 'Sorted copy.'],
    ],
    pandas: [
      ['DataFrame', 'pd.DataFrame(data, columns=None)', 'Table of data.'], ['Series', 'pd.Series(data, index=None)', 'One labeled column.'],
      ['read_csv', 'pd.read_csv(filepath)', 'Load a CSV file.'], ['concat', 'pd.concat(objs, axis=0)', 'Stack tables.'], ['merge', 'pd.merge(left, right, on=None, how="inner")', 'Join two tables.'],
      ['to_datetime', 'pd.to_datetime(arg)', 'Parse dates.'], ['isna', 'pd.isna(obj)', 'Detect missing values.'],
    ],
    'matplotlib.pyplot': [
      ['plot', 'plt.plot(x, y)', 'Line plot.'], ['scatter', 'plt.scatter(x, y)', 'Scatter plot.'], ['bar', 'plt.bar(x, height)', 'Bar chart.'], ['hist', 'plt.hist(x, bins=10)', 'Histogram.'],
      ['title', 'plt.title(label)', 'Set the title.'], ['xlabel', 'plt.xlabel(label)', 'Label the x-axis.'], ['ylabel', 'plt.ylabel(label)', 'Label the y-axis.'],
      ['legend', 'plt.legend()', 'Show the legend.'], ['figure', 'plt.figure(figsize=None)', 'Create a figure.'], ['subplots', 'plt.subplots(nrows=1, ncols=1)', 'Figure and axes.'], ['show', 'plt.show()', 'Show the figure in the Run panel.'],
    ],
  };

  const SNIPPETS = {
    c: [
      ['main', 'int main(void) {\n\t$0\n\treturn 0;\n}', 'main function'],
      ['inc', '#include <${1:stdio}.h>', 'include a header'],
      ['for', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}', 'for loop'],
      ['while', 'while (${1:cond}) {\n\t$0\n}', 'while loop'],
      ['if', 'if (${1:cond}) {\n\t$0\n}', 'if statement'],
      ['struct', 'typedef struct {\n\t$0\n} ${1:Name};', 'typedef struct'],
      ['sw', 'switch (${1:x}) {\ncase ${2:0}:\n\t$0\n\tbreak;\ndefault:\n\tbreak;\n}', 'switch statement'],
    ],
    cpp: [
      ['main', 'int main() {\n\t$0\n\treturn 0;\n}', 'main function'],
      ['inc', '#include <${1:iostream}>', 'include a header'],
      ['for', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n\t$0\n}', 'for loop'],
      ['forr', 'for (const auto &${1:x} : ${2:items}) {\n\t$0\n}', 'range-based for'],
      ['class', 'class ${1:Name} {\npublic:\n\t${1:Name}();\n\t$0\n};', 'class'],
      ['lambda', '[${1:&}](${2:int x}) {\n\t$0\n}', 'lambda'],
    ],
    lua: [
      ['for', 'for ${1:i} = ${2:1}, ${3:n} do\n\t$0\nend', 'numeric for'],
      ['forp', 'for ${1:k}, ${2:v} in pairs(${3:t}) do\n\t$0\nend', 'pairs loop'],
      ['fori', 'for ${1:i}, ${2:v} in ipairs(${3:t}) do\n\t$0\nend', 'ipairs loop'],
      ['fn', 'local function ${1:name}(${2:args})\n\t$0\nend', 'local function'],
      ['if', 'if ${1:cond} then\n\t$0\nend', 'if statement'],
      ['class', 'local ${1:Class} = {}\n${1:Class}.__index = ${1:Class}\n\nfunction ${1:Class}.new(${2:args})\n\tlocal self = setmetatable({}, ${1:Class})\n\t$0\n\treturn self\nend', 'class with metatable'],
    ],
    python: [
      ['main', 'def main():\n\t$0\n\n\nif __name__ == "__main__":\n\tmain()', 'main guard'],
      ['for', 'for ${1:item} in ${2:items}:\n\t$0', 'for loop'],
      ['fori', 'for ${1:i} in range(${2:n}):\n\t$0', 'for in range'],
      ['def', 'def ${1:name}(${2:args}):\n\t$0', 'function'],
      ['class', 'class ${1:Name}:\n\tdef __init__(self${2:, args}):\n\t\t$0', 'class'],
      ['try', 'try:\n\t$1\nexcept ${2:Exception} as ${3:e}:\n\t$0', 'try/except'],
      ['with', 'with open(${1:"file.txt"}) as ${2:f}:\n\t$0', 'with open'],
      ['lc', '[${1:x} for ${2:x} in ${3:items}]', 'list comprehension'],
      ['np', 'import numpy as np', 'import numpy'],
      ['pd', 'import pandas as pd', 'import pandas'],
      ['plt', 'import matplotlib.pyplot as plt', 'import pyplot'],
    ],
  };

  const BY_LANG = { c: C, cpp: [...CPP, ...C], lua: LUA, python: PY };
  const MONACO_LANG = { c: 'c', cpp: 'cpp', lua: 'lua', python: 'python' };

  function paramSnippet(signature, name) {
    const open = signature.indexOf('(');
    const close = signature.lastIndexOf(')');
    if (open < 0 || close < open || !signature.slice(open - name.length, open).endsWith(name.split('.').pop())) return null;
    const params = signature.slice(open + 1, close).split(',').map((p) => p.trim()).filter((p) => p && p !== 'void' && p !== '...' && !p.startsWith('*'));
    const names = params.map((p) => (p.split('=')[0].trim().split(/[\s*&]+/).pop() || 'arg').replace(/[^\w]/g, ''));
    return `${name}(${names.map((n, i) => `\${${i + 1}:${n}}`).join(', ')})`;
  }

  function find(lang, word) {
    return (BY_LANG[lang] ?? []).find((e) => e[0] === word || e[0].endsWith(`::${word}`) || e[0].endsWith(`.${word}`));
  }

  function aliases(text) {
    const map = {};
    for (const m of text.matchAll(/^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?/gm)) map[m[2] ?? m[1]] = m[1];
    for (const m of text.matchAll(/^\s*from\s+([\w.]+)\s+import\s+(\w+)(?:\s+as\s+(\w+))?/gm)) map[m[3] ?? m[2]] = `${m[1]}.${m[2]}`;
    return map;
  }

  let snippetsOn = true;
  let hintsOn = true;

  function register() {
    for (const lang of Object.keys(MONACO_LANG)) {
      monaco.languages.registerCompletionItemProvider(MONACO_LANG[lang], {
        triggerCharacters: lang === 'python' ? ['.'] : [],
        provideCompletionItems(model, position) {
          const word = model.getWordUntilPosition(position);
          const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
          const before = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: word.startColumn });
          const K = monaco.languages.CompletionItemKind;
          const Rule = monaco.languages.CompletionItemInsertTextRule;

          const member = lang === 'python' ? before.match(/([\w.]+)\.$/) : null;
          if (member) {
            const module = aliases(model.getValue())[member[1]] ?? member[1];
            const list = hintsOn ? MODULES[module] ?? MODULES[module.split('.').pop()] : null;
            if (!list) return { suggestions: [] };
            return {
              suggestions: list.map(([label, signature, doc]) => {
                const isCall = signature.includes('(');
                const snippet = isCall ? paramSnippet(signature, label) : null;
                return {
                  label, kind: isCall ? K.Function : K.Variable, detail: signature, documentation: doc, range,
                  insertText: snippet ?? label, insertTextRules: snippet ? Rule.InsertAsSnippet : undefined,
                };
              }),
            };
          }

          const items = (hintsOn ? BY_LANG[lang] ?? [] : []).map(([label, signature, doc]) => {
            const isFn = signature.includes('(') && !signature.startsWith('template') && !signature.startsWith('class');
            const snippet = isFn ? paramSnippet(signature, label) : null;
            return {
              label, kind: isFn ? K.Function : K.Class, detail: signature, documentation: doc, range,
              insertText: snippet ?? label, insertTextRules: snippet ? Rule.InsertAsSnippet : undefined,
            };
          });
          const snippets = (snippetsOn ? SNIPPETS[lang] ?? [] : []).map(([label, body, doc]) => ({
            label, kind: K.Snippet, detail: doc, documentation: { value: `\`\`\`\n${body.replace(/\$\{\d:?([^}]*)\}/g, '$1').replace(/\$0/g, '')}\n\`\`\`` },
            insertText: body, insertTextRules: Rule.InsertAsSnippet, range, sortText: `0${label}`,
          }));
          return { suggestions: [...snippets, ...items] };
        },
      });

      monaco.languages.registerSignatureHelpProvider(MONACO_LANG[lang], {
        signatureHelpTriggerCharacters: ['(', ','],
        provideSignatureHelp(model, position) {
          const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
          let depth = 0;
          let commas = 0;
          let i = line.length - 1;
          for (; i >= 0; i--) {
            const ch = line[i];
            if (ch === ')') depth++;
            else if (ch === '(') { if (depth === 0) break; depth--; }
            else if (ch === ',' && depth === 0) commas++;
          }
          if (i < 0) return null;
          const name = line.slice(0, i).match(/[\w.:]+$/)?.[0];
          if (!name) return null;
          const entry = find(lang, name) ?? Object.values(MODULES).flat().find((e) => e[1].startsWith(`${name}(`));
          if (!entry) return null;
          const open = entry[1].indexOf('(');
          const close = entry[1].lastIndexOf(')');
          const params = entry[1].slice(open + 1, close).split(',').map((p) => p.trim()).filter(Boolean);
          return {
            value: {
              signatures: [{ label: entry[1], documentation: entry[2], parameters: params.map((label) => ({ label })) }],
              activeSignature: 0,
              activeParameter: Math.min(commas, Math.max(params.length - 1, 0)),
            },
            dispose() {},
          };
        },
      });

      monaco.languages.registerHoverProvider(MONACO_LANG[lang], {
        provideHover(model, position) {
          const word = model.getWordAtPosition(position);
          if (!word) return null;
          const entry = find(lang, word.word);
          if (!entry) return null;
          return {
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            contents: [{ value: `\`\`\`${MONACO_LANG[lang]}\n${entry[1]}\n\`\`\`` }, { value: entry[2] }],
          };
        },
      });
    }
  }

  const configure = (o) => { snippetsOn = o.snippets ?? snippetsOn; hintsOn = o.hints ?? hintsOn; };

  return { register, configure };
})();
