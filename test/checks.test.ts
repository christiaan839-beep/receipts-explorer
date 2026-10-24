// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// The seven checks against the conformance receipts and a stubbed log
// (test/fixtures/log, written by scripts/make-stub-log.mjs). No test
// reaches the network.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { describe, it } from "node:test";

import { checkOffline, checkReceipts, type CheckResult, type Inputs, type ReceiptReport } from "../src/checks.ts";
import { LogClient } from "../src/log-client.ts";
import { verifyV2Receipt } from "../src/vendor/verifiable-receipts/receipt.ts";
import { leafHash } from "../src/vendor/verifiable-receipts/transparency.ts";
import { CONFORMANCE, LOG, WELL_FORMED_V3, conformanceCase, fixtureReceipt, keyFrom, makeKey, readJson } from "./helpers.ts";
import { LOG_BASE, stubLog, type StubAnswer } from "./stub-log.ts";

const valid = fixtureReceipt("v2-valid-001.json") as { canonical: string };
const LEAF = await leafHash(valid.canonical);
const INCLUSION = `/v1/proof/inclusion?leafHash=${LEAF}&treeSize=3`;
const GOOD: Record<string, StubAnswer> = {
  "/v1/sth": { status: 200, file: "sth.json" },
  [INCLUSION]: { status: 200, file: "inclusion.json" },
  "/v1/cosignatures?treeSize=3": { status: 200, file: "cosignatures.json" },
};
/** An honest log: the same answers, with no fork among the cosignatures. */
const CLEAN: Record<string, StubAnswer> = { ...GOOD, "/v1/cosignatures?treeSize=3": { status: 200, file: "cosignatures-clean.json" } };
const ROOT = (readJson(LOG, "sth.json") as { rootHash: string }).rootHash;
const FORK_ROOT = (readJson(LOG, "cosignatures.json") as { cosignatures: { rootHash: string }[] }).cosignatures.at(-1)?.rootHash ?? "";

const issuer = await keyFrom(CONFORMANCE, "public-key.pem");
const logKey = await keyFrom(LOG, "log-public-key.pem");
const witnesses = [await keyFrom(LOG, "witness-1.pem"), await keyFrom(LOG, "witness-2.pem"), await keyFrom(LOG, "witness-3.pem")];

function inputs(routes: Record<string, StubAnswer | "unreachable"> | undefined, requests: string[] = []): Inputs {
  if (routes === undefined) return { issuerKeys: [issuer], log: undefined };
  return { issuerKeys: [issuer], log: { client: new LogClient(LOG_BASE, stubLog(routes, requests)), logKey, witnessKeys: witnesses } };
}

async function one(receipt: unknown, i: Inputs): Promise<ReceiptReport> {
  const [report] = await checkReceipts([receipt], i);
  assert.ok(report);
  return report;
}

function statuses(report: ReceiptReport): string[] {
  return report.checks.map((c) => `${c.id}:${c.status}`);
}

function check(report: ReceiptReport, id: CheckResult["id"]): CheckResult {
  const c = report.checks.find((x) => x.id === id);
  assert.ok(c, id);
  return c;
}

describe("checks 1 to 4 on the conformance receipts", () => {
  for (const name of readdirSync(CONFORMANCE).filter((f) => f.startsWith("v2-")).sort()) {
    it(`${name}: all pass, or the content hash is not run, exactly when the fixture is valid`, async () => {
      const c = await conformanceCase(name);
      let receipt: unknown;
      try {
        receipt = c.receipt();
      } catch {
        // parseReceipt refused the text, as the page's input reader does: never checked, never valid.
        assert.equal(c.expected.ok, false);
        return;
      }
      const report = await checkOffline(receipt, [c.key]);
      assert.equal(report.valid, c.expected.ok);
      const offlineOk = report.checks.every((x) => x.status === "passed" || (x.id === "content-hash" && x.status === "not-run"));
      assert.equal(offlineOk, c.expected.ok, JSON.stringify(report.checks));
    });
  }
});

describe("checks without a log", () => {
  it("a valid receipt passes 1 to 4; 5 to 7 are not run", async () => {
    const r = await one(valid, inputs(undefined));
    assert.deepEqual(statuses(r), [
      "format:passed",
      "signature:passed",
      "content-hash:passed",
      "repeated-fields:passed",
      "tree-head:not-run",
      "in-log:not-run",
      "witnesses:not-run",
    ]);
    assert.equal(r.valid, true);
    assert.equal(r.key, issuer.fingerprint);
    assert.match(check(r, "signature").detail, new RegExp(issuer.fingerprint));
    assert.equal(r.action?.overall, "pass");
  });

  it("a tampered receipt fails the signature and the content hash, and is not compared", async () => {
    const r = await one(fixtureReceipt("v2-invalid-tampered.json"), inputs(undefined));
    assert.equal(check(r, "signature").status, "failed");
    assert.match(check(r, "signature").detail, /issuer's key, not the log's/);
    assert.equal(check(r, "content-hash").status, "failed");
    assert.equal(check(r, "repeated-fields").status, "not-run");
    assert.equal(r.action, undefined);
    assert.equal(r.valid, false);
  });

  it("a null contentHash is valid, and check 3 is not run; an empty one fails check 3", async () => {
    const nul = await one(fixtureReceipt("v2-valid-null-contenthash.json"), inputs(undefined));
    assert.equal(nul.valid, true);
    assert.equal(check(nul, "content-hash").status, "not-run");
    const empty = await one(fixtureReceipt("v2-invalid-empty-contenthash.json"), inputs(undefined));
    assert.equal(empty.valid, false);
    assert.equal(check(empty, "content-hash").status, "failed");
    assert.match(check(empty, "content-hash").detail, /The contentHash is empty/);
  });

  it("a signature of the wrong size fails Format, and says so", async () => {
    const short = { ...(valid as Record<string, unknown>), signature: "v2=" + "A".repeat(84) }; // 63 bytes
    const r = await one(short, inputs(undefined));
    assert.equal(check(r, "format").status, "failed");
    assert.match(check(r, "format").detail, /^The signature is the wrong size: an Ed25519 signature is 64 bytes\./);
    assert.equal(r.valid, false);
  });

  it("a v3= signature that is not in the one v3 shape fails as not v2; only a well-formed one is named v3", async () => {
    const bad = await one({ ...(valid as Record<string, unknown>), signature: "v3=AAAA.BBBB" }, inputs(undefined));
    assert.match(check(bad, "format").detail, /does not start with v2=/);
    const good = await one({ ...(valid as Record<string, unknown>), signature: WELL_FORMED_V3 }, inputs(undefined));
    assert.match(check(good, "format").detail, /^This is a v3 receipt/);
  });

  it("a repeated field that disagrees names the field and both values", async () => {
    const r = await one(fixtureReceipt("v2-invalid-envelope-disagrees.json"), inputs(undefined));
    const c = check(r, "repeated-fields");
    assert.equal(c.status, "failed");
    assert.match(c.detail, /"overall" says "fail" beside the signed text, but the signed text says "pass"/);
  });

  it("no issuer key: the signature is not run, never passed", async () => {
    const [r] = await checkReceipts([valid], { issuerKeys: [], log: undefined });
    assert.ok(r);
    assert.equal(check(r, "signature").status, "not-run");
    assert.equal(r.valid, false);
  });

  it("an array is checked receipt by receipt", async () => {
    const reports = await checkReceipts([valid, fixtureReceipt("v2-invalid-wrong-key.json")], inputs(undefined));
    assert.deepEqual(
      reports.map((r) => r.valid),
      [true, false],
    );
  });
});

describe("checks that throw", () => {
  it("a receipt nested 5,000 deep fails Format with the verifier's reason, and nothing recurses", async () => {
    const receipt = { ...(valid as Record<string, unknown>), extra: JSON.parse("[".repeat(5000) + "]".repeat(5000)) as unknown };
    const r = await one(receipt, inputs(undefined));
    assert.equal(r.valid, false);
    assert.equal(check(r, "format").status, "failed");
    assert.match(check(r, "format").detail, /receipt nesting deeper than 64/);
  });

  it("signed text nested 65 deep fails the repeated fields with the verifier's reason", async () => {
    const k = await makeKey();
    const canonical = `{"a":${"[".repeat(64)}${"]".repeat(64)}}`;
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, k.privateKey, new TextEncoder().encode(canonical)));
    const receipt = { canonical, signature: `v2=${Buffer.from(sig).toString("base64")}` };
    assert.deepEqual(await verifyV2Receipt(receipt, k.publicKey.key), { ok: false, reason: "canonical nesting deeper than 64" });
    const [r] = await checkReceipts([receipt], { issuerKeys: [k.publicKey], log: undefined });
    assert.ok(r);
    assert.equal(check(r, "signature").status, "passed");
    assert.equal(check(r, "repeated-fields").status, "failed");
    assert.match(check(r, "repeated-fields").detail, /canonical nesting deeper than 64/);
    assert.equal(r.valid, false);
  });

  it("a receipt whose check throws fails, and the next receipt is still checked", async () => {
    const throwing = Object.defineProperty({ signature: "v2=" }, "canonical", {
      enumerable: true,
      get(): never {
        throw new RangeError("Maximum call stack size exceeded");
      },
    });
    const reports = await checkReceipts([throwing, valid], inputs(undefined));
    const [r, next] = reports;
    assert.ok(r && next);
    assert.equal(r.valid, false);
    assert.equal(check(r, "format").status, "failed");
    assert.match(check(r, "format").detail, /^This could not be checked: the page hit RangeError/);
    assert.equal(next.valid, true);
  });

  for (const [id, method] of [
    ["tree-head", "sth"],
    ["in-log", "inclusion"],
    ["witnesses", "cosignatures"],
  ] as const) {
    it(`a throw in check ${id} fails that check alone, in words about what it checks, and checks 1 to 4 keep their results`, async () => {
      const i = inputs(CLEAN);
      assert.ok(i.log);
      i.log.client[method] = () => Promise.reject(new RangeError("Maximum call stack size exceeded"));
      const r = await one(valid, i);
      for (const other of ["format", "signature", "content-hash", "repeated-fields"] as const) assert.equal(check(r, other).status, "passed", other);
      const c = check(r, id);
      assert.equal(c.status, "failed");
      assert.match(c.detail, /^This could not be checked: the page hit RangeError\./);
      assert.doesNotMatch(c.detail, /A receipt this page cannot check/);
      if (id === "in-log") {
        assert.equal(check(r, "tree-head").status, "passed");
        assert.equal(check(r, "witnesses").status, "passed");
      }
    });
  }

  it("no WebCrypto Ed25519: the signature checks are not run, never failed", async () => {
    const original = crypto.subtle.verify.bind(crypto.subtle);
    crypto.subtle.verify = () => Promise.reject(new DOMException("no Ed25519", "NotSupportedError"));
    try {
      const r = await one(valid, inputs(GOOD));
      for (const id of ["format", "signature", "tree-head", "witnesses"] as const) {
        assert.equal(check(r, id).status, "not-run", id);
      }
      assert.match(check(r, "signature").detail, /This browser cannot check Ed25519 signatures/);
      assert.equal(r.valid, false);
    } finally {
      crypto.subtle.verify = original;
    }
  });
});

describe("checks with a stubbed log", () => {
  it("every check passes against an honest log, with 2 of 3 witnesses, each counted once however often it is listed", async () => {
    const requests: string[] = [];
    const r = await one(valid, inputs(CLEAN, requests));
    assert.ok(r.checks.every((c) => c.status === "passed"), JSON.stringify(r.checks));
    assert.match(check(r, "in-log").detail, /^Entry 1 of 3 in the log "stub-log"/);
    assert.match(check(r, "witnesses").detail, /^2 of 3 witnesses cosigned/);
    assert.ok(requests.every((x) => x.startsWith("GET https://log.test/")), requests.join("\n"));
    assert.equal(requests.length, 3);
  });

  it("a log whose witness 3 cosigned a fork: checks 1 to 6 pass, and check 7 fails, naming the witness and both roots", async () => {
    const r = await one(valid, inputs(GOOD));
    assert.deepEqual(statuses(r).slice(0, 6), ["format:passed", "signature:passed", "content-hash:passed", "repeated-fields:passed", "tree-head:passed", "in-log:passed"]);
    const c = check(r, "witnesses");
    assert.equal(c.status, "failed");
    const w3 = witnesses[2];
    assert.ok(w3);
    assert.ok(FORK_ROOT !== "" && FORK_ROOT !== ROOT);
    assert.equal(
      c.detail,
      `Witness ${w3.fingerprint} says the log showed it a tree head of size 3 with root ${FORK_ROOT}; the log's signed tree head has root ${ROOT}. Save the log's answers to /v1/sth and /v1/cosignatures?treeSize=3: together they are the evidence. If the witness is right, the log showed two different histories for one size.`,
    );
  });

  it("a fork cosignature that verifies under no witness key you gave is skipped: check 7 passes", async () => {
    const r = await one(valid, inputs({ ...GOOD, "/v1/cosignatures?treeSize=3": { status: 200, file: "cosignatures-unverified-fork.json" } }));
    assert.equal(check(r, "witnesses").status, "passed");
    assert.match(check(r, "witnesses").detail, /^2 of 3 witnesses cosigned/);
  });

  it("a witness-signed fork in text that is not canonical is skipped: check 7 passes", async () => {
    const r = await one(valid, inputs({ ...GOOD, "/v1/cosignatures?treeSize=3": { status: 200, file: "cosignatures-fork-noncanonical.json" } }));
    assert.equal(check(r, "witnesses").status, "passed");
    assert.match(check(r, "witnesses").detail, /^2 of 3 witnesses cosigned/);
  });

  it("witness 1 cosigned the right root and also a fork: check 7 fails, naming witness 1 and no other", async () => {
    const r = await one(valid, inputs({ ...GOOD, "/v1/cosignatures?treeSize=3": { status: 200, file: "cosignatures-fork-by-w1.json" } }));
    const c = check(r, "witnesses");
    assert.equal(c.status, "failed");
    const [w1, w2, w3] = witnesses;
    assert.ok(w1 && w2 && w3);
    assert.match(c.detail, new RegExp(`^Witness ${w1.fingerprint} says the log showed it a tree head of size 3 with root ${FORK_ROOT}; the log's signed tree head has root ${ROOT}\\.`));
    for (const w of [w2, w3]) assert.ok(!c.detail.includes(w.fingerprint), w.fingerprint);
  });

  it("witnesses 1 and 3 both cosigned a fork: check 7 names both, and not witness 2", async () => {
    const r = await one(valid, inputs({ ...GOOD, "/v1/cosignatures?treeSize=3": { status: 200, file: "cosignatures-fork-by-w1-w3.json" } }));
    const c = check(r, "witnesses");
    assert.equal(c.status, "failed");
    const [w1, w2, w3] = witnesses;
    assert.ok(w1 && w2 && w3);
    assert.match(c.detail, new RegExp(`^Witness ${w1.fingerprint} says .*; witness ${w3.fingerprint} says the log showed it a tree head of size 3 with root ${FORK_ROOT}; the log's signed tree head has root ${ROOT}\\.`));
    assert.ok(!c.detail.includes(w2.fingerprint));
  });

  it("a valid proof for another entry of the same tree, with that entry's leaf hash, fails check 6", async () => {
    const r = await one(valid, inputs({ ...CLEAN, [INCLUSION]: { status: 200, file: "inclusion-other-leaf.json" } }));
    assert.equal(check(r, "tree-head").status, "passed");
    assert.equal(check(r, "in-log").status, "failed");
    assert.match(check(r, "in-log").detail, /a proof for a different entry/);
  });

  it("a signed tree head of the empty log fails check 6: the log is empty", async () => {
    const requests: string[] = [];
    const r = await one(valid, inputs({ ...CLEAN, "/v1/sth": { status: 200, file: "sth-empty.json" } }, requests));
    assert.equal(check(r, "tree-head").status, "passed");
    assert.equal(check(r, "in-log").status, "failed");
    assert.match(check(r, "in-log").detail, /^The log is empty/);
    assert.equal(requests.filter((x) => x.includes("/v1/proof/inclusion")).length, 0);
  });

  it("an unreachable log is a network error: not run, never failed", async () => {
    const r = await one(valid, inputs({}));
    for (const id of ["tree-head", "in-log", "witnesses"] as const) assert.equal(check(r, id).status, "not-run");
    assert.equal(check(r, "tree-head").network, true);
    assert.equal(check(r, "tree-head").retry, true);
    assert.equal(check(r, "tree-head").cause, "network");
    assert.match(check(r, "tree-head").detail, /Could not reach the log at log\.test/);
  });

  it("a forged tree head fails check 5, and 6 and 7 are not run", async () => {
    const r = await one(valid, inputs({ ...GOOD, "/v1/sth": { status: 200, file: "sth-forged.json" } }));
    assert.equal(check(r, "tree-head").status, "failed");
    assert.equal(check(r, "in-log").status, "not-run");
    assert.equal(check(r, "witnesses").status, "not-run");
  });

  it("the wrong log key fails the tree head", async () => {
    const other = await keyFrom(LOG, "other-public-key.pem");
    const i = inputs(GOOD);
    assert.ok(i.log);
    const [r] = await checkReceipts([valid], { ...i, log: { ...i.log, logKey: other } });
    assert.ok(r);
    assert.match(check(r, "tree-head").detail, /does not verify under the log key you gave/);
  });

  it("a proof whose own rootHashHex agrees with it, but the signed root does not, fails", async () => {
    const r = await one(valid, inputs({ ...GOOD, [INCLUSION]: { status: 200, file: "inclusion-lying-root.json" } }));
    assert.equal(check(r, "in-log").status, "failed");
    assert.match(check(r, "in-log").detail, /does not lead to the root in its signed tree head/);
  });

  it("a receipt the log does not hold fails check 6", async () => {
    const r = await one(valid, inputs({ ...GOOD, [INCLUSION]: { status: 404, file: "not-found.json" } }));
    assert.equal(check(r, "in-log").status, "failed");
  });

  it("a log that is busy (503) on the proof: check 6 is not run, and can be retried", async () => {
    const r = await one(valid, inputs({ ...GOOD, [INCLUSION]: { status: 503, file: "busy.json" } }));
    assert.equal(check(r, "tree-head").status, "passed");
    const c = check(r, "in-log");
    assert.deepEqual([c.status, c.network, c.retry, c.cause], ["not-run", false, true, "busy"]);
    assert.match(c.detail, /busy or failing \(it answered 503: server busy\)/);
  });

  it("a 400 from the log is not run, and not offered as a retry", async () => {
    const r = await one(valid, inputs({ ...GOOD, "/v1/sth": { status: 400, file: "not-found.json" } }));
    const c = check(r, "tree-head");
    assert.deepEqual([c.status, c.retry, c.cause], ["not-run", false, undefined]);
  });

  // An answer that is not JSON (here, an empty body) is unreadable: not run, with a retry, never a verdict.
  for (const [id, route] of [
    ["tree-head", "/v1/sth"],
    ["in-log", INCLUSION],
    ["witnesses", "/v1/cosignatures?treeSize=3"],
  ] as const) {
    it(`an unreadable answer for ${id} is not run, can be retried, and is not a network error`, async () => {
      const r = await one(valid, inputs({ ...GOOD, [route]: { status: 200 } }));
      const c = check(r, id);
      assert.deepEqual([c.status, c.network, c.retry, c.cause], ["not-run", false, true, "unreadable"]);
      assert.match(c.detail, /^Not run: The log at log\.test answered \(status 200\), but its answer is not JSON\./);
    });
  }

  it("no log key: checks 5 to 7 are not run, and the log is not asked", async () => {
    const requests: string[] = [];
    const i = inputs(GOOD, requests);
    assert.ok(i.log);
    const [r] = await checkReceipts([valid], { ...i, log: { ...i.log, logKey: undefined } });
    assert.ok(r);
    assert.match(check(r, "tree-head").detail, /a key fetched from the log proves nothing/);
    assert.equal(requests.length, 0);
  });

  it("witness 2 cosigned an earlier signing of the same size and root, with another timestamp: it counts", async () => {
    const i = inputs(GOOD);
    assert.ok(i.log);
    const w2 = witnesses[1];
    assert.ok(w2);
    const [r] = await checkReceipts([valid], { ...i, log: { ...i.log, witnessKeys: [w2] } });
    assert.ok(r);
    assert.equal(check(r, "witnesses").status, "passed");
    assert.match(check(r, "witnesses").detail, /^1 of 1 witnesses cosigned a tree head of the log "stub-log" with 3 entries and this root: sha256:/);
  });

  it("only witness 3, which cosigned a fork and a non-canonical text: check 7 fails", async () => {
    const i = inputs(GOOD);
    assert.ok(i.log);
    const w3 = witnesses[2];
    assert.ok(w3);
    const [r] = await checkReceipts([valid], { ...i, log: { ...i.log, witnessKeys: [w3] } });
    assert.ok(r);
    assert.equal(check(r, "witnesses").status, "failed");
    assert.match(check(r, "witnesses").detail, /together they are the evidence\. If the witness is right, the log showed two different histories for one size\.$/);
  });

  it("a cosignature's signature must be over its own text: witness 1's, moved onto witness 2's text, does not count", async () => {
    const i = inputs(GOOD);
    assert.ok(i.log);
    const w1 = witnesses[0];
    assert.ok(w1);
    const listed = readJson(LOG, "cosignatures.json") as { cosignatures: { sthCanonical: string; signature: string }[] };
    const [first, second] = listed.cosignatures;
    assert.ok(first && second);
    const swapped = JSON.stringify({ treeSize: 3, cosignatures: [{ ...second, signature: first.signature }] });
    const fetcher = (): Promise<Response> => Promise.resolve(new Response(swapped, { status: 200 }));
    const base = stubLog(GOOD);
    const client = new LogClient(LOG_BASE, (url, init) => (url.includes("/v1/cosignatures") ? fetcher() : base(url, init)));
    const [r] = await checkReceipts([valid], { ...i, log: { ...i.log, client, witnessKeys: [w1] } });
    assert.ok(r);
    assert.equal(check(r, "witnesses").status, "failed");
  });

  it("the log is asked for one tree head and one list of cosignatures for many receipts", async () => {
    const requests: string[] = [];
    await checkReceipts([valid, valid, valid], inputs(GOOD, requests));
    assert.equal(requests.filter((x) => x.endsWith("/v1/sth")).length, 1);
    assert.equal(requests.filter((x) => x.includes("/v1/cosignatures")).length, 1);
  });
});
