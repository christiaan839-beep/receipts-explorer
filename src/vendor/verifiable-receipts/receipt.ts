// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0
//
// Vendored from verifiable-receipts,
// packages/verifiable-receipts/conformance/verify-v2.mjs at the commit in
// third_party/verifiable-receipts/VR_REF. Licence:
// third_party/verifiable-receipts/LICENSE.
//
// Changed from the original, so that it runs in a browser: converted to
// TypeScript; node:crypto and Buffer replaced by WebCrypto and ../../bytes.ts,
// so verifyV2Receipt is async and takes a WebCrypto CryptoKey; the
// non-canonical base64 test is fromBase64's round trip, caught here; the
// public key's 32 bytes are read with WebCrypto's raw export instead of the
// JWK x, so the key must be extractable (parsePublicKeys makes it so); the
// strict checks of step 4 (the original's rawKeyProblem, pointProblem and
// signatureProblem, with their edwards25519 arithmetic) are the library's
// ed25519PublicKeyProblem and ed25519SignatureProblem, ported beside this
// file from src/ed25519-key.ts and src/edwards25519.ts, which have the same
// constants, checks, order and reasons, so that src/keys.ts and
// src/bytes.ts refuse the same keys and signatures with the same code; the
// signature-mismatch reason exported as SIGNATURE_MISMATCH_REASON;
// verifyEd25519Strict is async and verifies with WebCrypto. When the
// browser has no WebCrypto Ed25519, verifyV2Receipt and
// verifyEd25519Strict throw Ed25519Unavailable instead of answering. No
// change to the checks, their order or their failure reasons.
// Changed in the comments only: the opening paragraph, on the conformance
// harness that uses the original, is rewritten for this port; the
// original's sentence on Go's Receipt.UnmarshalJSON, its paragraph on
// integers beyond 2^53 in the Python and Go verifiers, and parseReceipt's
// mention of Python's parse_receipt and Go's ParseReceipt are dropped,
// since they describe the other verifiers; and the JSDoc @param and
// @returns tags of parseReceipt and verifyV2Receipt are dropped, since
// TypeScript states the types; the original's paragraph saying its
// edwards25519 arithmetic is written out apart from the library's is
// dropped, since this port uses the library's.

/**
 * The v2 (Ed25519) receipt verifier of the verifiable-receipts conformance
 * corpus. It makes these checks, in this order:
 *
 *   0. The receipt nests at most 64 deep (VAOS 2.0 §7.2): the receipt
 *      object is one level, and each array or object in it one more.
 *   1. `canonical` and `signature` are non-empty strings.
 *   2. `signature` is "v2=<base64>" with standard base64.
 *   3. `contentHash`, when present and not null, is a string equal to
 *      the hex SHA-256 of `canonical`'s UTF-8 bytes ("sha256:" prefix
 *      optional); an empty string is a mismatch, not an absent field.
 *   4. The public key is a canonical encoding of a point of order L:
 *      not of small order, not of mixed order, not off the curve
 *      (VAOS 2.0 §7.3; checked right after step 2). The signature's R
 *      is the same, and its S is below L, checked before WebCrypto
 *      sees it; then the Ed25519 signature verifies over `canonical`'s
 *      UTF-8 bytes, exactly as given.
 *   5. `canonical` nests at most 64 deep, counted on its text before it
 *      is parsed, and parses as a JSON object.
 *   6. Every other top-level field of the receipt equals the same field
 *      of that object (deep JSON-value equality); a field that
 *      disagrees, or that the canonical lacks, is rejected.
 *
 * jsonEqual below recurses at most 64 deep, and the depth checks walk an
 * explicit stack, so no input can overflow the call stack.
 */
import { Ed25519Unavailable, ed25519Verify, fromBase64, isUnsupported, sha256Hex, utf8 } from "../../bytes.ts";
import { DOES_NOT_VERIFY, ed25519PublicKeyProblem, ed25519SignatureProblem } from "./ed25519-key.ts";

const ENVELOPE_ONLY = new Set(["canonical", "contentHash", "signature"]);

const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const SIGNATURE_MISMATCH_REASON = DOES_NOT_VERIFY;

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Why the Ed25519 public key is refused (VAOS 2.0 §7.3), or null. A key
 * that is not Ed25519, or not 32 bytes, is left to the signature check,
 * which fails.
 */
async function ed25519KeyProblem(publicKey: CryptoKey): Promise<string | null> {
  if (publicKey.algorithm.name !== "Ed25519") return null;
  if (!publicKey.extractable) throw new TypeError("verifyV2Receipt needs an extractable key, to check it is not weak");
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
  return raw.length === 32 ? ed25519PublicKeyProblem(raw) : null;
}

/**
 * One Ed25519 signature under the strict profile of VAOS 2.0 §7.3: the
 * key, then R and S, then WebCrypto's check. `publicKey`, `message` and
 * `signature` are bytes (the raw key and R || S).
 */
export async function verifyEd25519Strict(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<VerifyResult> {
  for (const arg of [publicKey, message, signature]) {
    if (!(arg instanceof Uint8Array)) return { ok: false, reason: DOES_NOT_VERIFY };
  }
  const keyProblem = ed25519PublicKeyProblem(publicKey);
  if (keyProblem) return { ok: false, reason: keyProblem };
  const sig = new Uint8Array(signature);
  const sigProblem = ed25519SignatureProblem(sig);
  if (sigProblem) return { ok: false, reason: sigProblem };
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("raw", new Uint8Array(publicKey), { name: "Ed25519" }, false, ["verify"]);
  } catch (e) {
    if (isUnsupported(e)) throw new Ed25519Unavailable();
    return { ok: false, reason: DOES_NOT_VERIFY };
  }
  const ok = await ed25519Verify(key, sig, new Uint8Array(message));
  return ok ? { ok: true } : { ok: false, reason: DOES_NOT_VERIFY };
}

/** The nesting limit of VAOS 2.0 §7.2. */
export const MAX_NESTING = 64;

/**
 * Whether `value` nests deeper than MAX_NESTING: `value` is one level
 * when it is an array or object, and each array or object inside it one
 * more. Walks an explicit stack, so it cannot overflow the call stack.
 */
export function nestsTooDeep(value: unknown): boolean {
  const stack: [unknown, number][] = [[value, 1]];
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    const [v, level] = top;
    if (v === null || typeof v !== "object") continue;
    if (level > MAX_NESTING) return true;
    for (const child of Array.isArray(v) ? (v as unknown[]) : Object.values(v)) {
      if (child !== null && typeof child === "object") stack.push([child, level + 1]);
    }
  }
  return false;
}

/**
 * Whether JSON text opens more than MAX_NESTING arrays and objects at
 * once, read from the start, valid JSON or not: outside strings `[` and
 * `{` open one and `]` and `}` close one (when one is open); a string
 * runs from `"` to the next `"` not escaped by `\`.
 */
export function textNestsTooDeep(text: string): boolean {
  let open = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === "[" || c === "{") {
      if (++open > MAX_NESTING) return true;
    } else if ((c === "]" || c === "}") && open > 0) {
      open--;
    }
  }
  return false;
}

/**
 * Deep JSON-value equality; object key order does not matter. A number of
 * magnitude 2^53 or more equals nothing: JSON.parse reads 2^53 + 1 as
 * 2^53, so such a number in a repeated field is rejected in every
 * verifier rather than compared differently.
 *
 * Bounded at MAX_NESTING: `depth` is the level of `a` and `b` (1 at the
 * top), and arrays or objects deeper than MAX_NESTING equal nothing, so
 * no input, even from a caller other than verifyV2Receipt, recurses
 * deeper than that.
 */
export function jsonEqual(a: unknown, b: unknown, depth = 1): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      depth <= MAX_NESTING &&
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x: unknown, i: number) => jsonEqual(x, b[i], depth + 1))
    );
  }
  if (isObject(a) || isObject(b)) {
    if (depth > MAX_NESTING || !isObject(a) || !isObject(b)) return false;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k], b[k], depth + 1));
  }
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a) < 2 ** 53 && Math.abs(b) < 2 ** 53 && a === b;
  }
  return a === b; // null, booleans, strings
}

/**
 * Reads a receipt from JSON text, counting its depth on the text first
 * (VAOS 2.0 §7.2), so a duplicate key that JSON.parse discards still
 * counts. Throws an Error whose message is the reason: "receipt nesting
 * deeper than 64", "receipt is not valid JSON" or "receipt is not a JSON
 * object".
 */
export function parseReceipt(text: string): Record<string, unknown> {
  if (textNestsTooDeep(text)) throw new Error("receipt nesting deeper than 64");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("receipt is not valid JSON");
  }
  if (!isObject(value)) throw new Error("receipt is not a JSON object");
  return value;
}

export async function verifyV2Receipt(receipt: unknown, publicKey: CryptoKey): Promise<VerifyResult> {
  if (!isObject(receipt)) return { ok: false, reason: "receipt must be an object" };
  if (nestsTooDeep(receipt)) return { ok: false, reason: "receipt nesting deeper than 64" };
  const { canonical, signature, contentHash } = receipt;
  if (typeof canonical !== "string" || canonical === "") {
    return { ok: false, reason: "missing canonical projection" };
  }
  if (typeof signature !== "string" || signature === "") {
    return { ok: false, reason: "missing signature" };
  }
  if (!signature.startsWith("v2=")) {
    return { ok: false, reason: "signature is not v2 (expected 'v2=<base64>')" };
  }
  if (!STANDARD_BASE64.test(signature.slice(3))) {
    return { ok: false, reason: "signature base64 invalid" };
  }
  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    // Reject non-canonical spellings (non-zero padding bits): fromBase64
    // throws for them, and only for them once the pattern above has passed.
    sigBytes = fromBase64(signature.slice(3));
  } catch {
    return { ok: false, reason: "signature base64 invalid: not canonical" };
  }
  const keyProblem = await ed25519KeyProblem(publicKey);
  if (keyProblem) return { ok: false, reason: keyProblem };
  const canonicalBytes = utf8(canonical);

  if (contentHash != null && typeof contentHash !== "string") {
    return { ok: false, reason: "contentHash must be a string" };
  }
  if (contentHash != null) {
    const actual = await sha256Hex(canonicalBytes);
    if (actual !== contentHash.replace(/^sha256:/, "")) {
      return { ok: false, reason: "contentHash mismatch with canonical bytes" };
    }
  }

  // VAOS 2.0 §7.3: R and S are checked before WebCrypto sees them.
  const sigProblem = ed25519SignatureProblem(sigBytes);
  if (sigProblem) return { ok: false, reason: sigProblem };
  if (!(await ed25519Verify(publicKey, sigBytes, canonicalBytes))) {
    return { ok: false, reason: SIGNATURE_MISMATCH_REASON };
  }

  // Only now parse the canonical: these bytes are authenticated.
  if (textNestsTooDeep(canonical)) {
    return { ok: false, reason: "canonical nesting deeper than 64" };
  }
  let signed: unknown;
  try {
    signed = JSON.parse(canonical);
  } catch {
    return { ok: false, reason: "canonical is not valid JSON" };
  }
  if (!isObject(signed)) {
    return { ok: false, reason: "canonical is not a JSON object" };
  }
  for (const key of Object.keys(receipt).sort()) {
    if (ENVELOPE_ONLY.has(key)) continue;
    if (!Object.hasOwn(signed, key)) {
      return {
        ok: false,
        reason: `envelope field "${key}" is not in the signed canonical`,
      };
    }
    if (!jsonEqual(receipt[key], signed[key])) {
      return {
        ok: false,
        reason: `envelope field "${key}" disagrees with the signed canonical`,
      };
    }
  }
  return { ok: true };
}
