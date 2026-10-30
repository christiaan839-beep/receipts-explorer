// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// End-to-end tests of the built site (dist/), served as GitHub Pages
// serves it. Development only: nothing here is shipped. The log is
// stubbed with page.route, so no test reaches a live log.
import { defineConfig, devices } from "@playwright/test";

// E2E_PORT lets two runs share a machine; each starts its own server and
// never reuses one, so a run always tests its own dist/.
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${String(PORT)}/`, trace: "retain-on-failure" },
  webServer: {
    command: `python3 serve.py --dist ${String(PORT)}`,
    url: `http://127.0.0.1:${String(PORT)}/`,
    reuseExistingServer: false,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, testIgnore: /performance|visual/ },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, testIgnore: /performance|visual/ },
  ],
});
