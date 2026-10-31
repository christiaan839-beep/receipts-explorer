// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// On a phone, a key fingerprint in a result heading ("signed by sha256:…")
// moves to the next line whole: it is never split inside, the punctuation
// after it stays on its line, and the page does not scroll sideways. In
// every engine, at every width from 320 px (the narrowest supported) to
// 430 px, so that a fingerprint lands at the end of a line at some of them,
// 375 px among them.
import { expect, test } from "@playwright/test";

import { HONEST, TAMPERED, VALID, fill, stubLog } from "./helpers.ts";

const WIDTHS = Array.from({ length: 56 }, (_, i) => 320 + 2 * i);

test("a fingerprint in a result heading is never split on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await stubLog(page, HONEST);
  await page.goto("./");
  await fill(page, `[${VALID}, ${TAMPERED}]`, { log: true });
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toHaveText("Checked 2 receipts: 1 valid.");
  const bad: string[] = [];
  let wrapped = 0;
  for (const width of [...WIDTHS, 375]) {
    await page.setViewportSize({ width, height: 800 });
    const got = await page.evaluate(() => {
      const found: { text: string; lines: number; strandedAfter: boolean; first: boolean }[] = [];
      for (const code of document.querySelectorAll(".report h3 code.fingerprint")) {
        const range = document.createRange();
        range.selectNodeContents(code);
        const rects = [...range.getClientRects()];
        // One line box: a fingerprint split across lines has rects at two heights.
        const lines = new Set(rects.map((r) => Math.round(r.top))).size;
        // The punctuation after it is on the line where it ends: the boxes
        // overlap vertically (code's font sits at another height on the line).
        let strandedAfter = false;
        const next = code.nextSibling;
        const last = rects.at(-1);
        if (next instanceof Text && next.data.length > 0 && !next.data.startsWith(" ")) {
          const after = document.createRange();
          after.setStart(next, 0);
          after.setEnd(next, 1);
          const box = after.getBoundingClientRect();
          strandedAfter = last === undefined || !(last.top < box.bottom && box.top < last.bottom);
        }
        // Whether the fingerprint begins its line: the heading's text before it ends on a line above.
        const h3 = code.closest("h3");
        const first = h3 !== null && last !== undefined && h3.getBoundingClientRect().top + 1 < last.top;
        found.push({ text: code.textContent, lines, strandedAfter, first });
      }
      return {
        found,
        spans: document.querySelectorAll(".report h3 span.hash").length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(got.found.length).toBeGreaterThan(0);
    for (const f of got.found) {
      if (!/^sha256:[0-9a-f]{16}$/.test(f.text) || f.lines !== 1 || f.strandedAfter) bad.push(`${String(width)} px: ${f.text}`);
      if (f.first) wrapped++;
    }
    expect(got.spans, `${String(width)} px`).toBe(0);
    expect(got.overflow, `${String(width)} px`).toBeLessThanOrEqual(0);
  }
  expect(bad).toEqual([]);
  // The widths did put a fingerprint on a line of its own somewhere, so the test saw the case it is about.
  expect(wrapped).toBeGreaterThan(0);
});
