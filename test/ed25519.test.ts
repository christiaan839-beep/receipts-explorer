// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// The Ed25519 edge vectors (test/fixtures/ed25519), under the strict
// profile of VAOS 2.0 section 7.3. Each records its strict verdict and,
// when refused, the reason. The original verifier's verifyEd25519Strict
// (third_party/verifiable-receipts/verify-v2.mjs) and the port's must give
// both; the page's own path (the key read by ed25519PublicKeyProblem, the
// signature by ed25519Verify) must give the verdict. Only the vectors the
// strict checks pass on to the library are put to the libraries raw:
// node:crypto and WebCrypto must agree with the verdict there. On the
// rest they differ by version and engine (Node.js 24.22.1 refuses
// R = identity, which 22.23.2 accepts), which is why the page refuses
// them first.
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { describe, it } from "node:test";

import { verifyEd25519Strict as original } from "../third_party/verifiable-receipts/verify-v2.mjs";
import { ed25519Verify, fromBase64, fromHex } from "../src/bytes.ts";
import { ed25519PublicKeyProblem, ed25519SignatureProblem } from "../src/vendor/verifiable-receipts/ed25519-key.ts";
import { verifyEd25519Strict } from "../src/vendor/verifiable-receipts/receipt.ts";
import { readJson } from "./helpers.ts";

interface Vector {
  name: string;
  spki: string;
  msg: string;
  sig: string;
  strict: boolean;
  reason?: string;
}

const VECTORS = readJson(new URL("./fixtures/ed25519/", import.meta.url), "vectors.json") as Vector[];
const raw = (v: Vector): Uint8Array<ArrayBuffer> => fromBase64(v.spki).slice(12);

describe("Ed25519 edge vectors", () => {
  it("holds the 16 vectors, one of them passed on to the library", () => {
    assert.equal(VECTORS.length, 16);
    assert.deepEqual(
      VECTORS.filter((v) => ed25519PublicKeyProblem(raw(v)) === null && ed25519SignatureProblem(fromHex(v.sig)) === null).map((v) => v.name),
      ["valid"],
    );
  });
  for (const v of VECTORS) {
    it(v.name, async () => {
      const expected = v.strict ? { ok: true } : { ok: false, reason: v.reason };
      assert.deepEqual(original(raw(v), fromHex(v.msg), fromHex(v.sig)), expected, "the original's verifyEd25519Strict");
      assert.deepEqual(await verifyEd25519Strict(raw(v), fromHex(v.msg), fromHex(v.sig)), expected, "the port's verifyEd25519Strict");

      const keyProblem = ed25519PublicKeyProblem(raw(v));
      let page = false;
      if (keyProblem === null) {
        const key = await crypto.subtle.importKey("spki", fromBase64(v.spki), { name: "Ed25519" }, false, ["verify"]);
        page = await ed25519Verify(key, fromHex(v.sig), fromHex(v.msg));
      }
      assert.equal(page, v.strict, "the page's path");

      if (keyProblem !== null || ed25519SignatureProblem(fromHex(v.sig)) !== null) return;
      const node = verify(null, Buffer.from(v.msg, "hex"), createPublicKey({ key: Buffer.from(v.spki, "base64"), format: "der", type: "spki" }), Buffer.from(v.sig, "hex"));
      assert.equal(node, v.strict, "node:crypto");
      const key = await crypto.subtle.importKey("spki", fromBase64(v.spki), { name: "Ed25519" }, false, ["verify"]);
      assert.equal(await crypto.subtle.verify({ name: "Ed25519" }, key, fromHex(v.sig), fromHex(v.msg)), v.strict, "WebCrypto");
    });
  }
});
