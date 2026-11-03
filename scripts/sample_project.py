"""Creates a small three-file C project in the running IDE (default http://localhost:8000)."""
import json
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
FOLDER = "calc"

FILES = {
    "mathops": r'''#include <stddef.h>

int add(int a, int b) {
    return a + b;
}

long square_sum(const int *values, size_t n) {
    long total = 0;
    for (size_t i = 0; i < n; i++) total += (long)values[i] * values[i];
    return total;
}

double average(const int *values, size_t n) {
    long total = 0;
    for (size_t i = 0; i < n; i++) total += values[i];
    return n ? (double)total / n : 0.0;
}
''',
    "buffer": r'''#include <stdio.h>
#include <stdlib.h>
#include <string.h>

char *make_label(const char *name, int id) {
    char *out = malloc(strlen(name) + 16);
    sprintf(out, "%s-%d", name, id);
    return out;
}

size_t label_len(const char *label) {
    return strlen(label);
}

void release(char *label) {
    free(label);
}
''',
    "main": r'''#include <stdio.h>
#include "mathops.h"
#include "buffer.h"

int main(void) {
    int readings[] = {4, 8, 15, 16, 23, 42};
    size_t n = sizeof readings / sizeof readings[0];

    int total = add(readings[0], readings[1]);
    long energy = square_sum(readings, n);
    double mean = average(readings, n);

    char *label = make_label("sensor", total);
    size_t len = label_len(label);
    printf("%s (%zu chars): sum=%ld mean=%.2f\n", label, len, energy, mean);
    release(label);
    return 0;
}
''',
}


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read() or b"null")


call("POST", "/api/folders", {"path": FOLDER})
for title, code in FILES.items():
    row = call("POST", "/api/sessions", {"title": title, "language": "c", "code": code, "folder": FOLDER})
    print(title, row["id"])
