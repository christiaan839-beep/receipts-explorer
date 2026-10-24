// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

import { parsePublicKeys, type PublicKey } from "../src/keys.ts";
import { parseReceipt } from "../src/vendor/verifiable-receipts/receipt.ts";

export const CONFORMANCE = new URL("./fixtures/conformance/", import.meta.url);
export const LOG = new URL("./fixtures/log/", import.meta.url);

export function readText(dir: URL, name: string): string {
  return readFileSync(new URL(name, dir), "utf8");
}

export function readJson(dir: URL, name: string): unknown {
  return JSON.parse(readText(dir, name));
}

export async function keyFrom(dir: URL, name: string): Promise<PublicKey> {
  const [key] = await parsePublicKeys(readText(dir, name), name);
  if (key === undefined) throw new Error(`no key in ${name}`);
  return key;
}

export function fixtureReceipt(name: string): unknown {
  const fixture = readJson(CONFORMANCE, name) as { receipt: unknown };
  return fixture.receipt;
}

/** A fresh Ed25519 key pair, with the public half as PEM. */
export async function makeKey(): Promise<{ privateKey: CryptoKey; pem: string; publicKey: PublicKey }> {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const b64 = Buffer.from(der).toString("base64");
  const pem = `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----\n`;
  const [publicKey] = await parsePublicKeys(pem, "test key");
  if (publicKey === undefined) throw new Error("no key");
  return { privateKey: pair.privateKey, pem, publicKey };
}

/** Signs `body` as a v2 receipt: canonical, contentHash, signature, and the body's fields repeated beside them. */
export async function signReceipt(body: Record<string, unknown>, privateKey: CryptoKey): Promise<Record<string, unknown>> {
  const canonical = JSON.stringify(body);
  const bytes = new TextEncoder().encode(canonical);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, bytes));
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
  return { ...body, canonical, contentHash: `sha256:${hash}`, signature: `v2=${Buffer.from(sig).toString("base64")}` };
}

export interface ConformanceCase {
  /** The receipt; a receipt given as text (receiptText) is read with the port's parseReceipt, which may throw its reason. */
  receipt: () => unknown;
  /** public-key.pem, or the fixture's own publicKeyPem, imported as is: weak keys included, which parsePublicKeys refuses. */
  key: PublicKey;
  expected: { ok: boolean; reasonContains?: string };
}

/** A v2 conformance fixture, read as verifiable-receipts' own harness reads it. */
export async function conformanceCase(name: string): Promise<ConformanceCase> {
  const f = readJson(CONFORMANCE, name) as { receipt?: unknown; receiptText?: string; publicKeyPem?: string; expected: ConformanceCase["expected"] };
  const pem = f.publicKeyPem ?? readText(CONFORMANCE, "public-key.pem");
  const der = Buffer.from(pem.replace(/-----[A-Z ]+-----|\s/g, ""), "base64");
  const key = await crypto.subtle.importKey("spki", der, { name: "Ed25519" }, true, ["verify"]);
  const fingerprint = "sha256:" + Buffer.from(await crypto.subtle.digest("SHA-256", der)).toString("hex").slice(0, 16);
  const text = f.receiptText;
  return { receipt: () => (text === undefined ? f.receipt : parseReceipt(text)), key: { key, fingerprint }, expected: f.expected };
}
