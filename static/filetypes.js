const FILE_TYPES = (() => {
  const t = (label, ext, monaco, badge, color, group, template, exts = [ext]) => ({ label, ext, monaco, badge, color, group, template, exts, runnable: false, flowable: false });
  const code = (type) => ({ ...type, runnable: true, flowable: true });
  const types = {
    javascript: t('JavaScript', 'js', 'javascript', 'JS', '#c9a227', 'Web', `function average(values) {
  const total = values.reduce((sum, v) => sum + v, 0);
  return values.length ? total / values.length : 0;
}

function describe(values) {
  return 'n=' + values.length + ' mean=' + average(values).toFixed(2);
}

console.log(describe([4, 8, 15, 16, 23, 42]));
`, ['js', 'mjs', 'cjs']),
    typescript: t('TypeScript', 'ts', 'typescript', 'TS', '#3178c6', 'Web', `interface Reading {
  id: number;
  value: number;
}

function total(items: Reading[]): number {
  return items.reduce((sum, r) => sum + r.value, 0);
}

function report(items: Reading[]): string {
  return items.length + ' readings, total ' + total(items);
}

console.log(report([{ id: 1, value: 4 }, { id: 2, value: 8 }]));
`, ['ts', 'mts', 'cts']),
    html: t('HTML', 'html', 'html', 'HTML', '#d6572b', 'Web', `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Document</title>
</head>
<body>
  <h1>Hello</h1>
</body>
</html>
`, ['html', 'htm']),
    css: t('CSS', 'css', 'css', 'CSS', '#2f7fd1', 'Web', `:root {
  --accent: #3574f0;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
}
`),
    json: t('JSON', 'json', 'json', '{}', '#7a8b3d', 'Data and docs', `{
  "name": "example",
  "version": "1.0.0"
}
`),
    yaml: t('YAML', 'yaml', 'yaml', 'YML', '#a44a8f', 'Data and docs', `name: example
steps:
  - run: echo hello
`, ['yaml', 'yml']),
    sql: t('SQL', 'sql', 'sql', 'SQL', '#c26a1b', 'Data and docs', `SELECT id, name
FROM users
WHERE active = TRUE
ORDER BY name;
`),
    markdown: t('Markdown', 'md', 'markdown', 'MD', '#5b6ee1', 'Data and docs', `# Title

Write something here.

- one
- two
`, ['md', 'markdown']),
    shell: t('Shell', 'sh', 'shell', 'SH', '#4a9a5b', 'Scripts', `#!/usr/bin/env bash
set -euo pipefail

greet() {
  echo "hello, $1"
}

shout() {
  greet "$(echo "$1" | tr a-z A-Z)"
}

shout "world"
`, ['sh', 'bash', 'zsh']),
    java: t('Java', 'java', 'java', 'JV', '#b0502d', 'Other languages', `public class Main {
    static int square(int n) {
        return n * n;
    }

    static int sumOfSquares(int[] values) {
        int total = 0;
        for (int v : values) total += square(v);
        return total;
    }

    public static void main(String[] args) {
        System.out.println(sumOfSquares(new int[] {4, 8, 15}));
    }
}
`),
    go: t('Go', 'go', 'go', 'GO', '#2aa5c4', 'Other languages', `package main

import "fmt"

func square(n int) int {
	return n * n
}

func sumOfSquares(values []int) int {
	total := 0
	for _, v := range values {
		total += square(v)
	}
	return total
}

func main() {
	fmt.Println(sumOfSquares([]int{4, 8, 15}))
}
`),
    rust: t('Rust', 'rs', 'rust', 'RS', '#b7410e', 'Other languages', `fn square(n: i64) -> i64 {
    n * n
}

fn sum_of_squares(values: &[i64]) -> i64 {
    values.iter().map(|v| square(*v)).sum()
}

fn main() {
    println!("{}", sum_of_squares(&[4, 8, 15]));
}
`),
    http: { ...t('HTTP requests', 'http', 'plaintext', 'HTTP', '#2b8a6e', 'Scripts', `### List sessions
GET /api/sessions

### Create a session
POST /api/sessions
Content-Type: application/json

{"title": "demo", "language": "python", "code": "print(1)"}
`, ['http', 'rest']), runnable: true },
    text: t('Plain text', 'txt', 'plaintext', 'TXT', '#7a7f87', 'Data and docs', '', ['txt', 'text', 'log']),
    xml: t('XML', 'xml', 'xml', 'XML', '#b5651d', 'Data and docs', '', ['xml']),
    properties: t('Properties', 'properties', 'ini', 'CFG', '#6a8759', 'Data and docs', '', ['properties']),
    toml: t('TOML', 'toml', 'ini', 'TML', '#9c4221', 'Data and docs', '', ['toml']),
  };
  for (const key of ['javascript', 'typescript', 'shell', 'java', 'go', 'rust']) types[key] = code(types[key]);
  return types;
})();

const TYPE_META = {
  c: { group: 'Run and flow', exts: ['c', 'h'], runnable: true, flowable: true },
  cpp: { group: 'Run and flow', exts: ['cpp', 'cc', 'cxx', 'hpp'], runnable: true, flowable: true },
  lua: { group: 'Run and flow', exts: ['lua'], runnable: true, flowable: true },
  python: { group: 'Run and flow', exts: ['py'], runnable: true, flowable: true },
};
