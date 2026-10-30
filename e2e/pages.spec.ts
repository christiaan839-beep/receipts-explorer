// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Every page, in light and dark: no axe violations (WCAG 2.2 AA), no
// horizontal scrolling at 320 px, no Content Security Policy violation;
// readable without JavaScript; the script runs only with its own hash.
import { readFileSync } from "node:fs";

import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { HONEST, VALID, fill, stubLog } from "./helpers.ts";

const BASE = "/receipts-explorer";
const SITEMAP = readFileSync(new URL("../dist/sitemap.xml", import.meta.url), "utf8");
const ROUTES = [...SITEMAP.matchAll(/<loc>[^<]*?\/receipts-explorer(\/[^<]*)<\/loc>/g)].map((m) => m[1] ?? "/");
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function axe(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("the sitemap lists the pages", () => {
  expect(ROUTES).toContain("/");
  expect(ROUTES).toContain("/terms/receipt/");
  expect(ROUTES.length).toBeGreaterThan(20);
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test("every page passes axe and has no horizontal scroll at 320 px", async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      for (const route of ROUTES) {
        await page.goto(`.${route}`);
        await axe(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, route).toBeLessThanOrEqual(0);
      }
    });

    test("the results pass axe too", async ({ page }) => {
      await stubLog(page, { ...HONEST, "/v1/proof/inclusion": "unreachable" });
      await page.goto("./");
      await fill(page, `[${VALID}, {"canonical": "x"}]`, { log: true });
      await page.getByRole("button", { name: "Check" }).click();
      await expect(page.getByRole("status")).toContainText("Checked 2 receipts");
      await axe(page);
    });
  });
}

test("no page breaks its Content Security Policy, inline script does not run, and script from a string is refused", async ({ page, browserName }) => {
  await page.addInitScript(() => {
    (window as unknown as { violations: string[] }).violations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { violations: string[] }).violations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  for (const route of ROUTES) {
    await page.goto(`.${route}`);
    expect(await page.evaluate(() => (window as unknown as { violations: string[] }).violations), route).toEqual([]);
  }
  const got = await page.evaluate(async () => {
    // A text node, not a string assignment, so the script reaches script-src.
    const s = document.createElement("script");
    s.append(document.createTextNode("window.inlineRan = true"));
    document.body.append(s);
    let assigned = true;
    try {
      document.createElement("script").textContent = "window.inlineRan = true";
    } catch {
      assigned = false;
    }
    await new Promise((r) => setTimeout(r, 50));
    return { ran: (window as unknown as { inlineRan?: boolean }).inlineRan === true, assigned };
  });
  expect(got.ran).toBe(false);
  // require-trusted-types-for 'script': Chromium refuses script text from a string.
  if (browserName === "chromium") expect(got.assigned).toBe(false);
});

test("a changed script is refused by its integrity hash: the form stays hidden, and the page says checking needs JavaScript", async ({ page }) => {
  await page.route(`**${BASE}/static/check.js`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + "\n// changed" });
  });
  await page.goto("./");
  await expect(page.locator("#check-form")).toBeHidden();
  await expect(page.locator("#needs-js")).toBeVisible();
  await expect(page.locator("#framed")).toBeHidden();
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the check page explains itself and says checking needs JavaScript", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check a receipt");
    // A visible note, not <noscript>, which the script hides when it starts:
    // a script that is off, blocked or refused leaves it in place.
    await expect(page.locator("#needs-js")).toHaveText("Checking needs JavaScript, which is off or did not load. The rest of this page explains the checks.");
    await expect(page.locator("#needs-js")).toBeVisible();
    await expect(page.getByRole("heading", { name: "The seven checks" })).toBeVisible();
    await expect(page.locator("#check-form")).toBeHidden();
  });

  test("a term page reads in full", async ({ page }) => {
    await page.goto("./terms/inclusion-proof/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inclusion proof");
    await expect(page.locator(".definition")).toContainText("audit path");
  });
});
