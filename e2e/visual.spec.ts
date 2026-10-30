// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Screenshots of the check page, with results, at 320, 768 and 1440 px in
// light and dark, attached to the report for review. Each must fit its
// width without horizontal scrolling.
import { expect, test } from "@playwright/test";

import { HONEST, TAMPERED, VALID, fill, stubLog } from "./helpers.ts";

for (const scheme of ["light", "dark"] as const) {
  for (const width of [320, 768, 1440]) {
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
      // A key fingerprint in a verdict may break inside itself, but the
      // punctuation after it stays on the line where the fingerprint ends.
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
          const top = (i: number): number => {
            const c = chars[i];
            if (c === undefined) return Number.NaN;
            const r = document.createRange();
            r.setStart(c.node, c.at);
            r.setEnd(c.node, c.at + 1);
            return r.getBoundingClientRect().top;
          };
          for (const m of text.matchAll(/sha256:[0-9a-f]+/g)) {
            const end = m.index + m[0].length;
            if (end >= text.length || text[end] === " ") continue;
            found.push(m[0]);
            if (Math.abs(top(end - 1) - top(end)) > 1) bad.push(`${m[0]}${text[end] ?? ""}`);
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
