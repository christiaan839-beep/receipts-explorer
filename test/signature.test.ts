// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseV2Signature, verifyV2Text } from "../src/signature.ts";
import { LOG, WELL_FORMED_V3, keyFrom, readJson } from "./helpers.ts";

const SCHEMA_EXAMPLES = new URL("./fixtures/schemas/", import.meta.url);
const cosignature = readJson(SCHEMA_EXAMPLES, "cosignature.json") as { sthCanonical: string; signature: string };
const sth = readJson(LOG, "sth.json") as { canonical: string; signature: string };

/** "v2=" and the base64 of `n` zero bytes. */
const v2Of = (n: number): string => "v2=" + Buffer.alloc(n).toString("base64");

describe("v2= signatures", () => {
  it("reads the schema example's signature as well formed, but it is not over its text", async () => {
    assert.equal(parseV2Signature(cosignature.signature).ok, true);
    const w1 = await keyFrom(LOG, "witness-1.pem");
    assert.equal(await verifyV2Text(cosignature.signature, cosignature.sthCanonical, w1), false);
  });

  it("verifies the stub log's tree head under its key, and not under another", async () => {
    assert.equal(await verifyV2Text(sth.signature, sth.canonical, await keyFrom(LOG, "log-public-key.pem")), true);
    assert.equal(await verifyV2Text(sth.signature, sth.canonical, await keyFrom(LOG, "other-public-key.pem")), false);
  });

  it("reads 64 bytes as well formed", () => {
    const parsed = parseV2Signature(v2Of(64));
    assert.ok(parsed.ok);
    assert.equal(parsed.bytes.length, 64);
  });

  for (const [name, value, problem] of [
    ["nothing", undefined, "missing"],
    ["an empty string", "", "missing"],
    ["a v3= signature", WELL_FORMED_V3, "v3"],
    ["a v3= prefix on something that is not a v3= signature", "v3=AAAA.BBBB", "not-v2"],
    ["a v3= signature one character short", WELL_FORMED_V3.slice(0, -1), "not-v2"],
    ["another prefix", "v1=AAAA", "not-v2"],
    ["URL-safe base64", "v2=-_-_", "bad-base64"],
    ["a line break", "v2=AAAA\nAAAA", "bad-base64"],
    ["non-zero padding bits", "v2=AB==", "not-canonical"],
    ["no bytes after v2=", "v2=", "bad-length"],
    ["63 bytes", v2Of(63), "bad-length"],
    ["65 bytes", v2Of(65), "bad-length"],
  ] as const) {
    it(`names the problem with ${name}`, () => {
      assert.deepEqual(parseV2Signature(value), { ok: false, problem });
    });
  }
});
