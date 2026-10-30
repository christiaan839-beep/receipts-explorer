// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_INPUT_CHARS, MAX_NESTING, MAX_RECEIPTS, nestingDepth, parseReceipts } from "../src/input.ts";
import { parseLogAddress } from "../src/log-client.ts";

describe("parseReceipts", () => {
  it("reads one receipt as a list of one", () => {
    assert.deepEqual(parseReceipts('{"canonical":"{}"}'), { ok: true, receipts: [{ canonical: "{}" }] });
  });
  it("reads text that starts with a byte order mark, as an editor may save it", () => {
    const bom = String.fromCharCode(0xfeff);
    assert.deepEqual(parseReceipts(bom + '{"canonical":"{}"}'), { ok: true, receipts: [{ canonical: "{}" }] });
    assert.deepEqual(parseReceipts(bom + '[{"canonical":"{}"}]'), { ok: true, receipts: [{ canonical: "{}" }] });
    const twice = parseReceipts(bom + bom + '{"canonical":"{}"}');
    assert.ok(!twice.ok && twice.reason.includes("not valid JSON"));
  });
  it("does not take a broken single receipt for receipts one per line", () => {
    const r = parseReceipts('{"canonical":');
    assert.ok(!r.ok && !r.reason.includes("one per line"));
  });
  it("reads an array as its receipts", () => {
    const r = parseReceipts("[{}, {}]");
    assert.ok(r.ok && r.receipts.length === 2);
  });
  for (const [name, text, reason] of [
    ["empty text", "  ", /Paste a receipt/],
    ["a value that is not an object", "42", /This is not a receipt/],
    ["text that is not JSON", "{canonical:", /not valid JSON/],
    ["an empty list", "[]", /^The receipt text holds an empty list/],
    ["too many receipts", JSON.stringify(Array.from({ length: MAX_RECEIPTS + 1 }, () => ({}))), /^The receipt text holds 1001 receipts.*up to 1000/],
    ["text over the limit", " ".repeat(MAX_INPUT_CHARS) + "{}", /longer than 5 million characters/],
    ["receipts one per line", '{"canonical":"{}"}\n{"canonical":"{}"}\n', /one per line.*a single receipt or a JSON list/],
    ["receipts one per line, ending in a broken one", '{"canonical":"{}"}\r\n{"canonical":', /one per line.*a single receipt or a JSON list/],
  ] as const) {
    it(`explains ${name}`, () => {
      const r = parseReceipts(text);
      assert.ok(!r.ok && reason.test(r.reason));
    });
  }
});

describe("nesting", () => {
  const deep = (n: number): string => "[".repeat(n) + "]".repeat(n);
  it("counts arrays and objects as the verifier does: not inside strings, and never below zero", () => {
    assert.equal(nestingDepth('{"a":[1,{"b":"[[[{{{"}]}'), 3);
    assert.equal(nestingDepth('"\\"[[['), 0);
    assert.equal(nestingDepth("]]][["), 2);
    assert.equal(nestingDepth("[".repeat(100_000)), 100_000);
  });
  it(`reads a receipt ${String(MAX_NESTING)} deep, and refuses one a level deeper, with the verifier's reason`, () => {
    // The receipt object is one level, so a field holds MAX_NESTING - 1 arrays at the limit.
    assert.ok(parseReceipts(`{"canonical":"{}","f":${deep(MAX_NESTING - 1)}}`).ok);
    const r = parseReceipts(`{"canonical":"{}","f":${deep(MAX_NESTING)}}`);
    assert.ok(!r.ok && r.reason.includes("receipt nesting deeper than 64"));
  });
  it("counts the text, so a deep duplicate key that JSON.parse discards is still refused", () => {
    const r = parseReceipts(`{"canonical":"{}","overall":${deep(MAX_NESTING)},"overall":"pass"}`);
    assert.ok(!r.ok && r.reason.includes("receipt nesting deeper than 64"));
  });
  it("counts the text of a list, so a deep duplicate key in a receipt in it is still refused", () => {
    const r = parseReceipts(`[{"canonical":"{}","overall":${deep(MAX_NESTING)},"overall":"pass"}]`);
    assert.ok(!r.ok && r.reason.includes("receipt nesting deeper than 64"));
  });
  it("allows a list one level more than a receipt, and no more", () => {
    assert.ok(parseReceipts(`[{"canonical":"{}","f":${deep(MAX_NESTING - 1)}}]`).ok);
    const r = parseReceipts(`[{"canonical":"{}","f":${deep(MAX_NESTING)}}]`);
    assert.ok(!r.ok && r.reason.includes("receipt nesting deeper than 64"));
  });
  it("leaves signed text to the checks: its depth is counted after the signature, as the verifier counts it", () => {
    assert.ok(parseReceipts(JSON.stringify({ canonical: `{"a":${deep(200)}}`, signature: "v2=" })).ok);
  });
});

describe("parseLogAddress", () => {
  it("adds the trailing slash, so /v1/ routes resolve under a path", () => {
    const r = parseLogAddress(" https://example.org/log ");
    assert.ok(r.ok);
    assert.equal(new URL("v1/sth", r.base).href, "https://example.org/log/v1/sth");
  });
  for (const [text, reason] of [
    ["log.example.org", /not a web address/],
    ["http://log.example.org", /must start with https/],
    ["https://user:pw@log.example.org", /user name or password/],
    ["https://log.example.org/?x=1", /must not contain \? or #/],
    ["https://log.example.org/?", /must not contain \? or #/],
    ["https://log.example.org/log#", /must not contain \? or #/],
  ] as const) {
    it(`rejects ${text}`, () => {
      const r = parseLogAddress(text);
      assert.ok(!r.ok && reason.test(r.reason));
    });
  }
});
