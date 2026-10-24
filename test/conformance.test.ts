// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Runs the verifiable-receipts conformance corpus (copied into
// test/fixtures/conformance, see its README) through the browser port of
// the verifier: it must give every fixture the verdict, and the reason,
// the three reference verifiers give.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { describe, it } from "node:test";

import { verifyV2Receipt } from "../src/vendor/verifiable-receipts/receipt.ts";
import { verifyInclusionProof } from "../src/vendor/verifiable-receipts/transparency.ts";
import { CONFORMANCE, conformanceCase, readJson } from "./helpers.ts";

interface Expected {
  ok: boolean;
  reasonContains?: string;
}

const files = readdirSync(CONFORMANCE).filter((f) => f.endsWith(".json")).sort();

describe("conformance corpus", () => {
  it("holds the 30 fixtures of the source corpus", () => {
    assert.equal(files.length, 30);
  });

  for (const name of files.filter((f) => f.startsWith("v2-"))) {
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

  for (const name of files.filter((f) => f.startsWith("inclusion-"))) {
    it(`inclusion proof ${name}`, async () => {
      const f = readJson(CONFORMANCE, name) as Record<string, unknown> & { expected: Expected };
      assert.equal(await verifyInclusionProof(f.leafHashHex, f.leafIndex, f.treeSize, f.auditPath, f.rootHashHex), f.expected.ok);
    });
  }
});
