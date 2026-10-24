// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Ed25519Unavailable } from "../src/bytes.ts";
import { KeyError, parsePublicKeys } from "../src/keys.ts";
import { CONFORMANCE, makeKey, readText } from "./helpers.ts";

const PEM = readText(CONFORMANCE, "public-key.pem");
const PRIVATE = ["PRIVATE", "KEY"].join(" ");

describe("parsePublicKeys", () => {
  it("reads the conformance key and names it as verify-receipts-action does", async () => {
    const [k, ...rest] = await parsePublicKeys(PEM, "The issuer key");
    assert.ok(k);
    assert.equal(rest.length, 0);
    // sha256 of the SPKI DER, first 16 hex characters.
    const der = Buffer.from(PEM.replace(/-----[A-Z ]+-----|\s/g, ""), "base64");
    const want = "sha256:" + Buffer.from(await crypto.subtle.digest("SHA-256", der)).toString("hex").slice(0, 16);
    assert.equal(k.fingerprint, want);
  });

  it("reads several blocks, drops repeats, and keeps their order", async () => {
    const [a, b] = [await makeKey(), await makeKey()];
    const keys = await parsePublicKeys(`${a.pem}\n${b.pem}\n${a.pem}`, "The witness keys");
    assert.deepEqual(
      keys.map((k) => k.fingerprint),
      [a.publicKey.fingerprint, b.publicKey.fingerprint],
    );
  });

  it("returns no keys for empty text", async () => {
    assert.deepEqual(await parsePublicKeys("  \n", "The log key"), []);
  });

  it("refuses a key of small order, such as the identity", async () => {
    const identity = Buffer.from("302a300506032b6570032100" + "01" + "00".repeat(31), "hex").toString("base64");
    await assert.rejects(
      parsePublicKeys(`-----BEGIN PUBLIC KEY-----\n${identity}\n-----END PUBLIC KEY-----`, "The issuer key"),
      (e: unknown) => e instanceof KeyError && e.message.includes("small order"),
    );
  });

  it("refuses a non-canonical key encoding (y = p + 3), as the verifier does", async () => {
    const y = Buffer.from("302a300506032b6570032100" + "f0" + "ff".repeat(30) + "7f", "hex").toString("base64");
    await assert.rejects(
      parsePublicKeys(`-----BEGIN PUBLIC KEY-----\n${y}\n-----END PUBLIC KEY-----`, "The issuer key"),
      (e: unknown) => e instanceof KeyError && e.message.includes("public key is not a canonical encoding"),
    );
  });

  it("refuses a key with bytes after it, which Node would accept and browsers would not", async () => {
    const der = Buffer.from(PEM.replace(/-----[A-Z ]+-----|\s/g, ""), "base64");
    const longer = Buffer.concat([der, Buffer.from([0])]).toString("base64");
    await assert.rejects(
      parsePublicKeys(`-----BEGIN PUBLIC KEY-----\n${longer}\n-----END PUBLIC KEY-----`, "The issuer key"),
      (e: unknown) => e instanceof KeyError && e.message.includes("is damaged"),
    );
  });

  it("says this browser cannot read Ed25519 keys, not that the key is damaged, when WebCrypto has no Ed25519", async () => {
    const original = crypto.subtle.importKey.bind(crypto.subtle);
    crypto.subtle.importKey = (() => Promise.reject(new DOMException("no Ed25519", "NotSupportedError"))) as typeof crypto.subtle.importKey;
    try {
      await assert.rejects(parsePublicKeys(PEM, "The issuer key"), Ed25519Unavailable);
    } finally {
      crypto.subtle.importKey = original;
    }
  });

  for (const [name, text, message] of [
    // Built from parts so secret scanners do not flag a key that has no key material.
    ["a private key", `-----BEGIN ${PRIVATE}-----\nMC4CAQAwBQYDK2VwBCIEIA==\n-----END ${PRIVATE}-----`, /private key\. Paste the matching public key/],
    ["a certificate", "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----", /is a "CERTIFICATE"/],
    ["a damaged key", PEM.replace("MCow", "MCox"), /not an Ed25519 public key, or is damaged/],
    ["no PEM block", "MCowBQYDK2VwAyEA", /has no PEM block/],
    ["a truncated second block", `${PEM}\n-----BEGIN PUBLIC KEY-----\nMCowBQYDK2Vw`, /block 2, has no -----END PUBLIC KEY----- line/],
    ["mismatched labels", PEM.replace("-----END PUBLIC KEY-----", "-----END CERTIFICATE-----"), /begins "PUBLIC KEY" but ends "CERTIFICATE"/],
    ["an END with no BEGIN", `-----END PUBLIC KEY-----\n${PEM}`, /no BEGIN line before it/],
    ["junk before the block", `key: ${PEM}`, /text outside its PEM blocks/],
    ["junk after the block", `${PEM}\nthanks`, /text outside its PEM blocks/],
    ["junk between blocks", `${PEM}\n--\n${PEM}`, /text outside its PEM blocks/],
    ["a body with non-zero padding bits", PEM.replace("Aok=", "Aol="), /is damaged/],
    ["an RSA key", "-----BEGIN PUBLIC KEY-----\nMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAMvvHOFlR0GdV+ZFzOPWHwm1yflxQHwRJuS1J8y6xG4w2zoV+NS3Me6U5w3XrN6gI0Hf6zWbfvK7w+6s5z6kGkECAwEAAQ==\n-----END PUBLIC KEY-----", /not an Ed25519 public key/],
  ] as const) {
    it(`rejects ${name} with a message that says what to do`, async () => {
      await assert.rejects(parsePublicKeys(text, "The issuer key"), (e: unknown) => e instanceof KeyError && message.test(e.message));
    });
  }
});
