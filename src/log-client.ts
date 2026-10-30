// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// The only code that reaches the network: GET requests to the receipts-log
// address the visitor typed, with no credentials, no referrer and no cache.
// A request that does not complete is a network error, never a verdict; an
// answer too large to be a log's, or not JSON, is unreadable, also never a
// verdict. receipts-log sends its CORS header on every answer from a read
// route, its own 503 (busy), 414 and 500 included (receipts-log PR #13),
// so those arrive here as answers with a status, not as network errors.

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type LogAnswer =
  /** The log answered with JSON; `body` is that JSON, whatever the status. */
  | { kind: "answer"; status: number; body: unknown }
  /** The log answered, but with more than MAX_BODY_BYTES or with text that is not JSON. */
  | { kind: "unreadable"; status: number; detail: string }
  /** No answer: the request failed, was refused, or timed out. */
  | { kind: "network"; detail: string };

/** The most bytes of an answer read: a tree head, a proof or a page of cosignatures is far smaller. */
export const MAX_BODY_BYTES = 1_000_000;

const LEAF_HASH = /^[0-9a-f]{64}$/;

export type LogAddress = { ok: true; base: URL } | { ok: false; reason: string };

/** Reads the address the visitor typed: https only, no credentials, query or fragment. */
export function parseLogAddress(text: string): LogAddress {
  const typed = text.trim();
  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    return { ok: false, reason: "The log address is not a web address. Type it in full, starting with https://." };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "The log address must start with https://." };
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "The log address must not contain a user name or password." };
  }
  // A bare "?" or "#" leaves url.search and url.hash empty, so the typed text is checked too.
  if (url.search !== "" || url.hash !== "" || typed.includes("?") || typed.includes("#")) {
    return { ok: false, reason: "The log address must not contain ? or #. Give the address the log's /v1/ routes are under." };
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return { ok: true, base: url };
}

function isCount(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

export class LogClient {
  readonly base: URL;
  readonly #fetch: Fetcher;
  readonly #timeoutMs: number;

  constructor(base: URL, fetcher: Fetcher = (url, init) => fetch(url, init), timeoutMs = 15_000) {
    if (base.protocol !== "https:" || base.username !== "" || base.password !== "" || base.search !== "" || base.hash !== "") {
      throw new TypeError("LogClient: the base must be an https address with no credentials, query or fragment; read it with parseLogAddress.");
    }
    this.base = base;
    this.#fetch = fetcher;
    this.#timeoutMs = timeoutMs;
  }

  sth(): Promise<LogAnswer> {
    return this.#get("v1/sth", {});
  }

  async inclusion(leafHashHex: string, treeSize: number): Promise<LogAnswer> {
    if (!LEAF_HASH.test(leafHashHex)) throw new TypeError("LogClient: leafHash must be 64 lowercase hex digits.");
    if (!isCount(treeSize)) throw new TypeError("LogClient: treeSize must be a whole number from 0 to 2^53 - 1.");
    return this.#get("v1/proof/inclusion", { leafHash: leafHashHex, treeSize: String(treeSize) });
  }

  async cosignatures(treeSize: number): Promise<LogAnswer> {
    if (!isCount(treeSize)) throw new TypeError("LogClient: treeSize must be a whole number from 0 to 2^53 - 1.");
    return this.#get("v1/cosignatures", { treeSize: String(treeSize) });
  }

  async #get(path: string, query: Record<string, string>): Promise<LogAnswer> {
    const url = new URL(path, this.base);
    url.search = new URLSearchParams(query).toString();
    const host = this.base.host;
    // One timer for the whole exchange, headers and body; cleared only once the body is read.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new DOMException("The log took too long to answer.", "TimeoutError"));
    }, this.#timeoutMs);
    let response: Response;
    let read: { bytes: Uint8Array } | { tooLarge: true };
    try {
      response = await this.#fetch(url.href, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      read = await readLimited(response);
    } catch {
      return {
        kind: "network",
        detail: `Could not reach the log at ${host}. It may be down or busy, or the address may be wrong. Check the address and try again.`,
      };
    } finally {
      clearTimeout(timer);
    }
    if ("tooLarge" in read) {
      return {
        kind: "unreadable",
        status: response.status,
        detail: `The log at ${host} sent an answer larger than 1 MB, which no log answer needs. Try again; if it happens again, the log may be misbehaving.`,
      };
    }
    try {
      return { kind: "answer", status: response.status, body: JSON.parse(new TextDecoder("utf-8", { fatal: false }).decode(read.bytes)) };
    } catch {
      return {
        kind: "unreadable",
        status: response.status,
        detail: `The log at ${host} answered (status ${String(response.status)}), but its answer is not JSON. Check that the address is the log's, not its web page, and try again.`,
      };
    }
  }
}

/**
 * The body's bytes, read no further than MAX_BODY_BYTES: an answer whose
 * content-length says it is larger is refused unread, and one that runs
 * past the limit is cancelled there. Throws when the body fails or the
 * request is aborted.
 */
async function readLimited(response: Response): Promise<{ bytes: Uint8Array } | { tooLarge: true }> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return { tooLarge: true };
  }
  if (response.body === null) return { bytes: new Uint8Array(0) };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return { bytes };
}

/** The log's own error text, when its answer has one, cut to 200 UTF-16 units without splitting a surrogate pair. */
export function logError(body: unknown): string {
  if (body !== null && typeof body === "object" && "error" in body && typeof body.error === "string") {
    const cut = body.error.slice(0, 200);
    const last = cut.charCodeAt(cut.length - 1);
    return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
  }
  return "no reason given";
}
