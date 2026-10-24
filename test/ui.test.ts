// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// How the check page starts: it says it needs JavaScript until the script
// runs, and refuses to run inside another page's frame.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { start } from "../src/ui.ts";

interface Element {
  hidden: boolean;
  querySelector: () => null;
  addEventListener: () => void;
}

interface View {
  top: unknown;
  self: unknown;
}

/** The elements start() touches, in a document whose window is `view`. */
function page(view: View | null): { doc: Document; els: Record<string, Element> } {
  const element = (hidden: boolean): Element => ({ hidden, querySelector: () => null, addEventListener: () => undefined });
  const els: Record<string, Element> = {
    "needs-js": element(false),
    framed: element(true),
    "no-ed25519": element(true),
    "check-form": element(true),
    retry: element(true),
  };
  const doc = { defaultView: view, getElementById: (id: string) => els[id] ?? null, querySelectorAll: () => [] };
  return { doc: doc as unknown as Document, els };
}

function shown(els: Record<string, Element>): string[] {
  return Object.entries(els)
    .filter(([, e]) => !e.hidden)
    .map(([id]) => id);
}

describe("start", () => {
  it("runs at the top level: hides the JavaScript note and shows the form", async () => {
    const view: View = { top: null, self: null };
    view.top = view;
    view.self = view;
    const { doc, els } = page(view);
    await start(doc);
    assert.deepEqual(shown(els), ["check-form"]);
  });
  it("refuses to run in a frame: hides the JavaScript note, says why, and shows no form", async () => {
    const { doc, els } = page({ top: {}, self: {} });
    await start(doc);
    assert.deepEqual(shown(els), ["framed"]);
  });
  it("refuses to run without a window", async () => {
    const { doc, els } = page(null);
    await start(doc);
    assert.deepEqual(shown(els), ["framed"]);
  });
});
