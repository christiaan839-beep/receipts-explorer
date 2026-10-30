// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { EMPTY_ROOT, canonicalTreeHead, checkTreeHead } from "../src/tree-head.ts";
import { LOG, WELL_FORMED_V3, keyFrom, makeKey, readJson } from "./helpers.ts";

const SCHEMA_EXAMPLES = new URL("./fixtures/schemas/", import.meta.url);
const logKey = await keyFrom(LOG, "log-public-key.pem");
const sth = readJson(LOG, "sth.json") as Record<string, unknown>;
const forged = readJson(LOG, "sth-forged.json") as Record<string, unknown>;

/** The same 64 bytes in a spelling no signer writes: a non-zero padding bit. */
function respell(signature: string): string {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const i = signature.length - 3;
  return signature.slice(0, i) + (B64[B64.indexOf(signature.charAt(i)) | 1] ?? "") + signature.slice(i + 1);
}

/** A tree head's canonical text, written as the log writes it. */
function canon(h: Record<string, unknown>): string {
  return JSON.stringify({ logId: h.logId, rootHash: h.rootHash, timestamp: h.timestamp, treeSize: h.treeSize, v: h.v });
}

/** Control characters, C1, line separators and text-direction marks: witness.mjs refuses each in a logId. */
const UNSAFE_LOG_IDS = ["stub\u0000log", "stub\u001blog", "stub\u007flog", "stub\u0085log", "stub\u2028log", "stub\u2029log", "stub\u200elog", "stub\u202elog", "stub\u2066log"];

/** Timestamps in the right form that are not a real instant, or not as toISOString writes it. */
const IMPOSSIBLE_TIMESTAMPS = [
  ["30 February", "2026-02-30T12:00:00.000Z"],
  ["hour 25", "2026-10-23T25:00:00.000Z"],
  ["hour 24", "2026-10-23T24:00:00.000Z"],
  ["second 60", "2026-10-23T12:00:60.000Z"],
  ["month 13", "2026-13-23T12:00:00.000Z"],
] as const;

const NOT_EMPTY_ROOT = sth.rootHash as string;

describe("EMPTY_ROOT", () => {
  it("is the SHA-256 of no bytes", () => {
    assert.equal(EMPTY_ROOT, createHash("sha256").digest("hex"));
  });
});

describe("checkTreeHead", () => {
  it("passes the stub log's tree head under its key", async () => {
    const r = await checkTreeHead(sth, logKey);
    assert.equal(r.status, "passed");
  });

  it("passes it without the optional canonical field", async () => {
    const rest = Object.fromEntries(Object.entries(sth).filter(([k]) => k !== "canonical"));
    assert.equal((await checkTreeHead(rest, logKey)).status, "passed");
  });

  it("passes an empty tree whose root is the SHA-256 of no bytes", async () => {
    const { privateKey, publicKey } = await makeKey();
    const head = { v: 1, logId: "empty-log", treeSize: 0, rootHash: EMPTY_ROOT, timestamp: "2026-10-23T12:00:00.000Z" };
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, new TextEncoder().encode(canon(head))));
    const r = await checkTreeHead({ ...head, signature: "v2=" + Buffer.from(sig).toString("base64") }, publicKey);
    assert.equal(r.status, "passed");
  });

  it("fails the schema example: right shape, but its signature is not over it", async () => {
    const r = await checkTreeHead(readJson(SCHEMA_EXAMPLES, "tree-head.json"), logKey);
    assert.ok(r.status === "failed");
    assert.match(r.reason, /does not verify under the log key/);
  });

  it("fails forged fields sent with the genuine canonical text and signature", async () => {
    const r = await checkTreeHead({ ...sth, rootHash: forged.rootHash }, logKey);
    assert.ok(r.status === "failed");
    assert.match(r.reason, /canonical text does not match its own fields/);
  });

  for (const [name, change, reason] of [
    ["an extra field", { extra: 1 }, /does not cover: "extra"/],
    ["version 2", { v: 2 }, /not version 1/],
    ["uppercase hex", { rootHash: (sth.rootHash as string).toUpperCase() }, /64 lowercase hex/],
    ["a fractional size", { treeSize: 1.5 }, /whole number/],
    ["a size beyond 2^53 - 1", { treeSize: 2 ** 53 }, /whole number/],
    ["a timestamp without milliseconds", { timestamp: "2026-10-23T12:00:00Z" }, /timestamp is not a real time/],
    ...IMPOSSIBLE_TIMESTAMPS.map(([what, timestamp]) => [`a timestamp on ${what}`, { timestamp }, /timestamp is not a real time/] as const),
    ...UNSAFE_LOG_IDS.map((logId) => [`a logId with U+${logId.codePointAt(4)?.toString(16).padStart(4, "0") ?? ""}`, { logId }, /logId contains control characters/] as const),
    ["size 0 and a root that is not the empty tree's", { treeSize: 0, rootHash: NOT_EMPTY_ROOT }, /says the log is empty/],
    ["a canonical that is not its fields", { canonical: "{}" }, /canonical text does not match/],
    ["a non-canonical signature spelling", { signature: respell(sth.signature as string) }, /well-formed v2=/],
    ["a v3= prefix on something that is not a v3= signature", { signature: "v3=AAAA.BBBB" }, /well-formed v2=/],
    ["a signature of 63 bytes", { signature: "v2=" + Buffer.alloc(63).toString("base64") }, /not 64 bytes/],
    ["a signature of 65 bytes", { signature: "v2=" + Buffer.alloc(65).toString("base64") }, /not 64 bytes/],
    ["an empty v2= signature", { signature: "v2=" }, /not 64 bytes/],
  ] as const) {
    it(`fails a tree head with ${name}`, async () => {
      const r = await checkTreeHead({ ...sth, ...change }, logKey);
      assert.ok(r.status === "failed");
      assert.match(r.reason, reason);
    });
  }

  it("does not run on a v3= tree head, rather than failing it", async () => {
    const r = await checkTreeHead({ ...sth, signature: WELL_FORMED_V3 }, logKey);
    assert.equal(r.status, "not-run");
  });

  it("fails anything that is not an object", async () => {
    for (const v of [null, [], "sth", 3]) assert.equal((await checkTreeHead(v, logKey)).status, "failed");
  });
});

describe("canonicalTreeHead", () => {
  const text = sth.canonical as string;
  it("reads the canonical text of a tree head", () => {
    assert.deepEqual(canonicalTreeHead(text), { v: 1, logId: "stub-log", treeSize: 3, rootHash: sth.rootHash, timestamp: sth.timestamp });
  });
  it("reads the canonical text of an empty tree", () => {
    const empty = { ...sth, treeSize: 0, rootHash: EMPTY_ROOT };
    assert.equal(canonicalTreeHead(canon(empty))?.treeSize, 0);
  });
  for (const [name, changed] of [
    ["a space added", text.replace(":3,", ": 3,")],
    ["keys in another order", JSON.stringify({ v: 1, logId: "stub-log", rootHash: sth.rootHash, timestamp: sth.timestamp, treeSize: 3 })],
    ["an extra field", text.replace('"v":1}', '"v":1,"x":0}')],
    ["uppercase hex", text.replace(sth.rootHash as string, (sth.rootHash as string).toUpperCase())],
    ["text that is not JSON", "{"],
    ["a timestamp without milliseconds", canon({ ...sth, timestamp: "2026-10-23T12:00:00Z" })],
    ...IMPOSSIBLE_TIMESTAMPS.map(([what, timestamp]) => [`a timestamp on ${what}`, canon({ ...sth, timestamp })] as const),
    ...UNSAFE_LOG_IDS.map((logId) => [`a logId with U+${logId.codePointAt(4)?.toString(16).padStart(4, "0") ?? ""}`, canon({ ...sth, logId })] as const),
    ["size 0 and a root that is not the empty tree's", canon({ ...sth, treeSize: 0, rootHash: NOT_EMPTY_ROOT })],
  ] as const) {
    it(`rejects ${name}`, () => {
      assert.equal(canonicalTreeHead(changed), undefined);
    });
  }
});
