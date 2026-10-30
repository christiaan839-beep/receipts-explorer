// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Ed25519 under the strict profile of VAOS 2.0 section 7.3, in every
// browser Playwright runs: the edge vectors (test/fixtures/ed25519), the
// 17 ed25519-* receipts of the conformance corpus, and RFC 8032 test 1.
// The page's verdict must be the same in every browser, so each case is
// first run through the page's own code here in Node: the key reader
// (parsePublicKeys) refuses a key that is not a canonical encoding of a
// point of order L, check 1 refuses a receipt with no canonical text, and
// check 2 refuses a signature whose R or S the strict rule refuses, each
// before WebCrypto sees it. (a) Through the page, every browser must give
// every case the same refusal or the same verdict and words as Node. (b)
// Every case the page passes on to WebCrypto must get the strict verdict
// from the browser's own WebCrypto. A browser that differed would judge
// receipts differently.
import { readdirSync, readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { fromHex } from "../src/bytes.ts";
import { checkOffline } from "../src/checks.ts";
import { KeyError, parsePublicKeys } from "../src/keys.ts";
import { ed25519SignatureProblem } from "../src/vendor/verifiable-receipts/ed25519-key.ts";
import { fill, statusOf } from "./helpers.ts";

interface Case {
  name: string;
  pem: string;
  receipt: string;
  /** The signature's bytes, as hex; empty when the receipt's signature is not a well-formed v2= one. */
  sig: string;
  /** The canonical text's UTF-8 bytes, as hex. */
  msg: string;
  /** The strict verdict. */
  strict: boolean;
  /** The key reader's message when it refuses the key, which WebCrypto then never sees. */
  keyProblem: string | undefined;
  /** Check 1's verdict on the receipt: anything but passed, and check 2 verifies nothing. */
  format: string;
  /** Check 2's status and words, as the page's code gives them in Node. */
  signature: { status: string; detail: string } | undefined;
}

const STATUS: Record<string, string> = { passed: "Passed", failed: "Failed", "not-run": "Not run" };
const fixtures = new URL("../test/fixtures/", import.meta.url);
const json = (path: string): unknown => JSON.parse(readFileSync(new URL(path, fixtures), "utf8"));

async function pageCase(name: string, pem: string, receipt: { canonical?: unknown; signature: string }, strict: boolean): Promise<Case> {
  let keyProblem: string | undefined;
  let keys: Awaited<ReturnType<typeof parsePublicKeys>> = [];
  try {
    keys = await parsePublicKeys(pem, "The issuer key");
  } catch (e) {
    if (!(e instanceof KeyError)) throw e;
    keyProblem = e.message;
  }
  const report = await checkOffline(receipt, keys);
  const format = report.checks.find((c) => c.id === "format")?.status ?? "missing";
  const sig = report.checks.find((c) => c.id === "signature");
  const body = receipt.signature.startsWith("v2=") ? Buffer.from(receipt.signature.slice(3), "base64").toString("hex") : "";
  return {
    name,
    pem,
    receipt: JSON.stringify(receipt),
    sig: body,
    msg: typeof receipt.canonical === "string" ? Buffer.from(receipt.canonical, "utf8").toString("hex") : "",
    strict,
    keyProblem,
    format,
    signature: keyProblem === undefined && sig !== undefined ? { status: STATUS[sig.status] ?? sig.status, detail: sig.detail } : undefined,
  };
}

/** An edge vector as the page reads it: the message as canonical text, which must be UTF-8. */
function vectorReceipt(v: { msg: string; sig: string }): { canonical: string | undefined; signature: string } {
  let canonical: string | undefined;
  try {
    canonical = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(v.msg, "hex"));
  } catch {
    canonical = undefined;
  }
  return { canonical, signature: `v2=${Buffer.from(v.sig, "hex").toString("base64")}` };
}

const pemOf = (spki: string): string => `-----BEGIN PUBLIC KEY-----\n${spki}\n-----END PUBLIC KEY-----\n`;

const VECTORS = json("ed25519/vectors.json") as { name: string; spki: string; msg: string; sig: string; strict: boolean }[];
const CORPUS = readdirSync(new URL("conformance/", fixtures))
  .filter((f) => f.startsWith("ed25519-") && f.endsWith(".json"))
  .sort()
  .map((f) => ({ f, v: json(`conformance/${f}`) as { publicKeyPem?: string; receipt?: { canonical: string; signature: string }; expected: { ok: boolean } } }))
  .filter(({ v }) => v.receipt !== undefined && v.publicKeyPem !== undefined);

// RFC 8032 section 7.1, test 1: the empty message, which WebKit 27.2 gets
// wrong. The page must refuse it at check 1 in every browser.
const TEST_1 = {
  name: "RFC 8032 test 1 (the empty message)",
  spki: "MCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=",
  msg: "",
  sig: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
  strict: true,
};

const CASES = await Promise.all([
  ...[...VECTORS, TEST_1].map((v) => pageCase(v.name, pemOf(v.spki), vectorReceipt(v), v.strict)),
  ...CORPUS.map(({ f, v }) => pageCase(f, v.publicKeyPem ?? "", v.receipt ?? { signature: "" }, v.expected.ok)),
]);
const REACHING = CASES.filter((c) => c.keyProblem === undefined && c.format === "passed" && ed25519SignatureProblem(fromHex(c.sig)) === null);

test("through the page, every case gets the same refusal or verdict, in the same words, as the page's code gives in Node", async ({ page }) => {
  expect(CASES).toHaveLength(34);
  expect(CASES.filter((c) => c.format !== "passed").map((c) => c.name)).toEqual([TEST_1.name]);
  expect(CASES.filter((c) => c.keyProblem !== undefined).length).toBeGreaterThan(0);
  expect(CASES.filter((c) => c.signature?.detail.includes("(signature R is ") === true).length).toBeGreaterThan(0);
  expect(REACHING.map((c) => c.name)).toEqual(["valid", "ed25519-honest.json"]);
  for (const c of CASES) {
    await test.step(c.name, async () => {
      await page.goto("./");
      await fill(page, c.receipt);
      await page.getByLabel("Issuer's public key").fill(c.pem);
      await page.getByRole("button", { name: "Check" }).click();
      if (c.keyProblem !== undefined) {
        expect(c.strict).toBe(false);
        await expect(page.locator("#problems").getByRole("link")).toHaveText([c.keyProblem]);
        await expect(page.locator(".report")).toHaveCount(0);
        return;
      }
      await expect(page.getByRole("status")).toHaveText(/^Checked 1 receipt: /);
      if (c.format !== "passed") {
        expect([await statusOf(page, "Format"), await statusOf(page, "Signature")]).toEqual(["Failed", "Not run"]);
        return;
      }
      expect(c.signature?.status).toBe(c.strict ? "Passed" : "Failed");
      const check = page.locator(".report .check", { has: page.locator(".check-name", { hasText: /^Signature$/ }) });
      await expect(check.locator(".check-status")).toHaveText(c.signature?.status ?? "");
      await expect(check.locator(".check-detail")).toHaveText(c.signature?.detail ?? "");
    });
  }
});

test("WebCrypto Ed25519 gives the strict verdict on every case the page passes on to it", async ({ page }) => {
  await page.goto("./");
  const got = await page.evaluate(async (cases: { name: string; spki: string; msg: string; sig: string }[]) => {
    const hex = (h: string): Uint8Array<ArrayBuffer> => new Uint8Array((h.match(/../g) ?? []).map((b) => Number.parseInt(b, 16)));
    const b64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
    // A throw is recorded as such, never as "did not verify": every case
    // here reaches WebCrypto in the page, which must answer it.
    const out: Record<string, boolean | "threw"> = {};
    for (const c of cases) {
      try {
        const key = await crypto.subtle.importKey("spki", b64(c.spki), { name: "Ed25519" }, false, ["verify"]);
        out[c.name] = await crypto.subtle.verify({ name: "Ed25519" }, key, hex(c.sig), hex(c.msg));
      } catch {
        out[c.name] = "threw";
      }
    }
    return out;
  }, REACHING.map((c) => ({ name: c.name, spki: c.pem.replace(/-----[A-Z ]+-----|\s/g, ""), msg: c.msg, sig: c.sig })));
  expect(got).toEqual(Object.fromEntries(REACHING.map((c) => [c.name, c.strict])));
});
