// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

import { builtinModules } from "node:module";

import js from "@eslint/js";
import tseslint from "typescript-eslint";

// What the page must never do with a visitor's receipts and keys: parse
// them as HTML, store them, run code it did not ship, or send them anywhere
// but the log they typed. Properties are banned by name on any object, so
// globalThis.x, window.x and self.x are caught as well as a bare x.
const banned = (message, ...names) => names.map((property) => ({ property, message }));
const PROPERTIES = [
  ...banned(
    "Build elements with textContent; never parse input as HTML.",
    "innerHTML",
    "outerHTML",
    "insertAdjacentHTML",
    "setHTMLUnsafe",
    "createContextualFragment",
  ),
  ...banned("The page stores nothing.", "localStorage", "sessionStorage", "indexedDB", "cookie"),
  ...banned("Nothing from the inputs goes in the address bar.", "pushState", "replaceState"),
  ...banned("The page talks only to the log, through src/log-client.ts.", "navigator", "sendBeacon"),
  { object: "document", property: "write", message: "Build elements with textContent." },
];
const GLOBALS = [
  ...[
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "caches",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "navigator",
    "DOMParser",
    "Worker",
    "SharedWorker",
    "open",
  ].map((name) => ({ name, message: "The page stores nothing, parses no HTML and talks only to the log, through src/log-client.ts." })),
  // src/ is bundled for the browser, which has none of Node's globals.
  ...["Buffer", "process", "require", "global", "__dirname", "__filename"].map((name) => ({
    name,
    message: "src/ runs in the browser: use src/bytes.ts and WebCrypto, not Node.",
  })),
];
const FETCH = "Only src/log-client.ts makes requests.";

export default tseslint.config(
  {
    ignores: [
      "build/**",
      "dist/**",
      "node_modules/**",
      "third_party/**",
      "test-results/**",
      "playwright-report/**",
      "blob-report/**",
      "coverage/**",
    ],
  },
  js.configs.recommended,
  {
    rules: { "no-eval": "error", "no-implied-eval": "error", "no-new-func": "error" },
  },
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: false }],
      "@typescript-eslint/no-floating-promises": [
        "error",
        { allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["describe", "it"] }] },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-properties": ["error", ...PROPERTIES],
      "no-restricted-globals": ["error", ...GLOBALS],
      "no-restricted-imports": [
        "error",
        {
          paths: builtinModules.map((name) => ({ name, message: "src/ runs in the browser: no Node modules." })),
          patterns: [{ group: ["node:*"], message: "src/ runs in the browser: no Node modules." }],
        },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "ImportExpression", message: "The page loads no code at run time; import statically." },
      ],
    },
  },
  {
    // ESLint replaces a rule's options per block, so these repeat the full lists and add fetch.
    files: ["src/**/*.ts"],
    ignores: ["src/log-client.ts"],
    rules: {
      "no-restricted-properties": ["error", ...PROPERTIES, { property: "fetch", message: FETCH }],
      "no-restricted-globals": ["error", ...GLOBALS, { name: "fetch", message: FETCH }],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", Buffer: "readonly", URL: "readonly" },
    },
  },
);
