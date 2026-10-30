// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Runs the verifiable-receipts conformance corpus (copied into
// test/fixtures/conformance, see its README) through the browser port of
// the verifier: it must give every fixture the verdict, and the reason,
// the three reference verifiers give.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { describe, it } from "node:test";

import { verifyEd25519Strict, verifyV2Receipt } from "../src/vendor/verifiable-receipts/receipt.ts";
import { verifyInclusionProof } from "../src/vendor/verifiable-receipts/transparency.ts";
import { CONFORMANCE, conformanceCase, readJson } from "./helpers.ts";

interface Expected {
  ok: boolean;
  reasonContains?: string;
}

const files = readdirSync(CONFORMANCE).filter((f) => f.endsWith(".json")).sort();

describe("conformance corpus", () => {
  it("holds the 50 fixtures of the source corpus", () => {
    assert.equal(files.length, 50);
    assert.equal(files.filter((f) => f.startsWith("ed25519-")).length, 20);
  });

  // The receipts: v2-*, and the ed25519-* vectors of the strict profile (VAOS 2.0 section 7.3) given as receipts.
  for (const name of files.filter((f) => f.startsWith("v2-") || (f.startsWith("ed25519-") && !("ed25519" in (readJson(CONFORMANCE, f) as object))))) {
    it(`receipt ${name}`, async () => {
      // receiptText: the receipt as text, read by parseReceipt, whose refusal is a rejection with
      // its reason. publicKeyPem: the key to verify with, in place of public-key.pem.
      const c = await conformanceCase(name);
      let result: { ok: boolean; reason?: string };
      try {
        result = await verifyV2Receipt(c.receipt(), c.key.key);
      } catch (e) {
        result = { ok: false, reason: (e as Error).message };
      }
      assert.equal(result.ok, c.expected.ok, result.reason);
      if (c.expected.reasonContains !== undefined) {
        assert.match(result.reason ?? "", new RegExp(c.expected.reasonContains, "i"));
      }
    });
  }

  // The ed25519-* vectors given as one raw signature: verifyEd25519Strict, as the original's harness runs them.
  for (const name of files.filter((f) => f.startsWith("ed25519-") && "ed25519" in (readJson(CONFORMANCE, f) as object))) {
    it(`signature ${name}`, async () => {
      const f = readJson(CONFORMANCE, name) as { ed25519: { publicKey: string; message: string; signature: string }; expected: Expected };
      const hex = (h: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(h, "hex"));
      const result = await verifyEd25519Strict(hex(f.ed25519.publicKey), hex(f.ed25519.message), hex(f.ed25519.signature));
      assert.equal(result.ok, f.expected.ok, result.reason);
      if (f.expected.reasonContains !== undefined) {
        assert.match(result.reason ?? "", new RegExp(f.expected.reasonContains, "i"));
      }
    });
  }

  for (const name of files.filter((f) => f.startsWith("inclusion-"))) {
    it(`inclusion proof ${name}`, async () => {
      const f = readJson(CONFORMANCE, name) as Record<string, unknown> & { expected: Expected };
      assert.equal(await verifyInclusionProof(f.leafHashHex, f.leafIndex, f.treeSize, f.auditPath, f.rootHashHex), f.expected.ok);
    });
  }
});
