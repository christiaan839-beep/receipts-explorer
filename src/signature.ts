// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// The v2= signature wire format (docs/specs/vaos-2.0.md section 7):
// "v2=" and the standard, padded base64 of a 64-byte Ed25519 signature,
// in its one valid spelling. Used for receipts, tree heads and
// cosignatures.
import { ed25519Verify, fromBase64, utf8 } from "./bytes.ts";
import type { PublicKey } from "./keys.ts";

const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
// The one shape of a v3= signature (verifiable-receipts bin/witness.mjs,
// V3_SIGNATURE, at VR_REF): a 64-byte Ed25519 half, ".", and a 3,309-byte
// ML-DSA-65 half. Anything else after "v3=" is not a v3= signature, and
// is reported as not a v2= one.
const V3_SIGNATURE = /^v3=[A-Za-z0-9+/]{85}[AQgw]==\.[A-Za-z0-9+/]{4412}$/;
const ED25519_SIGNATURE_BYTES = 64;

export type ParsedSignature =
  | { ok: true; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; problem: "missing" | "v3" | "not-v2" | "bad-base64" | "not-canonical" | "bad-length" };

export function parseV2Signature(signature: unknown): ParsedSignature {
  if (typeof signature !== "string" || signature === "") return { ok: false, problem: "missing" };
  if (V3_SIGNATURE.test(signature)) return { ok: false, problem: "v3" };
  if (!signature.startsWith("v2=")) return { ok: false, problem: "not-v2" };
  const body = signature.slice(3);
  if (!STANDARD_BASE64.test(body)) return { ok: false, problem: "bad-base64" };
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    // Once the pattern has passed, fromBase64 throws only for a spelling with non-zero padding bits.
    bytes = fromBase64(body);
  } catch {
    return { ok: false, problem: "not-canonical" };
  }
  return bytes.length === ED25519_SIGNATURE_BYTES ? { ok: true, bytes } : { ok: false, problem: "bad-length" };
}

/** True iff `signature` is a well-spelled v2= signature over the UTF-8 bytes of `text` under `key`. */
export async function verifyV2Text(signature: unknown, text: string, key: PublicKey): Promise<boolean> {
  const parsed = parseV2Signature(signature);
  return parsed.ok && (await ed25519Verify(key.key, parsed.bytes, utf8(text)));
}
