// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Property tests (fast-check) of the browser port: it gives the same verdict
// and reason as the original verify-v2.mjs (third_party/verifiable-receipts,
// byte-identical to VR_REF) on signed receipts with one or two changes, and
// accepts an inclusion proof only as built. FC_NUM_RUNS raises the number of
// cases per property (default 200).
import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { describe, it } from "node:test";

import fc from "fast-check";

import { jsonEqual, verifyV2Receipt } from "../src/vendor/verifiable-receipts/receipt.ts";
import { innerHash, leafHash, verifyInclusionProof } from "../src/vendor/verifiable-receipts/transparency.ts";
import { jsonEqual as originalEqual, verifyV2Receipt as original } from "../third_party/verifiable-receipts/verify-v2.mjs";
import { makeKey, signReceipt } from "./helpers.ts";
import { body, mutate, mutation, nested } from "./mutations.ts";

const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? "200");
fc.configureGlobal({ numRuns: Number.isSafeInteger(NUM_RUNS) && NUM_RUNS > 0 ? NUM_RUNS : 200 });

const issuer = await makeKey();
const originalKey = createPublicKey(issuer.pem);

describe("the browser port agrees with the original verifier", () => {
  it("same verdict and reason on signed receipts with changes", async () => {
    await fc.assert(
      fc.asyncProperty(body, mutation, mutation, async (b, m1, m2) => {
        const receipt = mutate(mutate(await signReceipt(b, issuer.privateKey), m1), m2);
        assert.deepEqual(await verifyV2Receipt(receipt, issuer.publicKey.key), original(receipt, originalKey));
      }),
    );
  });
});
describe("inclusion proofs", () => {
  /** Builds the RFC 9162 tree over `n` leaves; returns the root and the audit path of `idx`. */
  async function tree(leaves: string[], idx: number): Promise<{ root: string; path: string[] }> {
    if (leaves.length === 1) return { root: leaves[0] ?? "", path: [] };
    let k = 1;
    while (k * 2 < leaves.length) k *= 2;
    const left = leaves.slice(0, k);
    const right = leaves.slice(k);
    const l = await tree(left, idx < k ? idx : 0);
    const r = await tree(right, idx < k ? 0 : idx - k);
    const root = await innerHash(l.root, r.root);
    return idx < k ? { root, path: [...l.path, r.root] } : { root, path: [...r.path, l.root] };
  }

  it("accepts a proof as built, and rejects it with one hash changed or an index out of range", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 40 }), fc.nat(), fc.nat(), async (n, i, j) => {
        const leaves = await Promise.all(Array.from({ length: n }, (_, x) => leafHash(`entry ${String(x)}`)));
        const idx = i % n;
        const { root, path } = await tree(leaves, idx);
        assert.equal(await verifyInclusionProof(leaves[idx], idx, n, path, root), true);
        if (path.length > 0) {
          const bad = [...path];
          const at = j % bad.length;
          bad[at] = await leafHash(`changed ${String(at)}`);
          assert.equal(await verifyInclusionProof(leaves[idx], idx, n, bad, root), false);
        }
        assert.equal(await verifyInclusionProof(leaves[idx], n, n, path, root), false);
        assert.equal(await verifyInclusionProof(leaves[idx], idx + 0.5, n, path, root), false);
      }),
    );
  });
});

describe("weak keys", () => {
  const SMALL_ORDER = [
    "0000000000000000000000000000000000000000000000000000000000000000",
    "0100000000000000000000000000000000000000000000000000000000000000",
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
    "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  ];
  /** A weak key: a small-order point, or y = p + k for k from 0 to 18 (non-canonical), with either sign bit. */
  const weak = fc.tuple(
    fc.oneof(
      fc.constantFrom(...SMALL_ORDER),
      fc.integer({ min: 0, max: 18 }).map((k) => {
        const y = 2n ** 255n - 19n + BigInt(k);
        return Buffer.from(y.toString(16).padStart(64, "0"), "hex").reverse().toString("hex");
      }),
    ),
    fc.boolean(),
  ).map(([hex, sign]) => {
    const raw = Buffer.from(hex, "hex");
    if (sign) raw[31] = (raw[31] ?? 0) | 0x80;
    return Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
  });

  it("the port refuses each weak key with the original's reason", async () => {
    await fc.assert(
      fc.asyncProperty(body, weak, async (b, der) => {
        const receipt = await signReceipt(b, issuer.privateKey);
        const portKey = await crypto.subtle.importKey("spki", der, { name: "Ed25519" }, true, ["verify"]);
        const nodeKey = createPublicKey({ key: der, format: "der", type: "spki" });
        const port = await verifyV2Receipt(receipt, portKey);
        assert.deepEqual(port, original(receipt, nodeKey));
        // Only a receipt too deep is refused before the key is looked at.
        assert.match(port.reason ?? "", /^(public key is (a small-order point|not a canonical encoding)|receipt nesting deeper than 64)$/);
      }),
    );
  });
});

describe("jsonEqual is bounded", () => {
  it("equals nothing nested deeper than 64, as the original, and never overflows the stack", () => {
    for (let n = 60; n <= 70; n++) assert.equal(jsonEqual(nested(n), nested(n)), originalEqual(nested(n), nested(n)), String(n));
    assert.equal(jsonEqual(nested(64), nested(64)), true);
    assert.equal(jsonEqual(nested(65), nested(65)), false);
    assert.equal(jsonEqual(nested(100_000), nested(100_000)), false);
  });
});
