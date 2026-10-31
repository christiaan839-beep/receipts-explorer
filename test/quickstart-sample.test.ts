// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// The quickstart's TypeScript sample (content/samples/verify-signature.mjs),
// run as the page prints it. The package it imports is not on npm, so the
// test puts a stand-in for @sovereignos/verifiable-receipts beside it: the
// package's loadEd25519PublicKey and verifyEd25519, with the vendored key
// and signature checks of VAOS 2.0 section 7.3. The sample must refuse a
// prefix other than v2= and base64 in any spelling but the canonical one,
// and the page must say which section 7 steps it does not make.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { CONFORMANCE, readText } from "./helpers.ts";

const SAMPLE = readFileSync(new URL("../content/samples/verify-signature.mjs", import.meta.url), "utf8");
const VENDORED = new URL("../src/vendor/verifiable-receipts/ed25519-key.ts", import.meta.url).href;

const STAND_IN = `import { KeyObject, createPublicKey, verify } from "node:crypto";
import { ed25519PublicKeyProblem, ed25519SignatureProblem } from ${JSON.stringify(VENDORED)};
const raw = (key) => Buffer.from(key.export({ format: "jwk" }).x ?? "", "base64url");
export function loadEd25519PublicKey(pem) {
  const key = createPublicKey({ key: pem, format: "pem" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("PEM is not an Ed25519 public key");
  const problem = ed25519PublicKeyProblem(raw(key));
  if (problem) throw new Error(problem);
  return key;
}
export function verifyEd25519(key, message, signature) {
  if (!(key instanceof KeyObject)) return { ok: false };
  const problem = ed25519PublicKeyProblem(raw(key)) ?? ed25519SignatureProblem(signature);
  if (problem) return { ok: false, reason: problem };
  return { ok: verify(null, message, key, signature) };
}
`;

const dir = mkdtempSync(join(tmpdir(), "quickstart-"));
after(() => {
  rmSync(dir, { recursive: true, force: true });
});
const pkg = join(dir, "node_modules", "@sovereignos", "verifiable-receipts");
mkdirSync(pkg, { recursive: true });
writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@sovereignos/verifiable-receipts", type: "module", exports: "./index.mjs" }));
writeFileSync(join(pkg, "index.mjs"), STAND_IN);
writeFileSync(join(dir, "verify-signature.mjs"), SAMPLE);
writeFileSync(join(dir, "ed25519.pem"), readText(CONFORMANCE, "public-key.pem"));

const VALID = (JSON.parse(readText(CONFORMANCE, "v2-valid-001.json")) as { receipt: Record<string, string> }).receipt;
const BASE64 = (VALID.signature ?? "").slice("v2=".length);

function run(receipt: unknown): string {
  writeFileSync(join(dir, "receipt.json"), JSON.stringify(receipt));
  return execFileSync(process.execPath, ["verify-signature.mjs", "receipt.json"], { cwd: dir, encoding: "utf8" }).trim();
}

describe("the quickstart's TypeScript sample", () => {
  it("passes the test receipt", () => {
    assert.equal(run(VALID), "true");
  });
  it("refuses any prefix but v2=", () => {
    for (const prefix of ["v9=", "v1=", "v3=", "V2=", ""]) {
      assert.equal(run({ ...VALID, signature: prefix + BASE64 }), "false", prefix);
    }
  });
  it("refuses base64 in any spelling but the canonical one", () => {
    const respelled = [
      BASE64.slice(0, 20) + "\n" + BASE64.slice(20), // a line feed inside
      BASE64.slice(0, 20) + " " + BASE64.slice(20),
      BASE64.replace(/=+$/, ""), // padding dropped
      BASE64.replaceAll("+", "-").replaceAll("/", "_"), // URL-safe alphabet
      BASE64 + "\n",
    ].filter((s) => s !== BASE64);
    assert.ok(respelled.length >= 3);
    for (const sig of respelled) assert.equal(run({ ...VALID, signature: "v2=" + sig }), "false", JSON.stringify(sig));
  });
  it("refuses a changed canonical, and a signature that is not a string", () => {
    assert.equal(run({ ...VALID, canonical: (VALID.canonical ?? "").replace("pass", "fail") }), "false");
    assert.equal(run({ ...VALID, signature: 7 }), "false");
  });
  it("does not check contentHash, as the page says", () => {
    assert.equal(run({ ...VALID, contentHash: "sha256:" + "0".repeat(64) }), "true");
  });
});
