// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Signed receipts with one or two changes, of the kinds verifiable-receipts'
// differential corpus makes, for the property tests.
import fc from "fast-check";

/** A body like a real receipt's, with keys in a random order. Strings use all of Unicode, lone surrogates included, so UTF-8 encoding is tested. */
export const body = fc.oneof(
  { arbitrary: plainBody(), weight: 4 },
  // Now and then a field nested near the limit of 64: the canonical (the body is one level) and the receipt.
  { arbitrary: fc.tuple(plainBody(), fc.integer({ min: 61, max: 66 })).map(([d, n]) => ({ ...d, nest: nested(n) })), weight: 1 },
);

function plainBody(): fc.Arbitrary<Record<string, unknown>> {
  return fc
    .dictionary(fc.string({ minLength: 1, maxLength: 8, unit: "binary" }), fc.jsonValue({ maxDepth: 2, stringUnit: "binary" }), { maxKeys: 5 })
    .map((d) => ({ receiptId: "r", ...d }));
}

/** `n` arrays, each holding the next. */
export function nested(n: number): unknown {
  let v: unknown = [];
  for (let i = 1; i < n; i++) v = [v];
  return v;
}

/** One change to a signed receipt, of the kinds the differential corpus makes. */
export const mutation = fc.oneof(
  fc.record({ kind: fc.constant("none" as const) }),
  fc.record({ kind: fc.constant("char" as const), field: fc.constantFrom("canonical", "signature", "contentHash"), pos: fc.nat(), delta: fc.integer({ min: 1, max: 0x7f }) }),
  fc.record({ kind: fc.constant("drop" as const), field: fc.constantFrom("canonical", "signature", "contentHash") }),
  fc.record({ kind: fc.constant("set" as const), field: fc.string({ maxLength: 8 }), value: fc.jsonValue({ maxDepth: 2 }) }),
  fc.record({ kind: fc.constant("respell" as const), suffix: fc.constantFrom("\n", " ", "=", "A") }),
  fc.record({ kind: fc.constant("hash" as const), value: fc.constantFrom("", null, 0, false, "sha256:", "SHA256:", []) }),
  // The same bytes in a spelling no signer writes: the signature's last base64
  // character before "==" with non-zero padding bits, or the content hash in
  // upper case. Every canonical-spelling check then meets one on most runs.
  fc.record({ kind: fc.constant("padbits" as const), low: fc.integer({ min: 1, max: 15 }) }),
  fc.record({ kind: fc.constant("upperhash" as const) }),
  fc.record({ kind: fc.constant("set" as const), field: fc.constantFrom("nest", "extra"), value: fc.integer({ min: 62, max: 66 }).map(nested) }),
);

export type Mutation = { kind: "none" } | { kind: "char"; field: string; pos: number; delta: number } | { kind: "drop"; field: string } | { kind: "set"; field: string; value: unknown } | { kind: "respell"; suffix: string } | { kind: "hash"; value: unknown } | { kind: "padbits"; low: number } | { kind: "upperhash" };

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function mutate(receipt: Record<string, unknown>, m: Mutation): Record<string, unknown> {
  const r = { ...receipt };
  switch (m.kind) {
    case "none":
      return r;
    case "char": {
      const current = r[m.field];
      const text = typeof current === "string" ? current : "";
      if (text === "") return r;
      const i = m.pos % text.length;
      r[m.field] = text.slice(0, i) + String.fromCharCode((text.charCodeAt(i) + m.delta) % 0x80) + text.slice(i + 1);
      return r;
    }
    case "drop":
      return Object.fromEntries(Object.entries(r).filter(([k]) => k !== m.field));
    case "set":
      r[m.field] = m.value;
      return r;
    case "respell":
      r.signature = String(r.signature) + m.suffix;
      return r;
    case "hash":
      r.contentHash = m.value;
      return r;
    case "padbits": {
      // A 64-byte signature ends in one character and "==": that character's low four bits are padding.
      const sig = typeof r.signature === "string" ? r.signature : "";
      const i = sig.length - 3;
      const v = B64.indexOf(sig.charAt(i));
      if (!sig.endsWith("==") || v < 0) return r;
      r.signature = sig.slice(0, i) + B64.charAt((v & 0x30) | m.low) + sig.slice(i + 1);
      return r;
    }
    case "upperhash":
      if (typeof r.contentHash === "string") r.contentHash = r.contentHash.toUpperCase();
      return r;
  }
}
