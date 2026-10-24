// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Ed25519Unavailable, ed25519Verify, fromBase64, fromHex, toBase64, toHex, utf8 } from "../src/bytes.ts";

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
