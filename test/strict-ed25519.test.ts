// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// The strict Ed25519 profile of VAOS 2.0 section 7.3, through the page's
// own code: the 20 ed25519-* vectors of the conformance corpus (test/
// fixtures/conformance). A key that is not a canonical encoding of a point
// of order L is refused when it is read, in words that quote the
// verifier's reason; a signature whose R is not one is failed by check 2,
// quoting the reason; an S of L or more fails as a signature that does not
// verify. Each refusal comes before WebCrypto sees the key or signature, so
// a WebCrypto stub that says yes to everything changes no verdict.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { describe, it } from "node:test";

import { ed25519Verify, fromHex } from "../src/bytes.ts";
import { checkOffline, type CheckResult, type ReceiptReport } from "../src/checks.ts";
import { KeyError, parsePublicKeys, type PublicKey } from "../src/keys.ts";
import { CONFORMANCE, readJson } from "./helpers.ts";

interface Vector {
  publicKeyPem?: string;
  receipt?: Record<string, unknown>;
  ed25519?: { publicKey: string; message: string; signature: string };
  expected: { ok: boolean; reasonContains?: string };
}

const DOES_NOT_VERIFY = "signature does not verify under the supplied public key";
const NAMES = readdirSync(CONFORMANCE).filter((f) => f.startsWith("ed25519-") && f.endsWith(".json")).sort();
const RECEIPTS = NAMES.filter((n) => (readJson(CONFORMANCE, n) as Vector).receipt !== undefined);

/** A WebCrypto key for the PEM, read without the page's key reader, so check 2 sees the key itself. */
async function rawKey(pem: string): Promise<PublicKey> {
  const der = Buffer.from(pem.replace(/-----[A-Z ]+-----|\s/g, ""), "base64");
  const key = await crypto.subtle.importKey("spki", der, { name: "Ed25519" }, true, ["verify"]);
  return { key, fingerprint: "sha256:" + Buffer.from(await crypto.subtle.digest("SHA-256", der)).toString("hex").slice(0, 16) };
}

/** Check 2's result in a report. */
function signatureOf(report: ReceiptReport): CheckResult {
  const signature = report.checks.find((c) => c.id === "signature");
  assert.ok(signature);
  return signature;
}

/** Runs `body` with a WebCrypto verify that answers true to everything, and counts its calls. */
async function withYesVerify(body: (calls: () => number) => Promise<void>): Promise<void> {
  const original = crypto.subtle.verify.bind(crypto.subtle);
  let calls = 0;
  crypto.subtle.verify = () => {
    calls++;
    return Promise.resolve(true);
  };
  try {
    await body(() => calls);
  } finally {
    crypto.subtle.verify = original;
  }
}

describe("the strict Ed25519 profile, through the page", () => {
  it("has the 20 vectors, 17 of them receipts", () => {
    assert.equal(NAMES.length, 20);
    assert.equal(RECEIPTS.length, 17);
  });

  for (const name of RECEIPTS) {
    const v = readJson(CONFORMANCE, name) as Vector & { publicKeyPem: string; receipt: Record<string, unknown> };
    const reason = v.expected.reasonContains ?? "";

    it(`${name}: the page's verdict and reason`, async () => {
      if (reason.startsWith("public key is ")) {
        await assert.rejects(parsePublicKeys(v.publicKeyPem, "The issuer key"), (e: unknown) => e instanceof KeyError && e.message.includes(`(${reason})`));
        return;
      }
      const keys = await parsePublicKeys(v.publicKeyPem, "The issuer key");
      const signature = signatureOf(await checkOffline(v.receipt, keys));
      if (v.expected.ok) {
        assert.equal(signature.status, "passed", signature.detail);
      } else if (reason === DOES_NOT_VERIFY) {
        assert.equal(signature.status, "failed");
        assert.match(signature.detail, /^This key does not match the signature/);
      } else {
        assert.equal(signature.status, "failed");
        assert.ok(signature.detail.includes(`(${reason})`), signature.detail);
      }
    });

    it(`${name}: no WebCrypto that accepts everything changes the verdict`, async () => {
      // The key is read here without the key reader, so check 2 meets a refused key itself.
      const key = await rawKey(v.publicKeyPem);
      await withYesVerify(async (calls) => {
        const report = await checkOffline(v.receipt, [key]);
        const signature = signatureOf(report);
        assert.equal(signature.status, v.expected.ok ? "passed" : "failed", signature.detail);
        assert.equal(report.valid, v.expected.ok);
        if (reason.startsWith("public key is ") || reason.startsWith("signature R is ")) {
          assert.ok(signature.detail.includes(`(${reason})`), signature.detail);
        }
        if (!v.expected.ok) assert.equal(calls(), 0, "WebCrypto was asked about a refused key or signature");
      });
    });
  }

  it("ed25519Verify refuses a signature with a bad R or S before WebCrypto sees it", async () => {
    for (const name of RECEIPTS) {
      const v = readJson(CONFORMANCE, name) as Vector & { publicKeyPem: string; receipt: { canonical: string; signature: string } };
      const reason = v.expected.reasonContains ?? "";
      if (!(reason.startsWith("signature R is ") || reason === DOES_NOT_VERIFY)) continue;
      const key = await rawKey(v.publicKeyPem);
      const sig = new Uint8Array(Buffer.from(v.receipt.signature.slice(3), "base64"));
      await withYesVerify(async (calls) => {
        assert.equal(await ed25519Verify(key.key, sig, new TextEncoder().encode(v.receipt.canonical)), false, name);
        assert.equal(calls(), 0, name);
      });
    }
  });

  it("ed25519Verify passes an honest signature on to WebCrypto", async () => {
    for (const name of NAMES.filter((n) => (readJson(CONFORMANCE, n) as Vector).ed25519 !== undefined)) {
      const v = (readJson(CONFORMANCE, name) as Vector & { ed25519: { publicKey: string; message: string; signature: string } }).ed25519;
      const key = await crypto.subtle.importKey("raw", fromHex(v.publicKey), { name: "Ed25519" }, false, ["verify"]);
      assert.equal(await ed25519Verify(key, fromHex(v.signature), fromHex(v.message)), true, name);
    }
  });
});
