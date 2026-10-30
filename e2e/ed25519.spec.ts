// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// The Ed25519 edge vectors (test/fixtures/ed25519), and RFC 8032 test 1,
// in every browser Playwright runs. The page's verdict must be the same in every browser, so
// the vectors are split by the page's own code, run here in Node first: the
// key reader (parsePublicKeys) refuses some keys before WebCrypto sees them,
// check 1 refuses a receipt with no canonical text before check 2
// verifies anything, and ed25519Verify answers false for an S of L or more
// (sBelowOrder) without asking WebCrypto. (a) Through the page, every browser must refuse those
// in the same words, and give every other vector Node's verdict. (b) Every
// vector that reaches WebCrypto must get Node's answer from the browser's
// own WebCrypto. A browser that differed would judge receipts differently.
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { fromHex, sBelowOrder } from "../src/bytes.ts";
import { checkOffline } from "../src/checks.ts";
import { KeyError, parsePublicKeys } from "../src/keys.ts";
import { fill, statusOf } from "./helpers.ts";

interface Vector {
  name: string;
  spki: string;
  msg: string;
  sig: string;
  node: boolean;
}

interface Case extends Vector {
  pem: string;
  receipt: string;
  /** The key reader's message when it refuses the key, which WebCrypto then never sees. */
  keyProblem: string | undefined;
  /** Check 1's verdict on the receipt: anything but passed, and check 2 verifies nothing. */
  format: string;
}

const VECTORS = JSON.parse(readFileSync(new URL("../test/fixtures/ed25519/vectors.json", import.meta.url), "utf8")) as Vector[];

async function pageCase(v: Vector): Promise<Case> {
  const pem = `-----BEGIN PUBLIC KEY-----\n${v.spki}\n-----END PUBLIC KEY-----\n`;
  let keyProblem: string | undefined;
  try {
    await parsePublicKeys(pem, "The issuer key");
  } catch (e) {
    if (!(e instanceof KeyError)) throw e;
    keyProblem = e.message;
  }
  // The page verifies the UTF-8 bytes of the canonical text: a message that
  // is not UTF-8 cannot be one, and is given as no canonical text.
  let canonical: string | undefined;
  try {
    canonical = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(v.msg, "hex"));
  } catch {
    canonical = undefined;
  }
  const receipt = { canonical, signature: `v2=${Buffer.from(v.sig, "hex").toString("base64")}` };
  const format = (await checkOffline(receipt, [])).checks.find((c) => c.id === "format")?.status ?? "missing";
  return { ...v, pem, receipt: JSON.stringify(receipt), keyProblem, format };
}

// RFC 8032 section 7.1, test 1: the empty message, which WebKit 27.2 gets
// wrong. Node verifies it; the page must refuse it at check 1 in every browser.
const TEST_1: Vector = {
  name: "RFC 8032 test 1 (the empty message)",
  spki: "MCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=",
  msg: "",
  sig: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
  node: true,
};

const CASES = await Promise.all([...VECTORS, TEST_1].map(pageCase));
const REACHING = CASES.filter((c) => c.keyProblem === undefined && c.format === "passed" && sBelowOrder(fromHex(c.sig)));

test("through the page, every edge vector gets Node's verdict: refused keys and receipts in the page's own words, the rest verified", async ({ page }) => {
  expect(CASES).toHaveLength(17);
  expect(CASES.filter((c) => c.format !== "passed").map((c) => c.name)).toEqual([TEST_1.name]);
  expect(REACHING.length).toBeGreaterThan(0);
  expect(REACHING.length).toBeLessThan(CASES.length);
  for (const c of CASES) {
    await test.step(c.name, async () => {
      await page.goto("./");
      await fill(page, c.receipt);
      await page.getByLabel("Issuer's public key").fill(c.pem);
      await page.getByRole("button", { name: "Check" }).click();
      if (c.keyProblem !== undefined) {
        await expect(page.locator("#problems").getByRole("link")).toHaveText([c.keyProblem]);
        await expect(page.locator(".report")).toHaveCount(0);
        return;
      }
      await expect(page.getByRole("status")).toHaveText(/^Checked 1 receipt: /);
      if (c.format !== "passed") {
        expect([await statusOf(page, "Format"), await statusOf(page, "Signature")]).toEqual(["Failed", "Not run"]);
        return;
      }
      expect(await statusOf(page, "Signature")).toBe(c.node ? "Passed" : "Failed");
    });
  }
});

test("WebCrypto Ed25519 agrees with Node on every edge vector that reaches it", async ({ page }) => {
  await page.goto("./");
  const got = await page.evaluate(async (vectors: Vector[]) => {
    const hex = (h: string): Uint8Array<ArrayBuffer> => new Uint8Array((h.match(/../g) ?? []).map((b) => Number.parseInt(b, 16)));
    const b64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
    // A throw is recorded as such, never as "did not verify": every vector
    // here reaches WebCrypto in the page, which must answer it.
    const out: Record<string, boolean | "threw"> = {};
    for (const v of vectors) {
      try {
        const key = await crypto.subtle.importKey("spki", b64(v.spki), { name: "Ed25519" }, false, ["verify"]);
        out[v.name] = await crypto.subtle.verify({ name: "Ed25519" }, key, hex(v.sig), hex(v.msg));
      } catch {
        out[v.name] = "threw";
      }
    }
    return out;
  }, REACHING.map(({ name, spki, msg, sig, node }) => ({ name, spki, msg, sig, node })));
  expect(got).toEqual(Object.fromEntries(REACHING.map((v) => [v.name, v.node])));
});
