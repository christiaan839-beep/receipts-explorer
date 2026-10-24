// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LogClient, MAX_BODY_BYTES, logError, type Fetcher } from "../src/log-client.ts";

const BASE = new URL("https://example.org/log/");
const LEAF = "ab".repeat(32);

function answering(body: string, status = 200, seen: { url: string; init: RequestInit }[] = []): Fetcher {
  return (url, init) => {
    seen.push({ url, init });
    return Promise.resolve(new Response(body, { status }));
  };
}

/** A body that sends 64 KiB chunks for as long as it is read, and records being cancelled. */
function endless(): { stream: ReadableStream<Uint8Array>; cancelled: () => boolean; sent: () => number } {
  let cancelled = false;
  let sent = 0;
  const chunk = new Uint8Array(65_536).fill(0x20);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled, sent: () => sent };
}

describe("LogClient", () => {
  it("asks with GET only, no credentials, no referrer, no cache and no redirects, under the base path", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const client = new LogClient(BASE, answering("{}", 200, seen));
    await client.sth();
    await client.inclusion(LEAF, 7);
    await client.cosignatures(7);
    assert.deepEqual(
      seen.map((s) => s.url),
      [
        "https://example.org/log/v1/sth",
        `https://example.org/log/v1/proof/inclusion?leafHash=${LEAF}&treeSize=7`,
        "https://example.org/log/v1/cosignatures?treeSize=7",
      ],
    );
    for (const { init } of seen) {
      assert.equal(init.method, "GET");
      assert.equal(init.credentials, "omit");
      assert.equal(init.referrerPolicy, "no-referrer");
      assert.equal(init.cache, "no-store");
      assert.equal(init.redirect, "error");
      assert.equal(init.mode, "cors");
      assert.ok(init.signal instanceof AbortSignal);
    }
  });

  it("refuses a leaf hash or tree size that is not one, rather than putting it in the address", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const client = new LogClient(BASE, answering("{}", 200, seen));
    for (const leaf of [LEAF.toUpperCase(), LEAF.slice(1), `${LEAF.slice(2)}&x`, `${LEAF}0`]) {
      await assert.rejects(client.inclusion(leaf, 7), TypeError);
    }
    for (const size of [-1, 1.5, 2 ** 53, Number.NaN]) {
      await assert.rejects(client.inclusion(LEAF, size), TypeError);
      await assert.rejects(client.cosignatures(size), TypeError);
    }
    assert.equal(seen.length, 0);
  });

  it("refuses a base that is not https, or has a query, a fragment or credentials", () => {
    for (const base of ["http://example.org/log/", "https://example.org/log/?x=1", "https://example.org/log/#x", "https://u:p@example.org/log/", "https://u@example.org/log/"]) {
      assert.throws(() => new LogClient(new URL(base), answering("{}")), TypeError, base);
    }
  });

  it("reports a request that does not complete as a network error", async () => {
    const client = new LogClient(BASE, () => Promise.reject(new TypeError("Failed to fetch")));
    const answer = await client.sth();
    assert.ok(answer.kind === "network");
    assert.match(answer.detail, /Could not reach the log at example\.org/);
  });

  it("gives up on a log that sends its headers and then never finishes the body", { timeout: 2000 }, async () => {
    const hanging: Fetcher = (_url, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
          init.signal?.addEventListener("abort", () => {
            controller.error(init.signal?.reason);
          });
        },
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    };
    const answer = await new LogClient(BASE, hanging, 50).sth();
    assert.equal(answer.kind, "network");
  });

  it("gives the status and the parsed body", async () => {
    assert.deepEqual(await new LogClient(BASE, answering('{"error":"busy"}', 503)).sth(), { kind: "answer", status: 503, body: { error: "busy" } });
  });

  it("reports an answer that is not JSON as unreadable, never as an answer without a body", async () => {
    for (const [text, status] of [["<html>", 200], ["", 200], ["{", 503]] as const) {
      const answer = await new LogClient(BASE, answering(text, status)).sth();
      assert.ok(answer.kind === "unreadable", text);
      assert.equal(answer.status, status);
      assert.match(answer.detail, /is not JSON/);
    }
  });

  it(`reads an answer of exactly ${String(MAX_BODY_BYTES)} bytes, and refuses one a byte longer`, async () => {
    const exact = `"${"x".repeat(MAX_BODY_BYTES - 2)}"`;
    const a = await new LogClient(BASE, answering(exact)).sth();
    assert.ok(a.kind === "answer" && typeof a.body === "string" && a.body.length === MAX_BODY_BYTES - 2);
    const b = await new LogClient(BASE, answering(`"${"x".repeat(MAX_BODY_BYTES - 1)}"`)).sth();
    assert.ok(b.kind === "unreadable");
    assert.match(b.detail, /larger than 1 MB/);
  });

  it("counts bytes, not characters", async () => {
    // 500,000 two-byte characters: 1,000,002 bytes, 500,002 characters.
    const answer = await new LogClient(BASE, answering(`"${"é".repeat(500_000)}"`)).sth();
    assert.equal(answer.kind, "unreadable");
  });

  it("stops reading an endless body once it passes the limit, and cancels it", { timeout: 2000 }, async () => {
    const body = endless();
    const answer = await new LogClient(BASE, () => Promise.resolve(new Response(body.stream, { status: 200 }))).sth();
    assert.ok(answer.kind === "unreadable");
    assert.match(answer.detail, /larger than 1 MB/);
    assert.ok(body.cancelled());
    assert.ok(body.sent() < MAX_BODY_BYTES + 4 * 65_536);
  });

  it("refuses a body whose content-length is over the limit before reading it", { timeout: 2000 }, async () => {
    const body = endless();
    const headers = { "content-length": String(MAX_BODY_BYTES + 1) };
    const answer = await new LogClient(BASE, () => Promise.resolve(new Response(body.stream, { status: 200, headers }))).sth();
    assert.ok(answer.kind === "unreadable");
    assert.match(answer.detail, /larger than 1 MB/);
    assert.ok(body.sent() <= 2 * 65_536, `read ${String(body.sent())} bytes`);
  });

  it("quotes the log's error text, cut to 200 characters without splitting a character", () => {
    assert.equal(logError({ error: "leaf hash not in the log" }), "leaf hash not in the log");
    assert.equal(logError({ error: "x".repeat(300) }).length, 200);
    // An emoji is two UTF-16 units; one starting at unit 199 would be cut in half.
    const cut = logError({ error: "x".repeat(199) + "\u{1F600}".repeat(10) });
    assert.equal(cut, "x".repeat(199));
    assert.equal(logError({ error: "x".repeat(198) + "\u{1F600}".repeat(10) }), "x".repeat(198) + "\u{1F600}");
    assert.equal(logError(undefined), "no reason given");
  });
});
