// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// The seven checks, in order. Each result is passed, failed or not run;
// a check that cannot run (no key, no log address, the log unreachable)
// is never shown as passed, and a network error is never a verdict.
// Checks 1 to 4 agree with the vendored verifier: a receipt passes all
// four exactly when verifyV2Receipt accepts it (test/checks.test.ts).
import { Ed25519Unavailable, sha256Hex, utf8, ed25519Verify } from "./bytes.ts";
import type { PublicKey } from "./keys.ts";
import { logError, type LogClient } from "./log-client.ts";
import { parseV2Signature, verifyV2Text } from "./signature.ts";
import { canonicalTreeHead, checkTreeHead, type TreeHeadCheck } from "./tree-head.ts";
import { MAX_NESTING, jsonEqual, nestsTooDeep, textNestsTooDeep, verifyV2Receipt, weakKeyReason } from "./vendor/verifiable-receipts/receipt.ts";
import { leafHash, verifyInclusionProof } from "./vendor/verifiable-receipts/transparency.ts";

export type Status = "passed" | "failed" | "not-run";
export type CheckId = "format" | "signature" | "content-hash" | "repeated-fields" | "tree-head" | "in-log" | "witnesses";

export interface CheckResult {
  id: CheckId;
  status: Status;
  /** One sentence on this result: what passed, or what is wrong and what to do. */
  detail: string;
  /** True when the check did not run because a request to the log did not complete. */
  network: boolean;
  /** True when asking the log again may give an answer: a network error, or the log was busy or failing (5xx). */
  retry: boolean;
}

export interface RepeatedField {
  field: string;
  beside: unknown;
  signed: unknown;
  same: boolean;
}

export interface ReceiptReport {
  checks: CheckResult[];
  /** The vendored verifier's verdict, and the fingerprint of the key it passed under. */
  valid: boolean;
  key: string | undefined;
  /** The signed canonical, parsed; present only when the signature verified. */
  action: Record<string, unknown> | undefined;
  repeated: RepeatedField[];
}

export interface LogInputs {
  client: LogClient;
  logKey: PublicKey | undefined;
  witnessKeys: readonly PublicKey[];
}

export interface Inputs {
  issuerKeys: readonly PublicKey[];
  log: LogInputs | undefined;
}

const ENVELOPE_ONLY = new Set(["canonical", "contentHash", "signature"]);

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function result(id: CheckId, status: Status, detail: string, network = false, retry = network): CheckResult {
  return { id, status, detail, network, retry };
}

/** Check `id` not run because the log answered `status` instead of 200; 5xx answers can be retried. */
function logAnswered(id: CheckId, status: number, body: unknown): CheckResult {
  if (status >= 500) {
    return result(id, "not-run", `Not run: the log is busy or failing (it answered ${String(status)}: ${logError(body)}). Try again in a minute.`, false, true);
  }
  return result(id, "not-run", `Not run: the log answered ${String(status)} (${logError(body)}). Check the log address.`);
}

/** A JSON value for a message: compact, and cut to 120 characters. */
export function show(value: unknown): string {
  const text = value === undefined ? "nothing" : JSON.stringify(value);
  return text.length > 120 ? text.slice(0, 117) + "..." : text;
}

function formatCheck(receipt: unknown): CheckResult {
  const id = "format";
  if (!isObject(receipt)) {
    return result(id, "failed", "This is not a receipt: a receipt is a JSON object with canonical and signature fields. Check that you pasted the receipt, not a key or a tree head.");
  }
  if (nestsTooDeep(receipt)) {
    return result(id, "failed", `The receipt nests arrays and objects more than ${String(MAX_NESTING)} levels deep (receipt nesting deeper than 64), which no verifier accepts. It is not a valid receipt.`);
  }
  if (typeof receipt.canonical !== "string" || receipt.canonical === "") {
    return result(id, "failed", "The receipt has no canonical text, so there is nothing to check. Check that the file is a whole receipt.");
  }
  const parsed = parseV2Signature(receipt.signature);
  if (parsed.ok) return result(id, "passed", "A v2 receipt, with its signature in the one valid spelling.");
  switch (parsed.problem) {
    case "missing":
      return result(id, "failed", "The receipt has no signature. Check that the file is a whole receipt.");
    case "v3":
      return result(id, "failed", "This is a v3 receipt (Ed25519 and ML-DSA-65). This page checks v2 receipts; use the verifiable-receipts library for v3.");
    case "not-v2":
      return result(id, "failed", "The signature does not start with v2=, so this is not a v2 receipt.");
    case "bad-base64":
      return result(id, "failed", "The signature is not valid base64 after v2=. A copy that broke the line or dropped characters causes this; copy the receipt again.");
    case "not-canonical":
      return result(id, "failed", "The signature is spelled in a way no signer writes (non-zero padding bits). The bytes may be right, but the receipt was edited; get the original.");
    case "bad-length":
      return result(id, "failed", "The signature is the wrong size: an Ed25519 signature is 64 bytes. A copy that dropped or added characters causes this; copy the receipt again.");
  }
}

async function signatureCheck(receipt: unknown, format: CheckResult, keys: readonly PublicKey[]): Promise<{ check: CheckResult; key: string | undefined }> {
  const id = "signature";
  if (format.status !== "passed" || !isObject(receipt) || typeof receipt.canonical !== "string") {
    return { check: result(id, "not-run", "Not run: the receipt's format is wrong."), key: undefined };
  }
  if (keys.length === 0) {
    return { check: result(id, "not-run", "Not run: give the issuer's public key to check the signature."), key: undefined };
  }
  const parsed = parseV2Signature(receipt.signature);
  if (!parsed.ok) return { check: result(id, "not-run", "Not run: the receipt's format is wrong."), key: undefined };
  const refused: string[] = [];
  for (const k of keys) {
    // The verifier refuses a weak key before it verifies anything (VAOS 2.0 §7.3).
    const weak = k.key.algorithm.name === "Ed25519" ? weakKeyReason(new Uint8Array(await crypto.subtle.exportKey("raw", k.key))) : null;
    if (weak !== null) {
      refused.push(`${k.fingerprint} (${weak})`);
      continue;
    }
    if (await ed25519Verify(k.key, parsed.bytes, utf8(receipt.canonical))) {
      return { check: result(id, "passed", `Signed by the key ${k.fingerprint}.`), key: k.fingerprint };
    }
  }
  if (refused.length === keys.length) {
    return { check: result(id, "failed", `The key is refused: ${refused.join(", ")}. Under such a key forged signatures verify; get the issuer's real key.`), key: undefined };
  }
  const tried = keys.map((k) => k.fingerprint).join(", ");
  return {
    check: result(id, "failed", `This key does not match the signature (tried ${tried}). Check that you have the issuer's key, not the log's, and that nobody changed the canonical text.`),
    key: undefined,
  };
}

async function contentHashCheck(receipt: unknown): Promise<CheckResult> {
  const id = "content-hash";
  if (!isObject(receipt) || typeof receipt.canonical !== "string" || receipt.canonical === "") {
    return result(id, "not-run", "Not run: the receipt has no canonical text.");
  }
  const { contentHash } = receipt;
  if (contentHash === undefined || contentHash === null) {
    return result(id, "not-run", "Not run: the receipt has no contentHash. The signature covers the text on its own.");
  }
  if (contentHash === "") {
    return result(id, "failed", "The contentHash is empty. A receipt either has no contentHash or has the hash of its signed text; this one was edited, so get the original.");
  }
  if (typeof contentHash !== "string") return result(id, "failed", "The contentHash is not text, so it cannot be a hash. The receipt was edited; get the original.");
  const actual = await sha256Hex(utf8(receipt.canonical));
  if (actual === contentHash.replace(/^sha256:/, "")) return result(id, "passed", `The SHA-256 of the signed text is ${actual}.`);
  return result(id, "failed", `The contentHash does not match the signed text: the text hashes to ${actual}. The text or the hash was changed after signing.`);
}

function repeatedFieldsCheck(receipt: unknown, signature: CheckResult): { check: CheckResult; action: Record<string, unknown> | undefined; repeated: RepeatedField[] } {
  const id = "repeated-fields";
  if (signature.status !== "passed" || !isObject(receipt) || typeof receipt.canonical !== "string") {
    return { check: result(id, "not-run", "Not run: the signature did not verify, so the signed text cannot be trusted to compare against."), action: undefined, repeated: [] };
  }
  if (textNestsTooDeep(receipt.canonical)) {
    return { check: result(id, "failed", `The signed text nests arrays and objects more than ${String(MAX_NESTING)} levels deep (canonical nesting deeper than 64), which no verifier accepts. The issuer signed something that is not a receipt.`), action: undefined, repeated: [] };
  }
  let signed: unknown;
  try {
    signed = JSON.parse(receipt.canonical);
  } catch {
    return { check: result(id, "failed", "The signed text is not valid JSON, so no field can be compared. The issuer signed something that is not a receipt."), action: undefined, repeated: [] };
  }
  if (!isObject(signed)) {
    return { check: result(id, "failed", "The signed text is not a JSON object, so no field can be compared. The issuer signed something that is not a receipt."), action: undefined, repeated: [] };
  }
  const repeated: RepeatedField[] = [];
  let problem: string | undefined;
  for (const field of Object.keys(receipt).sort()) {
    if (ENVELOPE_ONLY.has(field)) continue;
    const present = Object.hasOwn(signed, field);
    const same = present && jsonEqual(receipt[field], signed[field]);
    repeated.push({ field, beside: receipt[field], signed: present ? signed[field] : undefined, same });
    if (problem !== undefined) continue;
    if (!present) {
      problem = `The field "${field}" beside the signed text is not in the signed text, so nothing vouches for it. Read the values from the signed text below.`;
    } else if (!same) {
      problem = `The field "${field}" says ${show(receipt[field])} beside the signed text, but the signed text says ${show(signed[field])}. Trust the signed text.`;
    }
  }
  if (problem !== undefined) return { check: result(id, "failed", problem), action: signed, repeated };
  const detail = repeated.length === 0 ? "The receipt repeats no fields beside the signed text." : `All ${String(repeated.length)} repeated fields equal the signed text.`;
  return { check: result(id, "passed", detail), action: signed, repeated };
}

/** Checks 1 to 4, which need no network. */
export async function checkOffline(receipt: unknown, keys: readonly PublicKey[]): Promise<ReceiptReport> {
  const format = formatCheck(receipt);
  const { check: signature, key } = await signatureCheck(receipt, format, keys);
  const contentHash = await contentHashCheck(receipt);
  const { check: repeatedCheck, action, repeated } = repeatedFieldsCheck(receipt, signature);
  let valid = false;
  for (const k of keys) {
    if ((await verifyV2Receipt(receipt, k.key)).ok) {
      valid = true;
      break;
    }
  }
  return { checks: [format, signature, contentHash, repeatedCheck], valid, key, action, repeated };
}

/** Check 5, once for all the receipts in one run. */
async function treeHeadCheck(log: LogInputs | undefined): Promise<{ check: CheckResult; head: TreeHeadCheck | undefined }> {
  const id = "tree-head";
  if (log === undefined) return { check: result(id, "not-run", "Not run: give a receipts-log address to check the log."), head: undefined };
  if (log.logKey === undefined) {
    return {
      check: result(id, "not-run", "Not run: give the log's public key. This page does not fetch the key from the log, because a key fetched from the log proves nothing."),
      head: undefined,
    };
  }
  const answer = await log.client.sth();
  if (answer.kind === "network") return { check: result(id, "not-run", answer.detail, true), head: undefined };
  if (answer.kind === "unreadable") return { check: result(id, "not-run", `Not run: ${answer.detail}`, false, true), head: undefined };
  if (answer.status !== 200) {
    return { check: logAnswered(id, answer.status, answer.body), head: undefined };
  }
  const head = await checkTreeHead(answer.body, log.logKey);
  if (head.status === "passed") {
    const { sth } = head;
    return { check: result(id, "passed", `The log ${show(sth.logId)} signed a tree of ${String(sth.treeSize)} entries at ${sth.timestamp}, under the key ${log.logKey.fingerprint}.`), head };
  }
  return { check: result(id, head.status, head.reason), head };
}

/** Check 6, for one receipt, against a tree head that passed check 5. */
async function inLogCheck(receipt: unknown, log: LogInputs | undefined, head: TreeHeadCheck | undefined): Promise<CheckResult> {
  const id = "in-log";
  if (log === undefined) return result(id, "not-run", "Not run: give a receipts-log address to check the log.");
  if (head?.status !== "passed") return result(id, "not-run", "Not run: the tree head was not checked, so there is no signed root to check a proof against.");
  if (!isObject(receipt) || typeof receipt.canonical !== "string" || receipt.canonical === "") {
    return result(id, "not-run", "Not run: the receipt has no canonical text to look up.");
  }
  const { sth } = head;
  if (sth.treeSize === 0) return result(id, "failed", "The log is empty, so it does not hold this receipt. Check the log address.");
  const leaf = await leafHash(receipt.canonical);
  const answer = await log.client.inclusion(leaf, sth.treeSize);
  if (answer.kind === "network") return result(id, "not-run", answer.detail, true);
  if (answer.kind === "unreadable") return result(id, "not-run", `Not run: ${answer.detail}`, false, true);
  if (answer.status === 404) {
    return result(id, "failed", "This log holds no entry for this receipt. Check the log address; if the receipt was submitted in the last few seconds, try again.");
  }
  if (answer.status !== 200) {
    return logAnswered(id, answer.status, answer.body);
  }
  const proof = answer.body;
  if (!isObject(proof)) return result(id, "failed", "The log's answer is not an inclusion proof. Keep the receipt and the tree head: the log may be misbehaving.");
  if (proof.leafHashHex !== leaf) return result(id, "failed", "The log answered with a proof for a different entry. Keep the receipt and the tree head: the log may be misbehaving.");
  if (proof.treeSize !== sth.treeSize) return result(id, "failed", "The log answered with a proof for a different tree size than its signed tree head. Try again; if it happens again, the log may be misbehaving.");
  // The proof's own rootHashHex is never trusted: the root comes from the signed tree head.
  if (await verifyInclusionProof(leaf, proof.leafIndex, sth.treeSize, proof.auditPath, sth.rootHash)) {
    return result(id, "passed", `Entry ${String(proof.leafIndex)} of ${String(sth.treeSize)} in the log ${show(sth.logId)}, with leaf hash ${leaf}.`);
  }
  return result(id, "failed", "The log's proof does not lead to the root in its signed tree head. Keep the receipt and the tree head as evidence: the log may be misbehaving.");
}

/** Check 7, once for all the receipts in one run. */
async function witnessesCheck(log: LogInputs | undefined, head: TreeHeadCheck | undefined): Promise<CheckResult> {
  const id = "witnesses";
  if (log === undefined) return result(id, "not-run", "Not run: give a receipts-log address to check the log.");
  if (log.witnessKeys.length === 0) return result(id, "not-run", "Not run: give one or more witness public keys to check cosignatures.");
  if (head?.status !== "passed") return result(id, "not-run", "Not run: the tree head was not checked, so there is no tree head to look for cosignatures on.");
  const answer = await log.client.cosignatures(head.sth.treeSize);
  if (answer.kind === "network") return result(id, "not-run", answer.detail, true);
  if (answer.kind === "unreadable") return result(id, "not-run", `Not run: ${answer.detail}`, false, true);
  if (answer.status !== 200) {
    return logAnswered(id, answer.status, answer.body);
  }
  const body = answer.body;
  if (!isObject(body) || !Array.isArray(body.cosignatures)) return result(id, "failed", "The log's answer is not a list of cosignatures. Try again; if it happens again, the log may be misbehaving.");
  // A cosignature counts when the tree head it covers has this log, size
  // and root; its timestamp may differ, since the log re-signs the same
  // tree. Its text is rebuilt from its own fields and must match byte for
  // byte, and its signature must verify over that text under the witness key.
  // One over the same log and size with another root is a fork: when its
  // text is canonical and it verifies under a witness key, the log showed
  // that witness another history for this size, and check 7 fails.
  const { sth } = head;
  const matching: { signature: unknown; sthCanonical: string }[] = [];
  const forks: { signature: unknown; sthCanonical: string; rootHash: string }[] = [];
  for (const c of body.cosignatures as unknown[]) {
    if (!isObject(c) || typeof c.sthCanonical !== "string") continue;
    const covered = canonicalTreeHead(c.sthCanonical);
    if (covered?.logId === sth.logId && covered.treeSize === sth.treeSize && covered.rootHash !== sth.rootHash) {
      forks.push({ signature: c.signature, sthCanonical: c.sthCanonical, rootHash: covered.rootHash });
      continue;
    }
    if (covered?.logId !== sth.logId || covered.treeSize !== sth.treeSize || covered.rootHash !== sth.rootHash) continue;
    matching.push({ signature: c.signature, sthCanonical: c.sthCanonical });
  }
  const forkedBy: string[] = [];
  for (const w of log.witnessKeys) {
    for (const f of forks) {
      if (await verifyV2Text(f.signature, f.sthCanonical, w)) {
        forkedBy.push(`witness ${w.fingerprint} says the log showed it a tree head of size ${String(sth.treeSize)} with root ${f.rootHash}`);
        break;
      }
    }
  }
  if (forkedBy.length > 0) {
    const said = forkedBy.join("; ");
    return result(
      id,
      "failed",
      `${said.charAt(0).toUpperCase()}${said.slice(1)}; the log's signed tree head has root ${sth.rootHash}. Save the log's answers to /v1/sth and /v1/cosignatures?treeSize=${String(sth.treeSize)}: together they are the evidence. If the witness is right, the log showed two different histories for one size.`,
    );
  }
  const signedBy: string[] = [];
  for (const w of log.witnessKeys) {
    for (const c of matching) {
      if (await verifyV2Text(c.signature, c.sthCanonical, w)) {
        signedBy.push(w.fingerprint);
        break;
      }
    }
  }
  const n = log.witnessKeys.length;
  const what = `a tree head of the log ${show(sth.logId)} with ${String(sth.treeSize)} entries and this root`;
  if (signedBy.length === 0) {
    return result(id, "failed", `None of the ${String(n)} witness keys you gave cosigned ${what}. Witnesses cosign on their own schedule, so try again later; if it stays at none, check that you have the witnesses' keys.`);
  }
  return result(id, "passed", `${String(signedBy.length)} of ${String(n)} witnesses cosigned ${what}: ${signedBy.join(", ")}.`);
}

const RECEIPT_UNCHECKED = "A receipt this page cannot check is not valid here; check it with the verifiable-receipts library.";

/** What a result that could not be checked means, in the words of the check that threw. */
const UNCHECKED: Record<CheckId, string> = {
  format: RECEIPT_UNCHECKED,
  signature: RECEIPT_UNCHECKED,
  "content-hash": RECEIPT_UNCHECKED,
  "repeated-fields": RECEIPT_UNCHECKED,
  "tree-head": "A tree head this page cannot check is not trusted here; check the log with the verifiable-receipts library.",
  "in-log": "An inclusion proof this page cannot check does not show the entry is in the log; check it with the verifiable-receipts library.",
  witnesses: "Cosignatures this page cannot check do not count here; check them with the verifiable-receipts library.",
};

/**
 * The result of check `id` when checking threw: "not run" when this browser
 * has no WebCrypto Ed25519, and "failed" for anything else, so that a
 * check is never left on "Checking…". A throw in checks 1 to 4 also makes
 * the receipt not valid; a throw in check 5, 6 or 7 fails that check alone,
 * and the verdict of checks 1 to 4 stands.
 */
function trouble(id: CheckId, e: unknown): CheckResult {
  if (e instanceof Ed25519Unavailable) return result(id, "not-run", `Not run: ${e.message}`);
  const what = e instanceof Error ? e.name : "an error";
  return result(id, "failed", `This could not be checked: the page hit ${what}. ${UNCHECKED[id]}`);
}

/** All seven checks for every receipt; the log is asked for one tree head and one list of cosignatures per run. Never throws. */
export async function checkReceipts(receipts: readonly unknown[], inputs: Inputs): Promise<ReceiptReport[]> {
  let treeHead: CheckResult;
  let head: TreeHeadCheck | undefined;
  try {
    ({ check: treeHead, head } = await treeHeadCheck(inputs.log));
  } catch (e) {
    treeHead = trouble("tree-head", e);
  }
  let witnesses: CheckResult;
  try {
    witnesses = await witnessesCheck(inputs.log, head);
  } catch (e) {
    witnesses = trouble("witnesses", e);
  }
  const reports: ReceiptReport[] = [];
  for (const receipt of receipts) {
    let report: ReceiptReport;
    try {
      report = await checkOffline(receipt, inputs.issuerKeys);
    } catch (e) {
      const first = trouble("format", e);
      const rest = (["signature", "content-hash", "repeated-fields", "in-log"] as const).map((id) =>
        first.status === "not-run" ? trouble(id, e) : result(id, "not-run", "Not run: the receipt could not be checked."),
      );
      const [signature, contentHash, repeated, inLog] = rest;
      reports.push({
        checks: [first, signature, contentHash, repeated, treeHead, inLog, witnesses].filter((c): c is CheckResult => c !== undefined),
        valid: false,
        key: undefined,
        action: undefined,
        repeated: [],
      });
      continue;
    }
    // Check 6 throwing leaves checks 1 to 4 as they are.
    let inLog: CheckResult;
    try {
      inLog = await inLogCheck(receipt, inputs.log, head);
    } catch (e) {
      inLog = trouble("in-log", e);
    }
    report.checks.push(treeHead, inLog, witnesses);
    reports.push(report);
  }
  return reports;
}
