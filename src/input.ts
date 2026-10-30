// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Reads what the visitor pasted or dropped as the receipt: one receipt (a
// JSON object) or an array of them. A receipt is read as verifiable-
// receipts' parseReceipt reads it: its nesting is counted on the text
// before the text is parsed (VAOS 2.0 §7.2), so a duplicate key that
// JSON.parse discards still counts. One leading byte order mark, which
// some editors save, is dropped first; it is never part of a receipt.
// Never throws; a problem comes back as a sentence that says what to do.
import { MAX_NESTING, parseReceipt } from "./vendor/verifiable-receipts/receipt.ts";

export { MAX_NESTING };
export const MAX_INPUT_CHARS = 5_000_000;
export const MAX_RECEIPTS = 1000;

export type ParsedReceipts = { ok: true; receipts: unknown[] } | { ok: false; reason: string };

const NOT_JSON = "The receipt is not valid JSON. Paste the whole file, from the first { to the last }.";
const ONE_PER_LINE =
  "This looks like several receipts, one per line. Paste a single receipt or a JSON list of them, inside [ and ], separated by commas.";
const TOO_DEEP = `The receipt nests arrays and objects more than ${String(MAX_NESTING)} levels deep (receipt nesting deeper than 64), which no verifier accepts. It is not a valid receipt.`;

/**
 * How many arrays and objects `text` has open at once at most, counted as
 * the vendored textNestsTooDeep counts: outside strings `[` and `{` open
 * one, and `]` and `}` close one when one is open. Never recurses.
 */
export function nestingDepth(text: string): number {
  let open = 0;
  let deepest = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === "[" || c === "{") {
      if (++open > deepest) deepest = open;
    } else if ((c === "]" || c === "}") && open > 0) {
      open--;
    }
  }
  return deepest;
}

/** The reason for text that is not JSON: with a hint when it looks like receipts one per line (NDJSON). */
function notJson(text: string): string {
  return /\}[ \t\r]*\n[ \t\r\n]*\{/.test(text) ? ONE_PER_LINE : NOT_JSON;
}

export function parseReceipts(pasted: string): ParsedReceipts {
  const text = pasted.charCodeAt(0) === 0xfeff ? pasted.slice(1) : pasted;
  if (text.trim() === "") return { ok: false, reason: "Paste a receipt, or choose a receipt file." };
  if (text.length > MAX_INPUT_CHARS) {
    return { ok: false, reason: "The receipt text is longer than 5 million characters. Check one file of receipts at a time." };
  }
  if (!text.trimStart().startsWith("[")) {
    // One receipt: exactly the vendored parseReceipt.
    try {
      return { ok: true, receipts: [parseReceipt(text)] };
    } catch (e) {
      const reason = e instanceof Error ? e.message : "";
      if (reason === "receipt nesting deeper than 64") return { ok: false, reason: TOO_DEEP };
      if (reason === "receipt is not a JSON object") {
        return { ok: false, reason: "This is not a receipt: a receipt is a JSON object with canonical and signature fields. Check that you pasted the receipt, not a key or a tree head." };
      }
      return { ok: false, reason: notJson(text) };
    }
  }
  // A list: the list is one level more, so each receipt in it may reach MAX_NESTING + 1 on the text.
  if (nestingDepth(text) > MAX_NESTING + 1) return { ok: false, reason: TOO_DEEP };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: notJson(text) };
  }
  if (!Array.isArray(value)) return { ok: false, reason: NOT_JSON };
  if (value.length === 0) return { ok: false, reason: "The receipt text holds an empty list. Give at least one receipt." };
  if (value.length > MAX_RECEIPTS) {
    return { ok: false, reason: `The receipt text holds ${String(value.length)} receipts; this page checks up to ${String(MAX_RECEIPTS)} at a time. Check them in smaller lists.` };
  }
  return { ok: true, receipts: value as unknown[] };
}
