// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Edges of the inclusion-proof verifier that the conformance corpus does not
// reach: each of these inputs is accepted by a plausible one-character bug.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { innerHash, leafHash, verifyInclusionProof } from "../src/vendor/verifiable-receipts/transparency.ts";

const a = await leafHash("a");
const b = await leafHash("b");
const c = await leafHash("c");

describe("verifyInclusionProof edges", () => {
  it("rejects a valid proof with an extra path entry", async () => {
    const root = await innerHash(a, b);
    assert.equal(await verifyInclusionProof(a, 0, 2, [b], root), true);
    assert.equal(await verifyInclusionProof(a, 0, 2, [b, c], root), false);
  });

  it("rejects index -1, even in a one-leaf tree whose root is the leaf", async () => {
    assert.equal(await verifyInclusionProof(a, 0, 1, [], a), true);
    assert.equal(await verifyInclusionProof(a, -1, 1, [], a), false);
  });

  it("rejects a one-leaf tree with a non-empty path", async () => {
    assert.equal(await verifyInclusionProof(a, 0, 1, [b], a), false);
  });

  it("rejects a tree size of 2^53, which a double cannot hold exactly", async () => {
    // A path of 53 right-hand siblings proves index 0 in a tree of 2^53 leaves.
    const path = Array.from({ length: 53 }, () => b);
    let root = a;
    for (const sib of path) root = await innerHash(root, sib);
    assert.equal(await verifyInclusionProof(a, 0, 2 ** 53 - 1, path, root), true);
    assert.equal(await verifyInclusionProof(a, 0, 2 ** 53, path, root), false);
  });
});
