// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// The Ed25519 edge vectors (test/fixtures/ed25519): Node's own verify and
// the port's WebCrypto verify must each give the recorded answer.
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { describe, it } from "node:test";

import { ed25519Verify, fromBase64, fromHex } from "../src/bytes.ts";
import { readJson } from "./helpers.ts";

interface Vector {
  name: string;
  spki: string;
  msg: string;
  sig: string;
  node: boolean;
}

const VECTORS = readJson(new URL("./fixtures/ed25519/", import.meta.url), "vectors.json") as Vector[];

describe("Ed25519 edge vectors", () => {
  it("holds the 16 vectors", () => {
    assert.equal(VECTORS.length, 16);
  });
  for (const v of VECTORS) {
    it(v.name, async () => {
      let node: boolean;
      try {
        node = verify(null, Buffer.from(v.msg, "hex"), createPublicKey({ key: Buffer.from(v.spki, "base64"), format: "der", type: "spki" }), Buffer.from(v.sig, "hex"));
      } catch {
        node = false;
      }
      assert.equal(node, v.node, "node:crypto");
      let port: boolean;
      try {
        const key = await crypto.subtle.importKey("spki", fromBase64(v.spki), { name: "Ed25519" }, false, ["verify"]);
        port = await ed25519Verify(key, fromHex(v.sig), fromHex(v.msg));
      } catch {
        port = false;
      }
      assert.equal(port, v.node, "the port");
    });
  }
});
