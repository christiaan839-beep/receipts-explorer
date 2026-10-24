// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Property tests (fast-check) of the page's input handling: it never throws
// on any input, and checks 1 to 4 pass exactly when the vendored verifier
// accepts. FC_NUM_RUNS raises the number of cases per property (default 200).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import fc from "fast-check";

import { checkOffline, checkReceipts, type CheckId, type Inputs, type ReceiptReport } from "../src/checks.ts";
import { parseReceipts } from "../src/input.ts";
import { parsePublicKeys } from "../src/keys.ts";
import { LogClient, parseLogAddress } from "../src/log-client.ts";
import { checkTreeHead } from "../src/tree-head.ts";
import { verifyV2Receipt } from "../src/vendor/verifiable-receipts/receipt.ts";
import { CONFORMANCE, LOG, keyFrom, makeKey, readText, signReceipt } from "./helpers.ts";
import { body, mutate, mutation } from "./mutations.ts";
import { LOG_BASE } from "./stub-log.ts";

const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? "200");
fc.configureGlobal({ numRuns: Number.isSafeInteger(NUM_RUNS) && NUM_RUNS > 0 ? NUM_RUNS : 200 });

const issuer = await makeKey();
const anyText = fc.oneof(fc.string(), fc.json(), fc.jsonValue().map((v) => JSON.stringify(v)));

// Real inputs to mutate field by field: the signed tree head and the
// receipt that the stub log holds, with their keys.
const REAL_STH = JSON.parse(readText(LOG, "sth.json")) as Record<string, unknown>;
const REAL_RECEIPT = (JSON.parse(readText(CONFORMANCE, "v2-valid-001.json")) as { receipt: Record<string, unknown> }).receipt;
const LOG_KEY = await keyFrom(LOG, "log-public-key.pem");
const ISSUER_KEY = await keyFrom(CONFORMANCE, "public-key.pem");
const WITNESS_KEYS = [await keyFrom(LOG, "witness-1.pem"), await keyFrom(LOG, "witness-2.pem"), await keyFrom(LOG, "witness-3.pem")];
const REAL_DER = Buffer.from(readText(LOG, "witness-1.pem").replace(/-----[A-Z ]+-----|\s/g, ""), "base64");
const CHECK_IDS: readonly CheckId[] = ["format", "signature", "content-hash", "repeated-fields", "tree-head", "in-log", "witnesses"];

/** One change to one field of an object: the field is picked by index among its keys. */
type FieldMutation =
  | { kind: "drop"; pick: number }
  | { kind: "replace"; pick: number; value: unknown }
  | { kind: "retype"; pick: number; to: number }
  | { kind: "flip"; pick: number; pos: number; mask: number }
  | { kind: "add"; name: string; value: unknown };

const fieldMutation: fc.Arbitrary<FieldMutation> = fc.oneof(
  fc.record({ kind: fc.constant("drop" as const), pick: fc.nat() }),
  fc.record({ kind: fc.constant("replace" as const), pick: fc.nat(), value: fc.jsonValue({ maxDepth: 2 }) }),
  fc.record({ kind: fc.constant("retype" as const), pick: fc.nat(), to: fc.nat({ max: 5 }) }),
  fc.record({ kind: fc.constant("flip" as const), pick: fc.nat(), pos: fc.nat(), mask: fc.integer({ min: 1, max: 255 }) }),
  fc.record({ kind: fc.constant("add" as const), name: fc.string({ maxLength: 8 }), value: fc.jsonValue({ maxDepth: 2 }) }),
);
/** None, now and then, so the unchanged input (and the passing branches) are reached too. */
const fieldMutations = fc.oneof({ arbitrary: fc.constant([] as FieldMutation[]), weight: 1 }, { arbitrary: fc.array(fieldMutation, { minLength: 1, maxLength: 3 }), weight: 4 });
/** A key repeated in the text: an existing one (picked by index) or a new one, with a JSON value or the field's own. */
const duplicate = fc.oneof(
  { arbitrary: fc.constant(undefined), weight: 3 },
  { arbitrary: fc.record({ pick: fc.nat(), value: fc.option(fc.jsonValue({ maxDepth: 2 }), { nil: undefined }), first: fc.boolean() }), weight: 1 },
);

/** The same value as another JSON type. */
function retype(v: unknown, to: number): unknown {
  const options = [(JSON.stringify(v) as string | undefined) ?? "", typeof v === "string" ? v.length : typeof v === "number" ? String(v) : 1, [v], { v }, null, !v];
  return options[to % options.length];
}

/** Flips bits of one byte: inside hex or base64 text it flips a decoded byte and spells it again; elsewhere one character. */
function flip(v: unknown, pos: number, mask: number): unknown {
  if (typeof v === "number") return v ^ mask;
  if (typeof v !== "string" || v === "") return v;
  const hex = /^(sha256:)?([0-9a-f]{2})+$/.exec(v);
  if (hex !== null) {
    const prefix = hex[1] ?? "";
    const bytes = Buffer.from(v.slice(prefix.length), "hex");
    bytes[pos % bytes.length] = (bytes[pos % bytes.length] ?? 0) ^ mask;
    return prefix + bytes.toString("hex");
  }
  if (/^v2=[A-Za-z0-9+/]+={0,2}$/.test(v)) {
    const bytes = Buffer.from(v.slice(3), "base64");
    if (bytes.length > 0) {
      bytes[pos % bytes.length] = (bytes[pos % bytes.length] ?? 0) ^ mask;
      return "v2=" + bytes.toString("base64");
    }
  }
  const run = /[0-9a-f]{64}/.exec(v);
  if (run !== null) {
    const i = run.index + 2 * (pos % 32);
    const flipped = ((Number.parseInt(v.slice(i, i + 2), 16) ^ mask) & 0xff).toString(16).padStart(2, "0");
    return v.slice(0, i) + flipped + v.slice(i + 2);
  }
  const i = pos % v.length;
  return v.slice(0, i) + String.fromCharCode(v.charCodeAt(i) ^ (mask & 0x7f || 1)) + v.slice(i + 1);
}

function applyField(value: Record<string, unknown>, m: FieldMutation): Record<string, unknown> {
  if (m.kind === "add") return { ...value, [m.name]: m.value };
  const keys = Object.keys(value);
  if (keys.length === 0) return m.kind === "replace" ? { extra: m.value } : value;
  const key = keys[m.pick % keys.length] ?? "";
  const r = { ...value };
  switch (m.kind) {
    case "drop":
      return Object.fromEntries(Object.entries(r).filter(([k]) => k !== key));
    case "replace":
      r[key] = m.value;
      return r;
    case "retype":
      r[key] = retype(r[key], m.to);
      return r;
    case "flip":
      r[key] = flip(r[key], m.pos, m.mask);
      return r;
  }
}

/** The object as JSON text, with one key written twice when `dup` says so. */
function asText(value: Record<string, unknown>, dup: { pick: number; value: unknown; first: boolean } | undefined): string {
  const text = JSON.stringify(value);
  if (dup === undefined) return text;
  const keys = Object.keys(value);
  const key = keys.length === 0 ? "extra" : (keys[dup.pick % keys.length] ?? "extra");
  const pair = `${JSON.stringify(key)}:${JSON.stringify(dup.value === undefined ? (value[key] ?? null) : dup.value)}`;
  if (text === "{}") return `{${pair},${pair}}`;
  return dup.first ? `{${pair},${text.slice(1)}` : `${text.slice(0, -1)},${pair}}`;
}

/** A log that serves `sth` as its tree head, and the honest log's proof and cosignatures. */
function logServing(sth: string): Inputs["log"] {
  const answer = (body: string): Promise<Response> => Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }));
  const client = new LogClient(LOG_BASE, (url) => {
    const path = new URL(url).pathname;
    if (path === "/v1/sth") return answer(sth);
    if (path === "/v1/proof/inclusion") return answer(readText(LOG, "inclusion.json"));
    return answer(readText(LOG, "cosignatures-clean.json"));
  });
  return { client, logKey: LOG_KEY, witnessKeys: WITNESS_KEYS };
}

/** Checks a report has the seven checks in order, each passed, failed or not run. */
function assertSevenChecks(report: ReceiptReport | undefined): asserts report is ReceiptReport {
  assert.ok(report);
  assert.deepEqual(
    report.checks.map((c) => c.id),
    CHECK_IDS,
  );
  for (const c of report.checks) assert.ok(["passed", "failed", "not-run"].includes(c.status), JSON.stringify(c));
  assert.equal(typeof report.valid, "boolean");
}

/** A result's sentence as an outcome name: its first sentence, with quoted values (from the first quote to the last), hashes and numbers dropped. */
function outcome(detail: string): string {
  const first = detail.split(/(?<=\.) /)[0] ?? detail;
  return first.replace(/".*"/, '"…"').replace(/sha256:[0-9a-f]+|[0-9a-f]{64}|\b\d+\b/g, "#");
}

function count(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function report(t: { diagnostic: (message: string) => void }, name: string, map: Map<string, number>): void {
  const total = [...map.values()].reduce((a, b) => a + b, 0);
  t.diagnostic(`${name}: ${String(total)} runs, ${String(map.size)} outcomes`);
  for (const [k, n] of [...map].sort((a, b) => b[1] - a[1])) t.diagnostic(`  ${String(n)}  ${k}`);
}

/** Small-order and non-canonical encodings of a point, little-endian: the identity, 0, p − 1, p, p + 1, p + 2, p + 3, and the identity with the sign bit set. */
const WEAK_POINTS = [
  "01" + "00".repeat(31),
  "00".repeat(32),
  "ec" + "ff".repeat(30) + "7f",
  "ed" + "ff".repeat(30) + "7f",
  "ee" + "ff".repeat(30) + "7f",
  "ef" + "ff".repeat(30) + "7f",
  "f0" + "ff".repeat(30) + "7f",
  "01" + "00".repeat(30) + "80",
];

/** A real key's DER, changed: a byte flipped, cut short, bytes added, or its point swapped for a weak one; then as PEM. */
const mutatedKeyPem = fc
  .oneof(
    fc.record({ pos: fc.nat({ max: REAL_DER.length - 1 }), mask: fc.integer({ min: 1, max: 255 }) }).map(({ pos, mask }) => {
      const der = Buffer.from(REAL_DER);
      der[pos] = (der[pos] ?? 0) ^ mask;
      return der;
    }),
    fc.nat({ max: REAL_DER.length - 1 }).map((n) => REAL_DER.subarray(0, n)),
    fc.uint8Array({ minLength: 1, maxLength: 4 }).map((extra) => Buffer.concat([REAL_DER, extra])),
    fc.constantFrom(...WEAK_POINTS).map((point) => Buffer.concat([REAL_DER.subarray(0, 12), Buffer.from(point, "hex")])),
    fc.constant(REAL_DER),
  )
  .map((der) => `-----BEGIN PUBLIC KEY-----\n${der.toString("base64")}\n-----END PUBLIC KEY-----\n`);

describe("parsing never throws", () => {
  it("parseReceipts", () => {
    fc.assert(fc.property(anyText, (t) => typeof parseReceipts(t).ok === "boolean"));
  });
  it("parseLogAddress", () => {
    fc.assert(fc.property(fc.oneof(fc.string(), fc.webUrl()), (t) => typeof parseLogAddress(t).ok === "boolean"));
  });
  it("parsePublicKeys throws only KeyError", async (t) => {
    const outcomes = new Map<string, number>();
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.string(), fc.string().map((s) => `-----BEGIN PUBLIC KEY-----\n${s}\n-----END PUBLIC KEY-----`), mutatedKeyPem), async (text) => {
        try {
          const keys = await parsePublicKeys(text, "The key");
          count(outcomes, `read ${String(keys.length)} key(s)`);
        } catch (e) {
          assert.equal((e as Error).constructor.name, "KeyError");
          count(outcomes, outcome((e as Error).message.replace(/^The key(, block \d+,)? /, "")));
        }
      }),
    );
    report(t, "parsePublicKeys", outcomes);
    for (const reached of [/^read 1 key/, /small order/, /not the canonical encoding/, /not an Ed25519 public key, or is damaged/]) {
      assert.ok([...outcomes.keys()].some((k) => reached.test(k)), `${String(reached)} never reached`);
    }
  });
  it("checkTreeHead and checkOffline", async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (v) => {
        assert.ok(["passed", "failed", "not-run"].includes((await checkTreeHead(v, issuer.publicKey)).status));
        assert.equal(typeof (await checkOffline(v, [issuer.publicKey])).valid, "boolean");
      }),
    );
  });

  it("a real signed tree head, changed field by field: checkTreeHead and all seven checks never throw", async (t) => {
    const heads = new Map<string, number>();
    const runs = new Map<string, number>();
    await fc.assert(
      fc.asyncProperty(fieldMutations, duplicate, async (ms, dup) => {
        const text = asText(ms.reduce(applyField, REAL_STH), dup);
        const head = await checkTreeHead(JSON.parse(text) as unknown, LOG_KEY);
        assert.ok(["passed", "failed", "not-run"].includes(head.status));
        count(heads, head.status === "passed" ? "passed" : `${head.status}: ${outcome(head.reason)}`);
        const [r] = await checkReceipts([REAL_RECEIPT], { issuerKeys: [ISSUER_KEY], log: logServing(text) });
        assertSevenChecks(r);
        const [, , , , treeHead, inLog, witnesses] = r.checks;
        assert.ok(treeHead && inLog && witnesses);
        count(runs, [treeHead, inLog, witnesses].map((c) => `${c.id} ${c.status}${c.status === "passed" ? "" : ` (${outcome(c.detail)})`}`).join("; "));
      }),
    );
    report(t, "checkTreeHead", heads);
    report(t, "checks 5 to 7", runs);
    assert.ok((heads.get("passed") ?? 0) > 0, "the real tree head never passed");
    assert.ok(heads.size >= 6, `only ${String(heads.size)} tree head outcomes`);
  });

  it("a real signed receipt, changed field by field: parseReceipts, checkOffline and all seven checks never throw", async (t) => {
    const runs = new Map<string, number>();
    const log = logServing(readText(LOG, "sth.json"));
    await fc.assert(
      fc.asyncProperty(fieldMutations, duplicate, async (ms, dup) => {
        const changed = ms.reduce(applyField, REAL_RECEIPT);
        const offline = await checkOffline(changed, [ISSUER_KEY]);
        assert.deepEqual(
          offline.checks.map((c) => c.id),
          CHECK_IDS.slice(0, 4),
        );
        const parsed = parseReceipts(asText(changed, dup));
        if (!parsed.ok) {
          count(runs, `not read: ${outcome(parsed.reason)}`);
          return;
        }
        const reports = await checkReceipts(parsed.receipts, { issuerKeys: [ISSUER_KEY], log });
        assert.equal(reports.length, parsed.receipts.length);
        for (const r of reports) {
          assertSevenChecks(r);
          const notPassed = r.checks.find((c) => c.status !== "passed" && !(c.id === "content-hash" && c.status === "not-run"));
          count(runs, notPassed === undefined ? "all seven pass" : `${notPassed.id} ${notPassed.status}: ${outcome(notPassed.detail)}`);
        }
      }),
    );
    report(t, "receipt", runs);
    assert.ok((runs.get("all seven pass") ?? 0) > 0, "the real receipt never passed");
    assert.ok(runs.size >= 6, `only ${String(runs.size)} receipt outcomes`);
  });
});

describe("checks 1 to 4 agree with the vendored verifier", () => {
  it("they all pass, or the content hash is not run, exactly when verifyV2Receipt accepts", async () => {
    await fc.assert(
      fc.asyncProperty(body, mutation, mutation, async (b, m1, m2) => {
        const receipt = mutate(mutate(await signReceipt(b, issuer.privateKey), m1), m2);
        const port = await verifyV2Receipt(receipt, issuer.publicKey.key);
        const report = await checkOffline(receipt, [issuer.publicKey]);
        assert.equal(report.valid, port.ok);
        const offlineOk = report.checks.every((c) => c.status === "passed" || (c.id === "content-hash" && c.status === "not-run"));
        assert.equal(offlineOk, port.ok, JSON.stringify({ receipt, checks: report.checks }));
      }),
    );
  });
});
