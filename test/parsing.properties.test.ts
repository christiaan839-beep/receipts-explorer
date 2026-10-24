// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Property tests (fast-check) of the page's input handling: it never throws
// on any input, and checks 1 to 4 pass exactly when the vendored verifier
// accepts. FC_NUM_RUNS raises the number of cases per property (default 200).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import fc from "fast-check";

import { checkOffline } from "../src/checks.ts";
import { parseReceipts } from "../src/input.ts";
import { parsePublicKeys } from "../src/keys.ts";
import { parseLogAddress } from "../src/log-client.ts";
import { checkTreeHead } from "../src/tree-head.ts";
import { verifyV2Receipt } from "../src/vendor/verifiable-receipts/receipt.ts";
import { makeKey, signReceipt } from "./helpers.ts";
import { body, mutate, mutation } from "./mutations.ts";

const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? "200");
fc.configureGlobal({ numRuns: Number.isSafeInteger(NUM_RUNS) && NUM_RUNS > 0 ? NUM_RUNS : 200 });

const issuer = await makeKey();
const anyText = fc.oneof(fc.string(), fc.json(), fc.jsonValue().map((v) => JSON.stringify(v)));

describe("parsing never throws", () => {
  it("parseReceipts", () => {
    fc.assert(fc.property(anyText, (t) => typeof parseReceipts(t).ok === "boolean"));
  });
  it("parseLogAddress", () => {
    fc.assert(fc.property(fc.oneof(fc.string(), fc.webUrl()), (t) => typeof parseLogAddress(t).ok === "boolean"));
  });
  it("parsePublicKeys throws only KeyError", async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.string(), fc.string().map((s) => `-----BEGIN PUBLIC KEY-----\n${s}\n-----END PUBLIC KEY-----`)), async (t) => {
        try {
          await parsePublicKeys(t, "The key");
        } catch (e) {
          assert.equal((e as Error).constructor.name, "KeyError");
        }
      }),
    );
  });
  it("checkTreeHead and checkOffline", async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (v) => {
        assert.ok(["passed", "failed", "not-run"].includes((await checkTreeHead(v, issuer.publicKey)).status));
        assert.equal(typeof (await checkOffline(v, [issuer.publicKey])).valid, "boolean");
      }),
    );
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
