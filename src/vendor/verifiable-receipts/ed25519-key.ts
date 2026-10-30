// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0
//
// Vendored from verifiable-receipts,
// packages/verifiable-receipts/src/ed25519-key.ts at the commit in
// third_party/verifiable-receipts/VR_REF. Licence:
// third_party/verifiable-receipts/LICENSE.
//
// Changed from the original, so that it runs in a browser: Buffer's hex
// and byte reversal replaced by a local hex and littleEndian, so this
// module imports nothing from the page (src/bytes.ts imports it). Only
// ed25519PublicKeyProblem and ed25519SignatureProblem are ported; their
// checks, order, reasons and per-key cache are the original's.
// verifyEd25519 and loadEd25519PublicKey, which take node:crypto
// KeyObjects, are not: the page verifies with src/bytes.ts ed25519Verify
// (which runs ed25519SignatureProblem first) and reads keys with
// src/keys.ts parsePublicKeys (which runs ed25519PublicKeyProblem), and
// the receipt port's verifyEd25519Strict runs both, in the original order.

/**
 * Ed25519 under the strict profile of VAOS 2.0 section 7.3.
 *
 * A public key must be a canonical encoding of a point of order L: not a
 * point of small order (under which some signatures verify every
 * message), not of mixed order, not off the curve, not a non-canonical
 * encoding. A signature's R must be the same, and its S below L. These
 * are checked before WebCrypto sees the signature: on what passes them,
 * every correct Ed25519 verifier, cofactored or cofactorless, gives the
 * same verdict.
 */
import { L, pointProblem } from "./edwards25519.ts";

/**
 * The encodings of the points of small order, with the sign bit cleared:
 * the libsodium blocklist ("Taming the many EdDSAs", Chalkias et al.). The
 * last two are the non-canonical encodings y = p and y = p + 1.
 */
const SMALL_ORDER_KEYS = new Set([
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0100000000000000000000000000000000000000000000000000000000000000",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
]);

const P = 2n ** 255n - 19n;

/** The reason a signature that fails is rejected with, here and in Python and Go. */
export const DOES_NOT_VERIFY = "signature does not verify under the supplied public key";

/** Answers of ed25519PublicKeyProblem, by key; a key's answer never changes. */
const keyProblems = new Map<string, string | null>();
const KEY_CACHE_SIZE = 256;

const hex = (data: Uint8Array): string => Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");

function littleEndian(data: Uint8Array): bigint {
  let n = 0n;
  for (let i = data.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(data[i] ?? 0);
  return n;
}

/**
 * Why a raw 32-byte Ed25519 public key is refused (VAOS 2.0 section 7.3),
 * or null. In order: "public key is not 32 bytes"; "public key is a
 * small-order point" (the blocklist, sign bit cleared); "public key is
 * not a canonical encoding" (y of p or more); "public key is not a point
 * on the curve"; "public key is a small-order point"; "public key is not
 * in the prime-order subgroup" (mixed order). The same reasons as the
 * Python and Go verifiers. Answers are cached per key.
 */
export function ed25519PublicKeyProblem(raw: Uint8Array): string | null {
  if (raw.length !== 32) return "public key is not 32 bytes";
  const key = hex(raw);
  const cached = keyProblems.get(key);
  if (cached !== undefined) return cached;
  const cleared = raw.slice();
  cleared[31] = (cleared[31] ?? 0) & 0x7f;
  let problem: string | null;
  if (SMALL_ORDER_KEYS.has(hex(cleared))) {
    problem = "public key is a small-order point";
  } else if (littleEndian(cleared) >= P) {
    problem = "public key is not a canonical encoding";
  } else {
    const p = pointProblem(raw);
    problem = p === null ? null : `public key is ${p}`;
  }
  if (keyProblems.size >= KEY_CACHE_SIZE) keyProblems.clear();
  keyProblems.set(key, problem);
  return problem;
}

/**
 * Why a 64-byte Ed25519 signature is rejected before the signature check
 * (VAOS 2.0 section 7.3), or null: its R (first 32 bytes) must be a
 * canonical encoding of a point on the curve that is not of small order
 * (the identity included) and is in the prime-order subgroup ("signature
 * R is not a canonical encoding", "... is not a point on the curve",
 * "... is a small-order point", "... is not in the prime-order
 * subgroup"); and its S (last 32, little-endian) must be below L. A wrong
 * length or an S of L or more has the reason a failed check has. R is
 * never cached.
 */
export function ed25519SignatureProblem(signature: Uint8Array): string | null {
  if (signature.length !== 64) return DOES_NOT_VERIFY;
  const problem = pointProblem(signature.subarray(0, 32));
  if (problem !== null) return `signature R is ${problem}`;
  if (littleEndian(signature.subarray(32)) >= L) return DOES_NOT_VERIFY;
  return null;
}
