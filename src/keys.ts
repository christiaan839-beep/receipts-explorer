// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Reads Ed25519 public keys from PEM text into WebCrypto keys, each named
// by the same fingerprint verify-receipts-action reports. The reading is
// strict: every block must be whole, nothing but whitespace may sit
// between blocks, the body must be the one spelling of its bytes, and the
// key must re-export to exactly those bytes. A problem is an error that
// says what to do, never a block silently dropped.
import { Ed25519Unavailable, fromBase64, isUnsupported, sha256Hex, toHex } from "./bytes.ts";
import { ed25519PublicKeyProblem } from "./vendor/verifiable-receipts/ed25519-key.ts";

/** An Ed25519 public key and the short name it is reported under. */
export interface PublicKey {
  key: CryptoKey;
  /** "sha256:" and the first 16 hex characters of the SHA-256 of the SPKI DER. */
  fingerprint: string;
}

export class KeyError extends Error {}

const MARKER = /-----(BEGIN|END) ([A-Z0-9 ]+)-----/g;

/** The SPKI DER prefix of an Ed25519 public key (RFC 8410): the 32 key bytes follow it. */
const ED25519_SPKI_PREFIX = "302a300506032b6570032100";

/**
 * Why the verifier would refuse this key under the strict profile of VAOS
 * 2.0 section 7.3 (not a canonical encoding of a point of order L), or
 * null. The test is the port's own (ed25519PublicKeyProblem, vendored), so
 * the page refuses at reading exactly the keys verification refuses, with
 * the verifier's reason.
 */
function weakKey(der: Uint8Array): string | null {
  if (der.length !== 44 || !toHex(der).startsWith(ED25519_SPKI_PREFIX)) return null;
  return ed25519PublicKeyProblem(der.slice(12));
}

/** What the page says about a key the verifier refuses, quoting the verifier's reason. */
function weakKeyMessage(source: string, n: number, reason: string): string {
  const block = `${source}, block ${String(n)},`;
  switch (reason) {
    case "public key is a small-order point":
      return `${block} is a key of small order (${reason}), under which forged signatures verify. No real issuer, log or witness uses one: check where it came from.`;
    case "public key is not in the prime-order subgroup":
      return `${block} is a key of mixed order (${reason}), which no Ed25519 key generator makes and on which verifiers disagree. No real issuer, log or witness uses one: check where it came from.`;
    case "public key is not a point on the curve":
      return `${block} is not an Ed25519 key at all (${reason}), so no signature can verify under it. Copy the whole block again, or check where it came from.`;
    default:
      return `${block} is not the canonical encoding of its key (${reason}). No real issuer, log or witness writes one: check where it came from.`;
  }
}

/**
 * Reads every PEM block in `text` and returns the Ed25519 public keys, in
 * order, without repeats. `source` names the field in messages ("The
 * issuer key"). Throws KeyError for any problem, or Ed25519Unavailable when
 * this browser cannot read Ed25519 keys at all.
 */
export async function parsePublicKeys(text: string, source: string): Promise<PublicKey[]> {
  const keys: PublicKey[] = [];
  let blocks = 0;
  let at = 0;
  let open: { label: string; start: number } | undefined;
  for (const m of text.matchAll(MARKER)) {
    const [whole, kind, label = ""] = m;
    if (kind === "BEGIN") {
      if (open !== undefined) {
        throw new KeyError(`${source}, block ${String(blocks + 1)}, has no -----END ${open.label}----- line. Copy the whole block again.`);
      }
      if (text.slice(at, m.index).trim() !== "") {
        throw new KeyError(`${source} has text outside its PEM blocks. Paste only the blocks, from -----BEGIN to -----END.`);
      }
      open = { label, start: m.index + whole.length };
      continue;
    }
    if (open === undefined) {
      throw new KeyError(`${source} has an -----END ${label}----- line with no BEGIN line before it. Copy the whole block again.`);
    }
    blocks++;
    if (label !== open.label) {
      throw new KeyError(`${source}, block ${String(blocks)}, begins "${open.label}" but ends "${label}". Copy the whole block again.`);
    }
    if (label.includes("PRIVATE")) {
      throw new KeyError(
        `${source}, block ${String(blocks)}, is a private key. Paste the matching public key instead (openssl pkey -pubout prints it), and keep the private key to yourself.`,
      );
    }
    if (label !== "PUBLIC KEY") {
      throw new KeyError(`${source}, block ${String(blocks)}, is a "${label}". Paste a "PUBLIC KEY" block.`);
    }
    keys.push(...(await readKey(text.slice(open.start, m.index), source, blocks, keys)));
    open = undefined;
    at = m.index + whole.length;
  }
  if (open !== undefined) {
    throw new KeyError(`${source}, block ${String(blocks + 1)}, has no -----END ${open.label}----- line. Copy the whole block again.`);
  }
  if (text.slice(at).trim() !== "") {
    throw new KeyError(
      blocks === 0
        ? `${source} has no PEM block. Include the -----BEGIN PUBLIC KEY----- and -----END PUBLIC KEY----- lines.`
        : `${source} has text outside its PEM blocks. Paste only the blocks, from -----BEGIN to -----END.`,
    );
  }
  return keys;
}

async function readKey(body: string, source: string, n: number, seen: readonly PublicKey[]): Promise<PublicKey[]> {
  const damaged = new KeyError(
    `${source}, block ${String(n)}, is not an Ed25519 public key, or is damaged. Copy the whole block again, from -----BEGIN to -----END.`,
  );
  let der: Uint8Array<ArrayBuffer>;
  try {
    der = fromBase64(body.replace(/[ \t\r\n]+/g, ""));
  } catch {
    throw damaged;
  }
  const weak = weakKey(der);
  if (weak !== null) throw new KeyError(weakKeyMessage(source, n, weak));
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("spki", der, { name: "Ed25519" }, true, ["verify"]);
  } catch (e) {
    if (isUnsupported(e)) throw new Ed25519Unavailable();
    throw damaged;
  }
  const exported = new Uint8Array(await crypto.subtle.exportKey("spki", key));
  // Node accepts an SPKI with bytes after the key, and browsers do not:
  // only the exact encoding is accepted everywhere.
  if (toHex(exported) !== toHex(der)) throw damaged;
  const fingerprint = "sha256:" + (await sha256Hex(exported)).slice(0, 16);
  return seen.some((k) => k.fingerprint === fingerprint) ? [] : [{ key, fingerprint }];
}
