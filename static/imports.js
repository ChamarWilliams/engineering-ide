const Imports = (() => {
  const C_HEADERS = {
    'stdio.h': 'printf scanf puts fprintf sprintf snprintf fopen fclose fgets fputs fread fwrite getchar putchar perror sscanf fflush stdin stdout stderr FILE',
    'stdlib.h': 'malloc calloc realloc free exit atoi atof atol rand srand qsort abs labs strtol strtod getenv system bsearch EXIT_SUCCESS EXIT_FAILURE',
    'string.h': 'strlen strcpy strncpy strcmp strncmp strcat strncat memcpy memmove memset memcmp strchr strrchr strstr strdup strtok',
    'math.h': 'sqrt pow sin cos tan asin acos atan atan2 floor ceil fabs log log10 exp fmod round trunc cbrt hypot',
    'ctype.h': 'isalpha isdigit isalnum isspace isupper islower toupper tolower ispunct',
    'time.h': 'time clock difftime strftime localtime gmtime CLOCKS_PER_SEC clock_t time_t',
    'assert.h': 'assert',
    'stdint.h': 'int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t intptr_t uintptr_t SIZE_MAX',
    'stdbool.h': 'bool true false',
    'limits.h': 'INT_MAX INT_MIN UINT_MAX LONG_MAX LONG_MIN CHAR_BIT',
    'stddef.h': 'ptrdiff_t offsetof',
  };
  const CPP_HEADERS = {
    iostream: 'cout cin cerr endl', string: 'string getline to_string stoi stod', vector: 'vector', map: 'map multimap', set: 'set multiset',
    unordered_map: 'unordered_map', unordered_set: 'unordered_set', algorithm: 'sort find reverse min max swap count transform for_each',
    memory: 'unique_ptr shared_ptr make_unique make_shared', fstream: 'ifstream ofstream fstream', iomanip: 'setw setprecision fixed', sstream: 'stringstream ostringstream istringstream',
    numeric: 'accumulate iota', functional: 'function bind', cmath: 'sqrt pow sin cos floor ceil', thread: 'thread', mutex: 'mutex lock_guard', optional: 'optional nullopt',
    queue: 'queue priority_queue', stack: 'stack', deque: 'deque', utility: 'pair make_pair move',
  };
  const PY_MODULES = {
    np: 'import numpy as np', pd: 'import pandas as pd', plt: 'import matplotlib.pyplot as plt', sns: 'import seaborn as sns', tf: 'import tensorflow as tf',
    math: 'import math', os: 'import os', sys: 'import sys', re: 'import re', json: 'import json', random: 'import random', time: 'import time',
    datetime: 'import datetime', itertools: 'import itertools', functools: 'import functools', collections: 'import collections', subprocess: 'import subprocess',
    pathlib: 'import pathlib', csv: 'import csv', argparse: 'import argparse', logging: 'import logging', statistics: 'import statistics', heapq: 'import heapq', bisect: 'import bisect',
  };
  const PY_NAMES = {
    Counter: 'from collections import Counter', defaultdict: 'from collections import defaultdict', deque: 'from collections import deque', namedtuple: 'from collections import namedtuple',
    OrderedDict: 'from collections import OrderedDict', Path: 'from pathlib import Path', dataclass: 'from dataclasses import dataclass', field: 'from dataclasses import field',
    List: 'from typing import List', Dict: 'from typing import Dict', Optional: 'from typing import Optional', Tuple: 'from typing import Tuple', Any: 'from typing import Any',
    Callable: 'from typing import Callable', Iterable: 'from typing import Iterable', Enum: 'from enum import Enum', ABC: 'from abc import ABC', abstractmethod: 'from abc import abstractmethod',
    lru_cache: 'from functools import lru_cache', reduce: 'from functools import reduce', partial: 'from functools import partial', datetime_: 'from datetime import datetime',
    sleep: 'from time import sleep', deepcopy: 'from copy import deepcopy',
  };

  const lookup = (table) => new Map(Object.entries(table).flatMap(([header, names]) => names.split(' ').map((n) => [n, header])));
  const C_MAP = lookup(C_HEADERS);
  const CPP_MAP = lookup(CPP_HEADERS);

  function blank(code, language) {
    const strip = (m) => m.replace(/[^\n]/g, ' ');
    if (language === 'python') return code.replace(/#.*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, strip);
    return code.replace(/\/\/.*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, strip);
  }

  const used = (view, name) => new RegExp(`(?<![\\w.$])${name}(?![\\w$])`).test(view);

  function cFamily(language, code) {
    const view = blank(code, language);
    const have = new Set([...code.matchAll(/#\s*include\s*[<"]([^>"]+)[>"]/g)].map((m) => m[1]));
    const usingStd = /using\s+namespace\s+std/.test(view);
    const wanted = new Set();
    const consider = (table, qualified) => {
      for (const [name, header] of table) {
        const hit = qualified
          ? new RegExp(`std\\s*::\\s*${name}\\b`).test(view) || (usingStd && used(view, name))
          : used(view, name);
        if (!hit || new RegExp(`\\b(?:int|char|void|double|float|long|auto|struct|class)\\s+\\*?${name}\\b`).test(view)) continue;
        const alt = header.endsWith('.h') ? `c${header.slice(0, -2)}` : header;
        if (!have.has(header) && !have.has(alt)) wanted.add(header);
      }
    };
    consider(C_MAP, false);
    if (language === 'cpp') consider(CPP_MAP, true);
    if (language === 'c' && !used(view, 'bool')) wanted.delete('stdbool.h');
    return [...wanted].map((h) => ({ text: `#include <${h}>`, why: h }));
  }

  function python(code) {
    const view = blank(code, 'python');
    const defined = (name) => new RegExp(`^\\s*(?:def|class)\\s+${name}\\b|^\\s*${name}\\s*=|\\bas\\s+${name}\\b|\\bimport\\s+[^\\n]*\\b${name}\\b|\\bfor\\s+${name}\\b`, 'm').test(view);
    const out = [];
    for (const [name, line] of Object.entries(PY_MODULES)) {
      if (new RegExp(`(?<![\\w.])${name}\\.`).test(view) && !defined(name) && !view.includes(line)) out.push({ text: line, why: name });
    }
    for (const [name, line] of Object.entries(PY_NAMES)) {
      if (name.endsWith('_')) continue;
      if (used(view, name) && !defined(name) && !view.includes(line)) out.push({ text: line, why: name });
    }
    return out;
  }

  function missing(language, code) {
    if (language === 'c' || language === 'cpp') return cFamily(language, code);
    if (language === 'python') return python(code);
    return [];
  }

  // Line (1-based) after which new import lines belong.
  function insertAfter(language, code) {
    const lines = code.split('\n');
    let last = 0;
    const pattern = language === 'python' ? /^\s*(?:import|from)\s+\S/ : /^\s*#\s*include\b/;
    for (let i = 0; i < Math.min(lines.length, 80); i++) {
      if (pattern.test(lines[i])) last = i + 1;
      else if (language === 'python' && i === 0 && /^#!/.test(lines[i])) last = 1;
    }
    return last;
  }

  function apply(editor, language, found) {
    const model = editor.getModel();
    const after = insertAfter(language, model.getValue());
    const text = found.map((f) => f.text).join('\n') + (after === 0 ? '\n\n' : '\n');
    const at = after === 0 ? new monaco.Range(1, 1, 1, 1) : new monaco.Range(after, model.getLineMaxColumn(after), after, model.getLineMaxColumn(after));
    editor.executeEdits('auto-import', [{ range: at, text: after === 0 ? text : `\n${text.replace(/\n$/, '')}` }]);
  }

  return { missing, apply };
})();
