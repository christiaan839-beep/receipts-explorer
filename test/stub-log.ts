// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// A stand-in for a live receipts-log: answers from test/fixtures/log.
import type { Fetcher } from "../src/log-client.ts";
import { LOG, readText } from "./helpers.ts";

export const LOG_BASE = new URL("https://log.test/");

export interface StubAnswer {
  status: number;
  /** A file in test/fixtures/log, served as the body. */
  file?: string;
}

/**
 * A fetch that answers from test/fixtures/log by path and query, and
 * fails like an unreachable host for anything it does not know.
 * `requests` records every URL asked for.
 */
export function stubLog(routes: Record<string, StubAnswer | "unreachable">, requests: string[] = []): Fetcher {
  return (url, init) => {
    requests.push(`${init.method ?? "GET"} ${url}`);
    const u = new URL(url);
    const answer = routes[u.pathname + u.search] ?? "unreachable";
    if (answer === "unreachable") return Promise.reject(new TypeError("Failed to fetch"));
    const body = answer.file === undefined ? "" : readText(LOG, answer.file);
    return Promise.resolve(new Response(body, { status: answer.status, headers: { "Content-Type": "application/json" } }));
  };
}
