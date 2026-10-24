// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Bytes for the browser: UTF-8, hex, base64 and SHA-256, with WebCrypto
// and no Buffer, so the same code runs in a page and under node --test.

const encoder = new TextEncoder();

/** The UTF-8 bytes of `text`; a lone surrogate becomes U+FFFD, as in Buffer.from. */
export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text);
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

const HEX = /^(?:[0-9a-fA-F]{2})*$/;
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Decodes hex of even length; throws on any other character, an odd length or whitespace. */
export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (!HEX.test(hex)) throw new TypeError("not hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/**
 * Decodes standard, padded base64; throws on any other character, whitespace,
 * missing or extra padding, or a spelling with non-zero padding bits.
 */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  if (!STANDARD_BASE64.test(text)) throw new TypeError("not standard base64");
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  if (toBase64(out) !== text) throw new TypeError("not the one spelling of these bytes");
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** SHA-256 of the parts, concatenated, as 64 lowercase hex digits. */
export async function sha256Hex(...parts: readonly Uint8Array[]): Promise<string> {
  let length = 0;
  for (const p of parts) length += p.length;
  const all = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", all)));
}

/** This browser's WebCrypto cannot verify Ed25519: no check that needs it can run. */
export class Ed25519Unavailable extends Error {
  constructor() {
    super("This browser cannot check Ed25519 signatures. Use a current version of Firefox, Chrome, Edge or Safari.");
  }
}

/** True for the errors WebCrypto gives when it has no Ed25519 at all. */
export function isUnsupported(e: unknown): boolean {
  return e instanceof DOMException && e.name === "NotSupportedError";
}

/**
 * Ed25519 verification. Answers false, never throws, for a malformed
 * signature or a key of another kind; throws Ed25519Unavailable when this
 * browser cannot verify Ed25519 at all, so the caller reports "not run",
 * never "failed".
 */
export async function ed25519Verify(key: CryptoKey, signature: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<boolean> {
  if (typeof crypto === "undefined" || typeof crypto.subtle === "undefined") throw new Ed25519Unavailable();
  try {
    return await crypto.subtle.verify({ name: "Ed25519" }, key, signature, data);
  } catch (e) {
    if (isUnsupported(e)) throw new Ed25519Unavailable();
    return false;
  }
}
