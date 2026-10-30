// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { Page, Request } from "@playwright/test";

const fixtures = new URL("../test/fixtures/", import.meta.url);

export function fixture(path: string): string {
  return readFileSync(new URL(path, fixtures), "utf8");
}

export const VALID = JSON.stringify((JSON.parse(fixture("conformance/v2-valid-001.json")) as { receipt: unknown }).receipt);
export const TAMPERED = JSON.stringify((JSON.parse(fixture("conformance/v2-invalid-tampered.json")) as { receipt: unknown }).receipt);
export const ISSUER = fixture("conformance/public-key.pem");
export const LOG_KEY = fixture("log/log-public-key.pem");
export const WITNESSES = ["log/witness-1.pem", "log/witness-2.pem", "log/witness-3.pem"].map(fixture).join("\n");
export const LOG = "https://log.test";

export type Answer = { status: number; file?: string; body?: string; contentType?: string } | "unreachable";

/** The stubbed log: answers by path (query ignored) from test/fixtures/log, or with the body given, with the CORS header receipts-log sends. */
export async function stubLog(page: Page, routes: Record<string, Answer>): Promise<void> {
  await page.unroute(`${LOG}/**`);
  await page.route(`${LOG}/**`, async (route) => {
    const answer = routes[new URL(route.request().url()).pathname] ?? "unreachable";
    if (answer === "unreachable") {
      await route.abort("connectionrefused");
      return;
    }
    await route.fulfill({
      status: answer.status,
      contentType: answer.contentType ?? "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: answer.body ?? (answer.file === undefined ? "" : fixture(`log/${answer.file}`)),
    });
  });
}

export const HONEST: Record<string, Answer> = {
  "/v1/sth": { status: 200, file: "sth.json" },
  "/v1/proof/inclusion": { status: 200, file: "inclusion.json" },
  "/v1/cosignatures": { status: 200, file: "cosignatures-clean.json" },
};

/** The fingerprint the page shows for a key file in test/fixtures/log. */
export function fingerprint(file: string): string {
  const der = Buffer.from(fixture(`log/${file}`).replace(/-----[A-Z ]+-----|\s/g, ""), "base64");
  return "sha256:" + createHash("sha256").update(der).digest("hex").slice(0, 16);
}

export async function fill(page: Page, receipt: string, opts: { log?: boolean } = {}): Promise<void> {
  await page.getByLabel("Receipt", { exact: true }).fill(receipt);
  await page.getByLabel("Issuer's public key").fill(ISSUER);
  if (opts.log === true) {
    await page.getByText("Also check the transparency log (optional)").click();
    await page.getByLabel("Log address").fill(LOG);
    await page.getByLabel("Log's public key").fill(LOG_KEY);
    await page.getByLabel("Witness public keys").fill(WITNESSES);
  }
}

/** The status shown for one check of one report, such as "Passed". */
export function statusOf(page: Page, check: string, report = 0): Promise<string> {
  return page
    .locator(".report")
    .nth(report)
    .locator(".check", { has: page.locator(".check-name", { hasText: new RegExp(`^${check}$`) }) })
    .locator(".check-status")
    .innerText();
}

export function recordRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", (r) => requests.push(r));
  return requests;
}
