// Diagnostic only (branch diag/webkit-ed25519-crash, never merged): which
// edge vector closes WebKit on Linux when given to WebCrypto raw. One test
// per vector and per step, so a crash ends only that test.
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

interface Vector {
  name: string;
  spki: string;
  msg: string;
  sig: string;
}

const VECTORS = JSON.parse(readFileSync(new URL("../test/fixtures/ed25519/vectors.json", import.meta.url), "utf8")) as Vector[];

for (const v of VECTORS) {
  for (const step of ["import", "verify"] as const) {
    test(`${step}: ${v.name}`, async ({ page }) => {
      await page.goto("./");
      const got = await page.evaluate(
        async ({ v, step }) => {
          const hex = (h: string): Uint8Array<ArrayBuffer> => new Uint8Array((h.match(/../g) ?? []).map((b) => Number.parseInt(b, 16)));
          const b64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
          try {
            const key = await crypto.subtle.importKey("spki", b64(v.spki), { name: "Ed25519" }, false, ["verify"]);
            if (step === "import") return "imported";
            return String(await crypto.subtle.verify({ name: "Ed25519" }, key, hex(v.sig), hex(v.msg)));
          } catch (e) {
            return `threw ${String(e)}`;
          }
        },
        { v, step },
      );
      console.log(`DIAG ${step} | ${v.name} | ${got}`);
      expect(typeof got).toBe("string");
    });
  }
}
