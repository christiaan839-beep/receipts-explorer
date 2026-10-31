// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Screenshots of the check page, with results, at 320, 375, 768 and 1440 px in
// light and dark, attached to the report for review. Each must fit its
// width without horizontal scrolling.
import { expect, test } from "@playwright/test";

import { HONEST, TAMPERED, VALID, fill, stubLog } from "./helpers.ts";

for (const scheme of ["light", "dark"] as const) {
  for (const width of [320, 375, 768, 1440]) {
    test(`check page at ${String(width)} px, ${scheme}`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await stubLog(page, HONEST);
      await page.goto("./");
      await fill(page, `[${VALID}, ${TAMPERED}]`, { log: true });
      await page.getByRole("button", { name: "Check" }).click();
      await expect(page.getByRole("status")).toHaveText("Checked 2 receipts: 1 valid.");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      // A key fingerprint in a verdict never breaks inside itself
      // (e2e/fingerprint.spec.ts), and the punctuation after it stays on its line.
      const stranded = await page.evaluate(() => {
        const found: string[] = [];
        const bad: string[] = [];
        for (const h3 of document.querySelectorAll(".report h3")) {
          const walker = document.createTreeWalker(h3, NodeFilter.SHOW_TEXT);
          const chars: { node: Text; at: number }[] = [];
          for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
            const t = n as Text;
            for (let i = 0; i < t.data.length; i++) chars.push({ node: t, at: i });
          }
          const text = chars.map((c) => c.node.data[c.at]).join("");
          const box = (i: number): DOMRect | undefined => {
            const c = chars[i];
            if (c === undefined) return undefined;
            const r = document.createRange();
            r.setStart(c.node, c.at);
            r.setEnd(c.node, c.at + 1);
            return r.getBoundingClientRect();
          };
          // Two characters are on one line when their boxes overlap
          // vertically: the fingerprint is in code, whose font sits at
          // another height on the line than the text around it.
          const oneLine = (i: number, j: number): boolean => {
            const a = box(i);
            const b = box(j);
            return a !== undefined && b !== undefined && a.top < b.bottom && b.top < a.bottom;
          };
          for (const m of text.matchAll(/sha256:[0-9a-f]+/g)) {
            const end = m.index + m[0].length;
            if (end >= text.length || text[end] === " ") continue;
            found.push(m[0]);
            if (!oneLine(end - 1, end)) bad.push(`${m[0]}${text[end] ?? ""}`);
          }
        }
        return { found, bad };
      });
      expect(stranded.found.length).toBeGreaterThan(0);
      expect(stranded.bad).toEqual([]);
      await info.attach(`check-${String(width)}-${scheme}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });
  }
}
