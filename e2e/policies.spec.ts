// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// The docs and policies, in every engine: security.txt is served, parses as
// RFC 9116 says and has not expired; every link inside the site resolves;
// no page but the check page, when given a log, asks any other host for
// anything; the docs read in full without JavaScript; and the footer is
// reached and followed with the keyboard. axe runs on each page in
// pages.spec.ts, which reads them from the sitemap.
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

const SITEMAP = readFileSync(new URL("../dist/sitemap.xml", import.meta.url), "utf8");
const ROUTES = [...SITEMAP.matchAll(/<loc>https:\/\/verify\.sovereignmatrix\.co\.za(\/[^<]*)<\/loc>/g)].map((m) => m[1] ?? "/");
const NEW = ["/docs/", "/docs/quickstart/", "/keys/", "/privacy/", "/terms/", "/security/"];

test("security.txt is served as text, parses as RFC 9116 says, and has not expired", async ({ request }) => {
  const response = await request.get("./.well-known/security.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("text/plain; charset=utf-8");
  const text = await response.text();
  expect(text.endsWith("\n")).toBe(true);
  const fields = new Map<string, string[]>();
  for (const line of text.split("\n").filter((l) => l !== "" && !l.startsWith("#"))) {
    const m = /^([A-Za-z0-9-]+): (\S.*)$/.exec(line);
    expect(m, line).not.toBeNull();
    if (m?.[1] === undefined || m[2] === undefined) continue;
    const name = m[1].toLowerCase();
    fields.set(name, [...(fields.get(name) ?? []), m[2]]);
  }
  expect(fields.get("contact")?.length).toBe(2);
  expect(fields.get("expires")?.length).toBe(1);
  const expires = Date.parse(fields.get("expires")?.[0] ?? "");
  expect(expires).toBeGreaterThan(Date.now());
  expect(fields.get("canonical")).toEqual(["https://verify.sovereignmatrix.co.za/.well-known/security.txt"]);
  expect(fields.get("preferred-languages")).toEqual(["en"]);
  const policy = new URL(fields.get("policy")?.[0] ?? "");
  expect(ROUTES).toContain(policy.pathname);
});

test("every link inside the site resolves", async ({ page, request }) => {
  const seen = new Set<string>();
  for (const route of [...ROUTES, "/404.html"]) {
    await page.goto(`.${route}`);
    const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    for (const href of hrefs) {
      const url = new URL(href);
      if (url.origin !== new URL(page.url()).origin) continue;
      url.hash = "";
      seen.add(url.pathname);
    }
    // Fragment links name an element on their own page.
    const fragments = await page.locator('a[href^="#"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")?.slice(1) ?? ""));
    for (const id of fragments) expect(await page.locator(`[id="${id}"]`).count(), `${route}#${id}`).toBe(1);
  }
  expect(seen.size).toBeGreaterThan(30);
  for (const path of seen) {
    const response = await request.get(`.${path}`, { maxRedirects: 0 });
    expect(response.status(), path).toBe(200);
  }
});

for (const route of NEW) {
  test(`${route} asks no host but this site for anything, and loads no script`, async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(`.${route}`, { waitUntil: "load" });
    const origin = new URL(page.url()).origin;
    expect(requests.filter((u) => new URL(u).origin !== origin)).toEqual([]);
    expect(requests.filter((u) => u.endsWith(".js"))).toEqual([]);
  });
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  for (const route of NEW) {
    test(`${route} reads in full`, async ({ page }) => {
      await page.goto(`.${route}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("main h2").first()).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Footer" })).toBeVisible();
    });
  }
});

test("the footer's Privacy link is reached and followed with the keyboard", async ({ page, browserName }) => {
  // WebKit on macOS moves focus to links with Tab only when that preference is on; Option+Tab always does.
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await page.goto("./docs/");
  const privacy = page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Privacy" });
  for (let i = 0; i < 200; i++) {
    await page.keyboard.press(tab);
    if (await privacy.evaluate((a) => a === document.activeElement)) break;
  }
  await expect(privacy).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/privacy\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy policy");
});
