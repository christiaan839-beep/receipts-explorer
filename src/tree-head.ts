// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Checks a signed tree head from a log: the shape that
// schemas/tree-head.schema.json (verifiable-receipts) states, with the
// field checks of bin/witness.mjs's sthShapeError, the canonical text
// rebuilt from the fields, and the log's v2= signature over it.
import type { PublicKey } from "./keys.ts";
import { verifyV2Text, parseV2Signature } from "./signature.ts";
import { canonicalizeSth, isCount, isHashHex, type SignedTreeHead } from "./vendor/verifiable-receipts/transparency.ts";

/** The root of the empty tree: the SHA-256 of no bytes (RFC 6962 section 2.1). */
export const EMPTY_ROOT = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const FIELDS = new Set(["v", "logId", "treeSize", "rootHash", "timestamp", "signature", "canonical"]);
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

/**
 * Control characters (C0, DEL and C1), the line separators U+2028 and
 * U+2029, and the bidirectional controls, which can make a logId read as
 * something other than its bytes. Copied from verifiable-receipts
 * bin/witness.mjs (UNSAFE_TEXT) at VR_REF.
 */
// eslint-disable-next-line no-control-regex -- matching them is the point
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2028\u2029\u2066-\u2069]/;

export type TreeHeadCheck =
  | { status: "passed"; sth: Required<SignedTreeHead>; canonical: string }
  | { status: "failed" | "not-run"; reason: string };

type TreeHeadFields = Omit<SignedTreeHead, "signature">;

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** A real instant, written exactly as Date.prototype.toISOString writes it. */
function isIsoTimestamp(t: unknown): t is string {
  return typeof t === "string" && TIMESTAMP.test(t) && !Number.isNaN(Date.parse(t)) && new Date(t).toISOString() === t;
}

/**
 * The signed fields of `value`, or why they are not a tree head's: the
 * field checks of sthShapeError (verifiable-receipts bin/witness.mjs), in
 * the explorer's words. Shared by checkTreeHead and canonicalTreeHead.
 */
function treeHeadFields(value: Record<string, unknown>): { ok: true; fields: TreeHeadFields } | { ok: false; reason: string } {
  const { v, logId, treeSize, rootHash, timestamp } = value;
  if (v !== 1) return { ok: false, reason: "The tree head is not version 1." };
  if (typeof logId !== "string" || logId === "") return { ok: false, reason: "The tree head has no logId." };
  if (UNSAFE_TEXT.test(logId)) {
    return {
      ok: false,
      reason: "The tree head's logId contains control characters, line separators or text-direction marks, which can make it read as another name.",
    };
  }
  if (!isCount(treeSize)) return { ok: false, reason: "The tree head's treeSize is not a whole number from 0 to 2^53 − 1." };
  if (!isHashHex(rootHash)) return { ok: false, reason: "The tree head's rootHash is not 64 lowercase hex digits." };
  if (treeSize === 0 && rootHash !== EMPTY_ROOT) {
    return { ok: false, reason: "The tree head says the log is empty, but its rootHash is not the empty tree's (the SHA-256 of no bytes)." };
  }
  if (!isIsoTimestamp(timestamp)) {
    return { ok: false, reason: "The tree head's timestamp is not a real time written in the form 2026-10-23T12:00:00.000Z." };
  }
  return { ok: true, fields: { v, logId, treeSize, rootHash, timestamp } };
}

/**
 * The tree head that `text` is the canonical text of: it must parse to
 * exactly v, logId, treeSize, rootHash and timestamp, each well formed, and
 * be byte for byte the text canonicalizeSth rebuilds from them. Used for
 * the text a cosignature covers, which is never trusted as sent.
 */
export function canonicalTreeHead(text: string): TreeHeadFields | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(value)) return undefined;
  const read = treeHeadFields(value);
  if (!read.ok) return undefined;
  return canonicalizeSth(read.fields) === text ? read.fields : undefined;
}

/** Checks `value`, a log's answer to GET /v1/sth, against the log's key. */
export async function checkTreeHead(value: unknown, logKey: PublicKey): Promise<TreeHeadCheck> {
  if (!isObject(value)) return { status: "failed", reason: "The log's answer is not a tree head: it is not a JSON object." };
  for (const field of Object.keys(value)) {
    if (!FIELDS.has(field)) {
      return { status: "failed", reason: `The tree head has a field its signature does not cover: "${field}".` };
    }
  }
  const read = treeHeadFields(value);
  if (!read.ok) return { status: "failed", reason: read.reason };
  const { signature, canonical } = value;
  const parsed = parseV2Signature(signature);
  if (!parsed.ok) {
    if (parsed.problem === "v3") {
      return {
        status: "not-run",
        reason: "This log signs its tree heads with v3= (Ed25519 and ML-DSA-65), which this page cannot check yet. Use the verifiable-receipts library to check it.",
      };
    }
    if (parsed.problem === "bad-length") {
      return {
        status: "failed",
        reason: "The tree head's signature is not 64 bytes long, the size of every Ed25519 signature, so the log sent a damaged signature.",
      };
    }
    return { status: "failed", reason: "The tree head's signature is missing or is not a well-formed v2= signature." };
  }
  const rebuilt = canonicalizeSth(read.fields);
  if (canonical !== undefined && canonical !== rebuilt) {
    return { status: "failed", reason: "The tree head's canonical text does not match its own fields." };
  }
  if (!(await verifyV2Text(signature, rebuilt, logKey))) {
    return {
      status: "failed",
      reason: "The tree head's signature does not verify under the log key you gave. Check that you have this log's key, not the issuer's.",
    };
  }
  return { status: "passed", sth: { ...read.fields, signature: signature as string }, canonical: rebuilt };
}
