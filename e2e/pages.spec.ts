// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Every page, in light and dark: no axe violations (WCAG 2.2 AA), no
// horizontal scrolling at 320 px, no Content Security Policy violation;
// readable without JavaScript; the script runs only with its own hash.
import { readFileSync } from "node:fs";

import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { HONEST, VALID, fill, stubLog } from "./helpers.ts";

const BASE = "";
const SITEMAP = readFileSync(new URL("../dist/sitemap.xml", import.meta.url), "utf8");
const LISTED = [...SITEMAP.matchAll(/<loc>https:\/\/verify\.sovereignmatrix\.co\.za(\/[^<]*)<\/loc>/g)].map((m) => m[1] ?? "/");
// Every page in the sitemap, and the 404 page, which is not listed in it.
const ROUTES = [...LISTED, "/404.html"];
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function axe(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("the sitemap lists the pages", () => {
  expect(LISTED).toContain("/");
  expect(LISTED).toContain("/terms/receipt/");
  expect(LISTED).not.toContain("/404.html");
  expect(LISTED.length).toBeGreaterThan(20);
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    // One test per page, so each has the whole timeout to itself.
    for (const route of ROUTES) {
      test(`${route} passes axe and has no horizontal scroll at 320 px`, async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await page.goto(`.${route}`);
        await axe(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }

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

interface Watched {
  violations: string[];
  inlineRan?: string[];
}
const violations = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as Watched).violations);
// Let a violation reported by the work just done reach the listener.
const tick = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((r) => setTimeout(r, 0)));

test("no page breaks its Content Security Policy, and script that is not the page's own never runs", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Watched).violations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as Watched).violations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  for (const route of ROUTES) {
    await page.goto(`.${route}`);
    if (route === "/") await expect(page.locator("#check-form")).toBeVisible();
    await tick(page);
    expect(await violations(page), route).toEqual([]);
  }
  // A results render breaks nothing either.
  await stubLog(page, HONEST);
  await page.goto("./");
  await fill(page, VALID, { log: true });
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toHaveText("Checked 1 receipt: 1 valid.");
  await tick(page);
  expect(await violations(page), "after a results render").toEqual([]);

  const got = await page.evaluate(async () => {
    const w = window as unknown as Watched;
    w.inlineRan = [];
    // require-trusted-types-for 'script': script text from a string, or HTML
    // from a string, is refused at the sink.
    const refused = (f: () => void): boolean => {
      try {
        f();
        return false;
      } catch {
        return true;
      }
    };
    const textRefused = refused(() => {
      document.createElement("script").textContent = "window.inlineRan.push('string')";
    });
    const htmlRefused = refused(() => {
      document.createElement("div").innerHTML = "<b>x</b>";
    });
    // Script text from a text node: Trusted Types refuses it before script-src sees it.
    const fromNode = document.createElement("script");
    fromNode.append(document.createTextNode("window.inlineRan.push('text node')"));
    document.body.append(fromNode);
    // Script text from a Trusted Types policy passes Trusted Types, so only
    // script-src 'self' stands between it and running.
    const policy = (window as unknown as { trustedTypes: { createPolicy(n: string, r: { createScript(s: string): string }): { createScript(s: string): string } } }).trustedTypes.createPolicy("t", { createScript: (x) => x });
    const fromPolicy = document.createElement("script");
    fromPolicy.text = policy.createScript("window.inlineRan.push('policy')");
    document.body.append(fromPolicy);
    await new Promise((r) => setTimeout(r, 50));
    return { ran: w.inlineRan, textRefused, htmlRefused };
  });
  expect(got.ran).toEqual([]);
  expect(got.textRefused).toBe(true);
  expect(got.htmlRefused).toBe(true);
  const seen = await violations(page);
  // The listener works (Trusted Types reported), and script-src itself refused the policy's script.
  expect(seen.some((v) => v.startsWith("require-trusted-types-for "))).toBe(true);
  expect(seen.some((v) => v.startsWith("script-src-elem "))).toBe(true);
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
