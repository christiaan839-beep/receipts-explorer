// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Bundles src/main.ts into build/check.js for the browser: one ES module,
// minified, with no runtime dependencies. The output is deterministic;
// build.py copies it into dist/static/ and writes its integrity hash.
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
rmSync(join(root, "build"), { recursive: true, force: true });
mkdirSync(join(root, "build"));

const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/main.ts"],
  outfile: "build/check.js",
  bundle: true,
  platform: "browser",
  target: ["es2022", "chrome137", "firefox129", "safari17"],
  format: "esm",
  minify: true,
  legalComments: "none",
  banner: { js: "// receipts-explorer. Apache-2.0. Source: https://github.com/christiaan839-beep/receipts-explorer" },
  metafile: true,
  logLevel: "warning",
});

const outside = Object.keys(result.metafile.inputs).filter((f) => !f.startsWith("src/") && !f.startsWith("content/"));
if (outside.length > 0) {
  console.error(`check.js must have no dependencies; it includes ${outside.join(", ")}`);
  process.exit(1);
}
