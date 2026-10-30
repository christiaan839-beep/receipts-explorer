// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Whether this browser's WebCrypto verifies Ed25519: RFC 8032 section 7.1,
// test 2 (a one-byte message) must verify, and the same signature with one
// bit flipped must not, so an implementation that answers true to everything
// is refused too. The key is imported both raw and as SPKI, the form the page
// reads keys in.
//
// Not test 1, the empty message: WebKit 27.2 (Playwright 1.64's build)
// answers false to it while it verifies every other message as Node does, so
// test 1 would turn Safari visitors away. The page never asks WebCrypto about
// an empty message: check 1 fails a receipt with no canonical text before
// check 2 verifies anything, and tree heads and cosignatures are verified
// over their canonical JSON text, which is never empty.
import { fromHex } from "./bytes.ts";

const PUBLIC = "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c";
/** The SPKI DER prefix of an Ed25519 public key (RFC 8410). */
const SPKI_PREFIX = "302a300506032b6570032100";
const MESSAGE = "72";
const SIGNATURE =
  "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00";

export async function hasEd25519(): Promise<boolean> {
  try {
    if (typeof crypto === "undefined" || typeof crypto.subtle === "undefined") return false;
    const flipped = fromHex(SIGNATURE);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    for (const [format, bytes] of [
      ["raw", fromHex(PUBLIC)],
      ["spki", fromHex(SPKI_PREFIX + PUBLIC)],
    ] as const) {
      const key = await crypto.subtle.importKey(format, bytes, { name: "Ed25519" }, false, ["verify"]);
      if (!(await crypto.subtle.verify({ name: "Ed25519" }, key, fromHex(SIGNATURE), fromHex(MESSAGE)))) return false;
      if (await crypto.subtle.verify({ name: "Ed25519" }, key, flipped, fromHex(MESSAGE))) return false;
    }
    return true;
  } catch {
    return false;
  }
}
