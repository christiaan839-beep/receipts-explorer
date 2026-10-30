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
      await info.attach(`check-${String(width)}-${scheme}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });
  }
}
