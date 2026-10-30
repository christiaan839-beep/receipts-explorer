// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Every flow of the check page, against the stubbed log.
import { expect, test, type Locator } from "@playwright/test";

import { HONEST, ISSUER, LOG, TAMPERED, VALID, fill, fingerprint, recordRequests, statusOf, stubLog } from "./helpers.ts";

const CHECKS = ["Format", "Signature", "Content hash", "Repeated fields", "Tree head", "In the log", "Witnesses"];

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#check-form")).toBeVisible();
  await expect(page.locator("#needs-js")).toBeHidden();
});

test("a valid receipt, without a log: 1 to 4 pass, 5 to 7 are not run", async ({ page }) => {
  await fill(page, VALID);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toHaveText("Checked 1 receipt: 1 valid.");
  await expect(page.getByRole("heading", { name: /^The receipt is valid: signed by sha256:/ })).toBeVisible();
  const got = await Promise.all(CHECKS.map((c) => statusOf(page, c)));
  expect(got).toEqual(["Passed", "Passed", "Passed", "Passed", "Not run", "Not run", "Not run"]);
  await expect(page.locator("#results-heading")).toBeFocused();
  await expect(page.locator("pre.action")).toContainText('"overall": "pass"');
});

test("a tampered receipt is not valid, and the message says what to do", async ({ page }) => {
  await fill(page, TAMPERED);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("heading", { name: /^The receipt is not valid\./ })).toBeVisible();
  expect(await statusOf(page, "Signature")).toBe("Failed");
  await expect(page.locator(".check-detail").nth(1)).toContainText("Check that you have the issuer's key, not the log's");
  await expect(page.locator("pre.action")).toHaveCount(0);
});

test("missing inputs are listed, linked to their fields and focused", async ({ page }) => {
  await page.getByRole("button", { name: "Check" }).click();
  const problems = page.locator("#problems");
  await expect(problems).toBeFocused();
  await expect(problems.getByRole("link")).toHaveText(["Paste a receipt, or choose a receipt file.", /Paste the issuer's public key/]);
  await expect(page.getByLabel("Receipt", { exact: true })).toHaveAttribute("aria-invalid", "true");
});

test("an honest log: all seven pass, with 2 of 3 witnesses, and only GETs to the log", async ({ page }) => {
  const requests = recordRequests(page);
  await stubLog(page, HONEST);
  await fill(page, VALID, { log: true });
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toHaveText("Checked 1 receipt: 1 valid.");
  const got = await Promise.all(CHECKS.map((c) => statusOf(page, c)));
  expect(got).toEqual(Array(7).fill("Passed"));
  await expect(page.locator(".check-detail").nth(6)).toHaveText(/^2 of 3 witnesses cosigned a tree head of the log "stub-log" with 3 entries and this root/);
  const toLog = requests.filter((r) => r.url().startsWith(LOG));
  expect(toLog.map((r) => `${r.method()} ${new URL(r.url()).pathname}`)).toEqual(["GET /v1/sth", "GET /v1/cosignatures", "GET /v1/proof/inclusion"]);
});

test("an unreachable log is a network error with a retry, never a failed check", async ({ page }) => {
  await stubLog(page, {});
  await fill(page, VALID, { log: true });
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toContainText("The log could not be reached, or was busy; you can try it again.");
  expect(await statusOf(page, "Tree head")).toBe("Network error");
  expect(await statusOf(page, "In the log")).toBe("Not run");
  await stubLog(page, HONEST);
  await page.getByRole("button", { name: "Try the log again" }).click();
  await expect(page.getByRole("status")).toHaveText("Checked 1 receipt: 1 valid.");
  expect(await statusOf(page, "In the log")).toBe("Passed");
  await expect(page.getByRole("button", { name: "Try the log again" })).toBeHidden();
});

test("a busy log (503) is not run, with a retry, never a failed check", async ({ page }) => {
  await stubLog(page, { ...HONEST, "/v1/sth": { status: 503, file: "busy.json" } });
  await fill(page, VALID, { log: true });
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("button", { name: "Try the log again" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("could not be reached, or was busy");
  expect(await statusOf(page, "Tree head")).toBe("Not run");
  await expect(page.locator(".check-detail").nth(4)).toContainText("the log is busy or failing (it answered 503: server busy)");
});

test("a forged tree head fails, the proof and witnesses are not run, and the heading says the log check failed", async ({ page }) => {
  await stubLog(page, { ...HONEST, "/v1/sth": { status: 200, file: "sth-forged.json" } });
  await fill(page, VALID, { log: true });
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toHaveText(/^Checked 1 receipt: 1 valid\. But the log check failed: The tree head's signature does not verify under the log key you gave\./);
  await expect(page.getByRole("heading", { name: /^The receipt is valid: .* But the log check failed: The tree head's signature does not verify/ })).toBeVisible();
  expect(await statusOf(page, "Tree head")).toBe("Failed");
  expect(await statusOf(page, "In the log")).toBe("Not run");
  expect(await statusOf(page, "Witnesses")).toBe("Not run");
});

test("a proof that matches its own rootHashHex but not the signed root fails", async ({ page }) => {
  await stubLog(page, { ...HONEST, "/v1/proof/inclusion": { status: 200, file: "inclusion-lying-root.json" } });
  await fill(page, VALID, { log: true });
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toHaveText("Checked 1 receipt: 1 valid. But the log check failed: The log's proof does not lead to the root in its signed tree head. Keep the receipt and the tree head as evidence: the log may be misbehaving.");
  expect(await statusOf(page, "In the log")).toBe("Failed");
});

test("a log whose witness cosigned a fork: Witnesses fails, naming the witness, and the heading says the log check failed", async ({ page }) => {
  await stubLog(page, { ...HONEST, "/v1/cosignatures": { status: 200, file: "cosignatures.json" } });
  await fill(page, VALID, { log: true });
  await page.getByRole("button", { name: "Check" }).click();
  const forked = `Witness ${fingerprint("witness-3.pem")} says the log showed it a tree head of size 3 with root `;
  await expect(page.getByRole("status")).toContainText(`Checked 1 receipt: 1 valid. But the log check failed: ${forked}`);
  expect(await statusOf(page, "Witnesses")).toBe("Failed");
  await expect(page.locator(".check-detail").nth(6)).toHaveText(new RegExp(`^${forked}[0-9a-f]{64}; the log's signed tree head has root [0-9a-f]{64}\\. Save the log's answers to /v1/sth and /v1/cosignatures\\?treeSize=3: together they are the evidence\\. If the witness is right, the log showed two different histories for one size\\.$`));
  await expect(page.getByRole("heading", { name: /^The receipt is valid: .* But the log check failed: Witness sha256:/ })).toBeVisible();
  for (const other of ["witness-1.pem", "witness-2.pem"]) await expect(page.locator(".check-detail").nth(6)).not.toContainText(fingerprint(other));
});

test("an array of receipts is checked one by one", async ({ page }) => {
  await fill(page, `[${VALID}, ${TAMPERED}]`);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toHaveText("Checked 2 receipts: 1 valid.");
  await expect(page.locator(".report h3")).toHaveText([/^Receipt 1 of 2 is valid/, /^Receipt 2 of 2 is not valid/]);
});

test("a receipt file is read into the field", async ({ page }) => {
  await page.getByLabel("Or choose a receipt file").setInputFiles({ name: "receipt.json", mimeType: "application/json", buffer: Buffer.from(VALID) });
  await expect(page.getByLabel("Receipt", { exact: true })).toHaveValue(VALID);
  await expect(page.getByRole("status")).toHaveText("Read receipt.json.");
});

test("nothing is stored, nothing goes in the address bar, and nothing goes anywhere but the log", async ({ page, baseURL }) => {
  const requests = recordRequests(page);
  await stubLog(page, HONEST);
  const before = page.url();
  await fill(page, VALID, { log: true });
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toHaveText("Checked 1 receipt: 1 valid.");
  expect(page.url()).toBe(before);
  const stored = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    cookie: document.cookie,
    databases: "databases" in indexedDB ? (await indexedDB.databases()).length : 0,
  }));
  expect(stored).toEqual({ local: 0, session: 0, cookie: "", databases: 0 });
  const site = new URL(baseURL ?? "").origin;
  for (const r of requests) {
    expect(r.method()).toBe("GET");
    expect([site, LOG]).toContain(new URL(r.url()).origin);
  }
});

test("a browser without WebCrypto Ed25519, or whose WebCrypto says yes to everything, is told so, and no checks run", async ({ page, context }) => {
  await page.addInitScript(() => {
    const original = crypto.subtle.importKey.bind(crypto.subtle);
    crypto.subtle.importKey = ((...args: Parameters<SubtleCrypto["importKey"]>) => {
      const alg = args[2];
      if ((typeof alg === "string" ? alg : alg.name) === "Ed25519") return Promise.reject(new DOMException("Ed25519", "NotSupportedError"));
      return original(...args);
    }) as SubtleCrypto["importKey"];
  });
  await page.goto("./");
  await expect(page.getByText("This browser cannot check Ed25519 signatures")).toBeVisible();
  await expect(page.locator("#check-form")).toBeHidden();
  const yes = await context.newPage();
  await yes.addInitScript(() => {
    crypto.subtle.verify = () => Promise.resolve(true);
  });
  await yes.goto("./");
  await expect(yes.getByText("This browser cannot check Ed25519 signatures")).toBeVisible();
  await expect(yes.locator("#check-form")).toBeHidden();
});

test("inside another site's frame, the page refuses to run and says so", async ({ page, context, baseURL, browserName }) => {
  // Another origin that embeds the check page, as a site dressing up its verdicts would: localhost is
  // not 127.0.0.1. The page is stubbed, so Chromium takes it for a public one, and lets it frame the
  // local test server only from a secure context (localhost is one) with the local network access permission.
  if (browserName === "chromium") await context.grantPermissions(["local-network-access"]);
  const embedder = new URL("/embedder.html", (baseURL ?? "").replace("127.0.0.1", "localhost")).href;
  await page.route(embedder, (route) =>
    route.fulfill({ contentType: "text/html", body: `<!doctype html><title>Embedder</title><iframe src="${baseURL ?? ""}" title="Embedded check page"></iframe>` }),
  );
  await page.goto(embedder);
  const frame = page.frameLocator("iframe");
  await expect(frame.getByText("This page checks receipts only at its own address, not inside another page.")).toBeVisible();
  await expect(frame.getByRole("link", { name: "Open it on its own" })).toHaveAttribute("target", "_top");
  await expect(frame.locator("#check-form")).toBeHidden();
  await expect(frame.locator("#needs-js")).toBeHidden();
});

test("the whole flow works from the keyboard", async ({ page, browserName }) => {
  // WebKit on macOS, like Safari, moves Tab past links and buttons unless the
  // visitor asks it not to; Option-Tab (Alt+Tab) reaches every one, as in
  // Safari. Elsewhere (Linux, in CI) WebKit's Tab reaches them, and Option
  // does not change what Tab reaches, so plain Tab is the key there.
  const tab = browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
  /** Presses Tab until `target` has focus, at most `max` times. */
  const tabTo = async (target: Locator, max: number): Promise<void> => {
    for (let i = 0; i < max && !(await target.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press(tab);
    await expect(target).toBeFocused();
  };
  await page.keyboard.press(tab);
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await tabTo(page.getByLabel("Receipt", { exact: true }), 10);
  await page.keyboard.insertText(VALID);
  await tabTo(page.getByLabel("Issuer's public key"), 5);
  await page.keyboard.insertText(ISSUER);
  await tabTo(page.getByRole("button", { name: "Check" }), 5);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Checked 1 receipt: 1 valid.");
  await expect(page.locator("#results-heading")).toBeFocused();
});

test("a new run hides the last run's results and retry: a missing receipt shows only the problem", async ({ page }) => {
  await stubLog(page, {});
  await fill(page, VALID, { log: true });
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("button", { name: "Try the log again" })).toBeVisible();
  await page.getByLabel("Receipt", { exact: true }).fill("");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.locator("#problems")).toBeFocused();
  await expect(page.locator("#results")).toBeHidden();
  await expect(page.locator("#retry")).toBeHidden();
  await expect(page.locator(".report")).toHaveCount(0);
});

test("a second submit during a run is ignored: the button is aria-disabled, the log is asked once, and there is one result", async ({ page }) => {
  const requests = recordRequests(page);
  await stubLog(page, HONEST);
  await fill(page, VALID, { log: true });
  const during = await page.locator("#check-form").evaluate((f: HTMLFormElement) => {
    f.requestSubmit();
    f.requestSubmit();
    const button = f.querySelector("button[type=submit]");
    return button instanceof HTMLButtonElement ? [button.disabled, button.getAttribute("aria-disabled")] : [];
  });
  expect(during).toEqual([false, "true"]);
  await expect(page.getByRole("status")).toHaveText("Checked 1 receipt: 1 valid.");
  await expect(page.getByRole("button", { name: "Check" })).not.toHaveAttribute("aria-disabled");
  await expect(page.locator(".report")).toHaveCount(1);
  expect(requests.filter((r) => r.url().startsWith(`${LOG}/v1/sth`))).toHaveLength(1);
});

test("a log whose tree head is not found (404): the heading and status say the log was not checked, in the log's words without bidi controls", async ({ page }) => {
  await stubLog(page, { ...HONEST, "/v1/sth": { status: 404, body: JSON.stringify({ error: "no tree\u202e head" }) } });
  await fill(page, VALID, { log: true });
  await page.getByRole("button", { name: "Check" }).click();
  const said = "But the log was not checked: the log answered 404 (no tree head). Check the log address.";
  await expect(page.getByRole("status")).toHaveText(`Checked 1 receipt: 1 valid. ${said}`);
  await expect(page.getByRole("heading", { name: /^The receipt is valid: / })).toContainText(said);
  await expect(page.getByRole("status")).not.toContainText("could not be reached");
  await expect(page.getByRole("button", { name: "Try the log again" })).toBeHidden();
  expect(await statusOf(page, "Tree head")).toBe("Not run");
});

test("a log address that answers with a web page: the log was not checked, its answer could not be read, with a retry", async ({ page }) => {
  await stubLog(page, { ...HONEST, "/v1/sth": { status: 200, body: "<!doctype html><title>Not a log</title>", contentType: "text/html" } });
  await fill(page, VALID, { log: true });
  await page.getByRole("button", { name: "Check" }).click();
  const said = "But the log was not checked: The log at log.test answered (status 200), but its answer is not JSON. Check that the address is the log's, not its web page, and try again.";
  await expect(page.getByRole("status")).toHaveText(`Checked 1 receipt: 1 valid. ${said} The log's answer could not be read; you can try it again.`);
  await expect(page.getByRole("heading", { name: /^The receipt is valid: / })).toContainText(said);
  await expect(page.getByRole("status")).not.toContainText("could not be reached");
  await expect(page.getByRole("button", { name: "Try the log again" })).toBeVisible();
});

test("a problem in a log field: its link opens the log section and focuses the field, which names the problem until it is fixed", async ({ page }) => {
  await stubLog(page, HONEST);
  await fill(page, VALID, { log: true });
  await page.getByLabel("Log address").fill("http://log.test");
  await page.getByText("Also check the transparency log (optional)").click();
  await expect(page.getByLabel("Log address")).toBeHidden();
  await page.getByRole("button", { name: "Check" }).click();
  await page.locator("#problems").getByRole("link", { name: "The log address must start with https://." }).click();
  await expect(page.getByLabel("Log address")).toBeFocused();
  await expect(page.getByLabel("Log address")).toHaveAttribute("aria-describedby", "log-address-hint problem-1");
  expect(page.url()).not.toContain("#");
  await page.getByLabel("Log address").fill(LOG);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toHaveText("Checked 1 receipt: 1 valid.");
  await expect(page.getByLabel("Log address")).toHaveAttribute("aria-describedby", "log-address-hint");
  await expect(page.getByLabel("Log address")).not.toHaveAttribute("aria-invalid");
});

test("witness keys given and the cosignatures not checked (503): the heading and status say the log was not checked", async ({ page }) => {
  await stubLog(page, { ...HONEST, "/v1/cosignatures": { status: 503, file: "busy.json" } });
  await fill(page, VALID, { log: true });
  await page.getByRole("button", { name: "Check" }).click();
  const said = "But the log was not checked: the log is busy or failing (it answered 503: server busy). Try again in a minute.";
  await expect(page.getByRole("status")).toHaveText(`Checked 1 receipt: 1 valid. ${said} The log could not be reached, or was busy; you can try it again.`);
  await expect(page.getByRole("heading", { name: /^The receipt is valid: / })).toContainText(said);
  expect(await Promise.all(["Tree head", "In the log", "Witnesses"].map((c) => statusOf(page, c)))).toEqual(["Passed", "Passed", "Not run"]);
});

test("no witness keys: witnesses not run is not a log left unchecked", async ({ page }) => {
  await stubLog(page, HONEST);
  await fill(page, VALID, { log: true });
  await page.getByLabel("Witness public keys").fill("");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toHaveText("Checked 1 receipt: 1 valid.");
  await expect(page.getByRole("heading", { name: /^The receipt is valid: / })).not.toContainText("not checked");
  expect(await statusOf(page, "Witnesses")).toBe("Not run");
});
