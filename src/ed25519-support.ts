// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Whether this browser's WebCrypto verifies Ed25519: RFC 8032 section 7.1,
// test 1 (the empty message), with the key imported both raw and as SPKI,
// the form the page reads keys in.
import { fromHex } from "./bytes.ts";

const PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
/** The SPKI DER prefix of an Ed25519 public key (RFC 8410). */
const SPKI_PREFIX = "302a300506032b6570032100";
const SIGNATURE =
  "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";

export async function hasEd25519(): Promise<boolean> {
  try {
    if (typeof crypto === "undefined" || typeof crypto.subtle === "undefined") return false;
    for (const [format, bytes] of [
      ["raw", fromHex(PUBLIC)],
      ["spki", fromHex(SPKI_PREFIX + PUBLIC)],
    ] as const) {
      const key = await crypto.subtle.importKey(format, bytes, { name: "Ed25519" }, false, ["verify"]);
      if (!(await crypto.subtle.verify({ name: "Ed25519" }, key, fromHex(SIGNATURE), new Uint8Array(0)))) return false;
    }
    return true;
  } catch {
    return false;
  }
}
