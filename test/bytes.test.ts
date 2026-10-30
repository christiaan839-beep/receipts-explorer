// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Ed25519Unavailable, ed25519Verify, fromBase64, fromHex, toBase64, toHex, utf8 } from "../src/bytes.ts";
import { DOES_NOT_VERIFY, ed25519SignatureProblem } from "../src/vendor/verifiable-receipts/ed25519-key.ts";

describe("fromHex", () => {
  it("decodes hex in either case", () => {
    assert.equal(toHex(fromHex("00ffAb")), "00ffab");
    assert.equal(fromHex("").length, 0);
  });
  for (const bad of ["zz", "abc", "ab cd", "ab\n", "0x00", "+1"]) {
    it(`throws on ${JSON.stringify(bad)}`, () => {
      assert.throws(() => fromHex(bad), TypeError);
    });
  }
});

describe("fromBase64", () => {
  it("decodes the one spelling of some bytes", () => {
    assert.equal(toHex(fromBase64("AAEC")), "000102");
    assert.equal(toBase64(fromBase64("AQ==")), "AQ==");
  });
  for (const [name, bad] of [
    ["a line break", "AAAA\nAAAA"],
    ["a space", "AA AA"],
    ["missing padding", "AQ"],
    ["extra padding", "AQ==="],
    ["padding in the middle", "AQ==AAAA"],
    ["the URL-safe alphabet", "-_-_"],
    ["non-zero padding bits", "AR=="],
  ] as const) {
    it(`throws on ${name}`, () => {
      assert.throws(() => fromBase64(bad), TypeError);
    });
  }
});

describe("utf8", () => {
  it("encodes beyond ASCII, and a lone surrogate as U+FFFD", () => {
    assert.equal(toHex(utf8("é€😀")), "c3a9e282acf09f9880");
    assert.equal(toHex(utf8("\ud800")), "efbfbd");
  });
});

describe("ed25519Verify", () => {
  // RFC 8032 section 7.1, test 1.
  const PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
  const SIG = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";

  it("verifies RFC 8032 test 1, and not a changed signature", async () => {
    const key = await crypto.subtle.importKey("raw", fromHex(PUBLIC), { name: "Ed25519" }, false, ["verify"]);
    assert.equal(await ed25519Verify(key, fromHex(SIG), new Uint8Array(0)), true);
    assert.equal(await ed25519Verify(key, fromHex("f" + SIG.slice(1)), new Uint8Array(0)), false);
    assert.equal(await ed25519Verify(key, fromHex(SIG.slice(2)), new Uint8Array(0)), false);
  });

  it("answers false, not true, when WebCrypto refuses a key of another kind", async () => {
    const { publicKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    assert.equal(await ed25519Verify(publicKey, fromHex(SIG), new Uint8Array(0)), false);
  });

  // L, the group order, as 32 little-endian bytes in hex.
  const L = "edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010";
  const leAdd = (a: string, b: string): string => {
    const x = fromHex(a);
    const y = fromHex(b);
    const out = new Uint8Array(32);
    let carry = 0;
    for (let i = 0; i < 32; i++) {
      const t = (x[i] ?? 0) + (y[i] ?? 0) + carry;
      out[i] = t & 0xff;
      carry = t >> 8;
    }
    return toHex(out);
  };
  const R = SIG.slice(0, 64);
  const S = SIG.slice(64);

  it("refuses an S of L or more, and nothing below it, with RFC 8032 test 1's R", () => {
    const sProblem = (s: string): string | null => ed25519SignatureProblem(fromHex(R + s));
    assert.equal(ed25519SignatureProblem(fromHex(SIG)), null);
    assert.equal(sProblem("ecd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010"), null, "L - 1");
    assert.equal(sProblem("0".repeat(64)), null, "0");
    assert.equal(sProblem(L), DOES_NOT_VERIFY, "L");
    assert.equal(sProblem("eed3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010"), DOES_NOT_VERIFY, "L + 1");
    assert.equal(sProblem(leAdd(S, L)), DOES_NOT_VERIFY, "S + L");
    assert.equal(sProblem("edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000011"), DOES_NOT_VERIFY, "a higher top byte");
    assert.equal(sProblem("f".repeat(64)), DOES_NOT_VERIFY, "2^256 - 1");
    assert.equal(ed25519SignatureProblem(fromHex(SIG.slice(2))), DOES_NOT_VERIFY, "63 bytes");
  });

  it("answers false for S of L or more before WebCrypto sees it, even a WebCrypto that would accept it", async () => {
    // WebKit on Linux accepts S + L; a stub that says yes to everything stands in for it.
    const key = await crypto.subtle.importKey("raw", fromHex(PUBLIC), { name: "Ed25519" }, false, ["verify"]);
    const original = crypto.subtle.verify.bind(crypto.subtle);
    let calls = 0;
    crypto.subtle.verify = () => {
      calls++;
      return Promise.resolve(true);
    };
    try {
      for (const bad of [leAdd(S, L), L, "f".repeat(64)]) {
        assert.equal(await ed25519Verify(key, fromHex(R + bad), new Uint8Array(0)), false, bad);
      }
      assert.equal(calls, 0);
      assert.equal(await ed25519Verify(key, fromHex(SIG), new Uint8Array(0)), true);
      assert.equal(calls, 1);
    } finally {
      crypto.subtle.verify = original;
    }
  });

  it("throws Ed25519Unavailable when WebCrypto has no Ed25519", async () => {
    const key = await crypto.subtle.importKey("raw", fromHex(PUBLIC), { name: "Ed25519" }, false, ["verify"]);
    const original = crypto.subtle.verify.bind(crypto.subtle);
    crypto.subtle.verify = () => Promise.reject(new DOMException("no Ed25519", "NotSupportedError"));
    try {
      await assert.rejects(ed25519Verify(key, fromHex(SIG), new Uint8Array(0)), Ed25519Unavailable);
    } finally {
      crypto.subtle.verify = original;
    }
  });
});
