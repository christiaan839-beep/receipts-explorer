// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// The page's Ed25519 feature check, and the two promises that make it safe
// to skip RFC 8032 test 1: the page never asks WebCrypto about an empty
// message, and the edge-vector keys on which browsers differ from Node never
// reach WebCrypto at all.
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { checkReceipts, type Inputs } from "../src/checks.ts";
import { hasEd25519 } from "../src/ed25519-support.ts";
import { KeyError, parsePublicKeys } from "../src/keys.ts";
import { LogClient } from "../src/log-client.ts";
import { ed25519PublicKeyProblem } from "../src/vendor/verifiable-receipts/ed25519-key.ts";
import { leafHash } from "../src/vendor/verifiable-receipts/transparency.ts";
import { CONFORMANCE, LOG, fixtureReceipt, keyFrom, readJson } from "./helpers.ts";
import { LOG_BASE, stubLog } from "./stub-log.ts";

const subtle = crypto.subtle;
const verify = subtle.verify.bind(subtle);
const importKey = subtle.importKey.bind(subtle);

/** The byte length of the data argument of a SubtleCrypto.verify call. */
function dataLength(args: Parameters<SubtleCrypto["verify"]>): number {
  const data = args[3];
  return data.byteLength;
}

afterEach(() => {
  mock.restoreAll();
});

describe("hasEd25519", () => {
  it("is true where WebCrypto verifies Ed25519 (Node)", async () => {
    assert.equal(await hasEd25519(), true);
  });

  it("is false for a WebCrypto that answers true to everything", async () => {
    mock.method(subtle, "verify", () => Promise.resolve(true));
    assert.equal(await hasEd25519(), false);
  });

  it("is false for a WebCrypto that answers false to everything", async () => {
    mock.method(subtle, "verify", () => Promise.resolve(false));
    assert.equal(await hasEd25519(), false);
  });

  it("is false for a WebCrypto without Ed25519", async () => {
    mock.method(subtle, "importKey", () => Promise.reject(new DOMException("Ed25519", "NotSupportedError")));
    assert.equal(await hasEd25519(), false);
  });

  it("is true for a WebCrypto that is wrong only on the empty message, as WebKit 27.2 is", async () => {
    const calls = mock.method(subtle, "verify", (...args: Parameters<SubtleCrypto["verify"]>) => (dataLength(args) === 0 ? Promise.resolve(false) : verify(...args)));
    assert.equal(await hasEd25519(), true);
    assert.ok(calls.mock.callCount() >= 4, "both import forms, the signature and its flipped copy");
    assert.ok(calls.mock.calls.every((c) => dataLength(c.arguments) > 0), "it never asks about the empty message");
  });
});

describe("the page never asks WebCrypto about an empty message", () => {
  it("a receipt with an empty canonical fails check 1, and check 2 verifies nothing", async () => {
    const issuer = await keyFrom(CONFORMANCE, "public-key.pem");
    const valid = fixtureReceipt("v2-valid-001.json") as Record<string, unknown>;
    const calls = mock.method(subtle, "verify", verify);
    const [report] = await checkReceipts([{ ...valid, canonical: "" }], { issuerKeys: [issuer], log: undefined });
    assert.ok(report);
    assert.deepEqual(
      report.checks.filter((c) => c.id === "format" || c.id === "signature").map((c) => c.status),
      ["failed", "not-run"],
    );
    assert.equal(calls.mock.callCount(), 0);
  });

  it("a whole run against an honest log verifies the receipt, the tree head and every cosignature over text that is not empty", async () => {
    const valid = fixtureReceipt("v2-valid-001.json") as { canonical: string };
    const leaf = await leafHash(valid.canonical);
    const inputs: Inputs = {
      issuerKeys: [await keyFrom(CONFORMANCE, "public-key.pem")],
      log: {
        client: new LogClient(
          LOG_BASE,
          stubLog({
            "/v1/sth": { status: 200, file: "sth.json" },
            [`/v1/proof/inclusion?leafHash=${leaf}&treeSize=3`]: { status: 200, file: "inclusion.json" },
            "/v1/cosignatures?treeSize=3": { status: 200, file: "cosignatures-clean.json" },
          }),
        ),
        logKey: await keyFrom(LOG, "log-public-key.pem"),
        witnessKeys: [await keyFrom(LOG, "witness-1.pem"), await keyFrom(LOG, "witness-2.pem"), await keyFrom(LOG, "witness-3.pem")],
      },
    };
    const calls = mock.method(subtle, "verify", verify);
    const [report] = await checkReceipts([valid], inputs);
    assert.ok(report);
    assert.ok(report.checks.every((c) => c.status === "passed"));
    assert.ok(calls.mock.callCount() >= 4, "the receipt, the tree head and at least two cosignatures");
    assert.ok(calls.mock.calls.every((c) => dataLength(c.arguments) > 0));
  });
});

describe("the identity-key edge vectors never reach WebCrypto", () => {
  // Firefox 157 and WebKit 27.2 answer false where Node answers true for these
  // two keys (test/fixtures/ed25519). The page refuses both keys first.
  const vectors = readJson(new URL("./fixtures/ed25519/", import.meta.url), "vectors.json") as { name: string; spki: string }[];
  for (const name of ["identity key non-canonical (y=p+1), R=identity, S=0", "identity key with sign bit (01..80), R=id, S=0"]) {
    it(name, async () => {
      const v = vectors.find((x) => x.name === name);
      assert.ok(v);
      const der = Buffer.from(v.spki, "base64");
      assert.equal(ed25519PublicKeyProblem(new Uint8Array(der.subarray(12))), "public key is a small-order point");
      const imports = mock.method(subtle, "importKey", importKey);
      const verifies = mock.method(subtle, "verify", verify);
      const pem = `-----BEGIN PUBLIC KEY-----\n${v.spki}\n-----END PUBLIC KEY-----\n`;
      await assert.rejects(parsePublicKeys(pem, "The issuer key"), (e: unknown) => e instanceof KeyError && e.message.includes("small order"));
      assert.equal(imports.mock.callCount(), 0);
      assert.equal(verifies.mock.callCount(), 0);
    });
  }
});
