// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// The ESLint rules that keep src/ a browser page that stores nothing, parses
// no HTML, loads no code and talks only to the log: each line below breaks
// one of them, and each must be flagged. The probe is written into src/ so
// that the src/ tsconfig and rules apply to it, and removed afterwards.
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ESLint } from "eslint";

const ROOT = new URL("../", import.meta.url);
const PROBE = new URL(`../src/lint-probe-${String(process.pid)}.ts`, import.meta.url);

const CASES: [string, string][] = [
  ["void globalThis.fetch(s);", "no-restricted-properties"],
  ["void window.fetch(s);", "no-restricted-properties"],
  ["void self.fetch(s);", "no-restricted-properties"],
  ["void fetch(s);", "no-restricted-globals"],
  ["void globalThis.localStorage;", "no-restricted-properties"],
  ["void window.navigator;", "no-restricted-properties"],
  ['window.history.replaceState(null, "", s);', "no-restricted-properties"],
  ["void window.document.cookie;", "no-restricted-properties"],
  ["el.setHTMLUnsafe(s);", "no-restricted-properties"],
  ["void r.createContextualFragment(s);", "no-restricted-properties"],
  ['void new DOMParser().parseFromString(s, "text/html");', "no-restricted-globals"],
  ["void (0, eval)(s);", "no-eval"],
  ["void import(s);", "no-restricted-syntax"],
  ["void new Worker(s);", "no-restricted-globals"],
  ['void caches.open("x");', "no-restricted-globals"],
  ["void open(s);", "no-restricted-globals"],
  ['void new Function("return 1");', "no-new-func"],
  ["void Buffer.from(s);", "no-restricted-globals"],
  ["void process.env;", "no-restricted-globals"],
  ["el.innerHTML = s;", "no-restricted-properties"],
];

describe("the src/ lint rules", () => {
  it("flag every way around them", async () => {
    const body = CASES.map(([line]) => `  ${line}`).join("\n");
    const code = `import { createHash } from "node:crypto";\nimport { readFileSync } from "fs";\n\nexport function probe(el: Element, s: string, r: Range): void {\n${body}\n  void createHash;\n  void readFileSync;\n}\n`;
    writeFileSync(PROBE, code);
    try {
      const [result] = await new ESLint({ cwd: ROOT.pathname }).lintFiles([PROBE.pathname]);
      assert.ok(result);
      const byLine = new Map<number, string[]>();
      for (const m of result.messages) byLine.set(m.line, [...(byLine.get(m.line) ?? []), m.ruleId ?? "parse"]);
      assert.ok(byLine.get(1)?.includes("no-restricted-imports"), "node:crypto");
      assert.ok(byLine.get(2)?.includes("no-restricted-imports"), "fs");
      CASES.forEach(([line, rule], i) => {
        assert.ok(byLine.get(i + 5)?.includes(rule), `${line} not flagged by ${rule}: ${JSON.stringify(byLine.get(i + 5))}`);
      });
    } finally {
      rmSync(PROBE, { force: true });
    }
  });
});
