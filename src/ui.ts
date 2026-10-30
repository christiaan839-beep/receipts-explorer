// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// The check page: reads the form, runs the checks, and shows the results.
// Everything is built with textContent, never parsed as HTML, and nothing
// the visitor gives is stored, put in the address bar or sent anywhere
// but the log address they typed.
import CHECKS from "../content/checks.json" with { type: "json" };
import { Ed25519Unavailable } from "./bytes.ts";
import { checkReceipts, show, type CheckId, type CheckResult, type Inputs, type ReceiptReport } from "./checks.ts";
import { hasEd25519 } from "./ed25519-support.ts";
import { MAX_INPUT_CHARS, parseReceipts } from "./input.ts";
import { KeyError, parsePublicKeys, type PublicKey } from "./keys.ts";
import { LogClient, parseLogAddress } from "./log-client.ts";
import { UNSAFE_TEXT } from "./tree-head.ts";

interface Problem {
  field: string;
  message: string;
}

const STATUS_LABEL: Record<CheckResult["status"], string> = { passed: "Passed", failed: "Failed", "not-run": "Not run" };

/** Checks 1 to 4: whether the receipt itself is valid. */
const RECEIPT_CHECKS: readonly CheckId[] = ["format", "signature", "content-hash", "repeated-fields"];
/** Checks 5 to 7: what the log says. */
const LOG_CHECKS: readonly CheckId[] = ["tree-head", "in-log", "witnesses"];

/** The id prefix of problem links, which a field's aria-describedby names. */
const PROBLEM_ID = "problem-";

const UNSAFE_ALL = new RegExp(UNSAFE_TEXT.source, "gu");

/** A check's detail without control or bidirectional characters: it can quote the log's own error text. */
function detailOf(c: CheckResult): string {
  return c.detail.replace(UNSAFE_ALL, "");
}

function byId(doc: Document, id: string): HTMLElement {
  const found = doc.getElementById(id);
  if (found === null) throw new Error(`missing #${id}`);
  return found;
}

function textField(doc: Document, id: string): HTMLInputElement | HTMLTextAreaElement {
  const found = byId(doc, id);
  if (!(found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement)) throw new Error(`#${id} is not a text field`);
  return found;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (className !== undefined) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Text with each key fingerprint in a span.hash, so a narrow screen breaks
 * the fingerprint inside itself rather than leaving the punctuation after it
 * alone on the next line. Text nodes only: nothing is parsed as HTML.
 */
function withHashes<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  let at = 0;
  for (const m of text.matchAll(/sha256:[0-9a-f]+/g)) {
    if (m.index > at) e.append(text.slice(at, m.index));
    e.append(el(doc, "span", "hash", m[0]));
    at = m.index + m[0].length;
  }
  if (at < text.length) e.append(text.slice(at));
  return e;
}

async function readKeys(text: string, field: string, source: string, problems: Problem[]): Promise<PublicKey[]> {
  try {
    return await parsePublicKeys(text, source);
  } catch (e) {
    problems.push({ field, message: e instanceof KeyError || e instanceof Ed25519Unavailable ? e.message : `${source} could not be read.` });
    return [];
  }
}

/** Reads the form into inputs for the checks, or the problems to show. Every field is read before the first await. */
async function readForm(doc: Document): Promise<{ receipts: unknown[]; inputs: Inputs } | { problems: Problem[] }> {
  const problems: Problem[] = [];
  const value = (id: string): string => textField(doc, id).value;
  const receiptText = value("receipt-text");
  const issuerText = value("issuer-key");
  const address = value("log-address").trim();
  const logKeyText = value("log-key");
  const witnessText = value("witness-keys");
  const parsed = parseReceipts(receiptText);
  if (!parsed.ok) problems.push({ field: "receipt-text", message: parsed.reason });
  const issuerKeys = await readKeys(issuerText, "issuer-key", "The issuer key", problems);
  if (issuerKeys.length === 0 && !problems.some((p) => p.field === "issuer-key")) {
    problems.push({ field: "issuer-key", message: "Paste the issuer's public key (a PEM block), or choose its file." });
  }
  let log: Inputs["log"];
  if (address !== "") {
    const parsedAddress = parseLogAddress(address);
    const logKeys = await readKeys(logKeyText, "log-key", "The log key", problems);
    const witnessKeys = await readKeys(witnessText, "witness-keys", "The witness keys", problems);
    if (logKeys.length > 1) problems.push({ field: "log-key", message: "Paste one log key: a log signs with one key." });
    if (!parsedAddress.ok) problems.push({ field: "log-address", message: parsedAddress.reason });
    else log = { client: new LogClient(parsedAddress.base), logKey: logKeys[0], witnessKeys };
  } else if (logKeyText.trim() !== "" || witnessText.trim() !== "") {
    problems.push({ field: "log-address", message: "Give the log's address too, or clear the log and witness keys." });
  }
  if (problems.length > 0 || !parsed.ok) return { problems };
  return { receipts: parsed.receipts, inputs: { issuerKeys, log } };
}

/** Takes away the marks a previous run left on the fields: aria-invalid, and the problem ids in aria-describedby. */
function clearFieldMarks(doc: Document): void {
  for (const f of doc.querySelectorAll("[aria-invalid]")) f.removeAttribute("aria-invalid");
  for (const f of doc.querySelectorAll("[aria-describedby]")) {
    const kept = (f.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((t) => t !== "" && !t.startsWith(PROBLEM_ID));
    if (kept.length > 0) f.setAttribute("aria-describedby", kept.join(" "));
    else f.removeAttribute("aria-describedby");
  }
}

/** Opens the <details> a field is in, if any, and moves focus to the field. */
function goToField(field: HTMLElement): void {
  const details = field.closest("details");
  if (details !== null) details.open = true;
  field.focus();
}

function renderProblems(doc: Document, problems: Problem[]): void {
  const box = byId(doc, "problems");
  box.replaceChildren(el(doc, "h2", undefined, problems.length === 1 ? "There is a problem" : `There are ${String(problems.length)} problems`));
  const list = el(doc, "ul");
  problems.forEach((p, i) => {
    const field = byId(doc, p.field);
    const id = `${PROBLEM_ID}${String(i + 1)}`;
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-describedby", `${field.getAttribute("aria-describedby") ?? ""} ${id}`.trim());
    const a = el(doc, "a", undefined, p.message);
    a.id = id;
    a.href = `#${p.field}`;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      goToField(field);
    });
    const li = el(doc, "li");
    li.append(a);
    list.append(li);
  });
  box.append(list);
  box.hidden = false;
  box.focus();
}

/** An error the checks did not expect: no results, and the problem box says so and takes focus, so the page is never left on Checking. */
function renderFailure(doc: Document): void {
  const message = "The checks stopped on an error this page did not expect. Nothing was sent; reload the page and try again.";
  for (const id of ["results", "retry"]) {
    const e = doc.getElementById(id);
    if (e !== null) e.hidden = true;
  }
  doc.getElementById("results-list")?.replaceChildren();
  const status = doc.getElementById("status");
  const box = doc.getElementById("problems");
  if (box === null) {
    if (status !== null) status.textContent = message;
    return;
  }
  if (status !== null) status.textContent = "";
  box.replaceChildren(el(doc, "h2", undefined, "The checks stopped"), el(doc, "p", undefined, message));
  box.hidden = false;
  box.focus();
}

function renderCheck(doc: Document, c: CheckResult): HTMLLIElement {
  const info = CHECKS.find((x) => x.id === c.id);
  const li = el(doc, "li", `check check--${c.network ? "network" : c.status}`);
  const head = el(doc, "p", "check-head");
  head.append(el(doc, "span", "check-status", c.network ? "Network error" : STATUS_LABEL[c.status]), " ");
  const name = el(doc, "a", "check-name", info?.name ?? c.id);
  name.href = `glossary/${info?.term ?? ""}/`;
  head.append(name);
  li.append(head, el(doc, "p", "check-detail", detailOf(c)));
  if (info !== undefined) {
    li.append(el(doc, "p", "check-proves", `What it proves: ${info.proves}`), el(doc, "p", "check-limits", `What it does not prove: ${info.doesNotProve}`));
  }
  return li;
}

/**
 * The log checks the visitor asked for, which must run for the log to count
 * as checked: none without a log address; the tree head and the proof with
 * one; and the witnesses too when witness keys were given.
 */
function askedOfLog(inputs: Inputs): readonly CheckId[] {
  if (inputs.log === undefined) return [];
  return inputs.log.witnessKeys.length > 0 ? LOG_CHECKS : ["tree-head", "in-log"];
}

/**
 * What to say beside the verdict of a receipt that is valid on its own, so
 * the verdict never hides the log: the first of checks 5 to 7 that failed,
 * or else the first log check the visitor asked for that was not run.
 */
function logNote(report: ReceiptReport, asked: readonly CheckId[]): string {
  if (!report.valid) return "";
  const failed = report.checks.find((c) => LOG_CHECKS.includes(c.id) && c.status === "failed");
  if (failed !== undefined) return ` But the log check failed: ${detailOf(failed)}`;
  const notRun = report.checks.find((c) => asked.includes(c.id) && c.status === "not-run");
  if (notRun === undefined) return "";
  const why = detailOf(notRun);
  return ` But the log was not checked: ${why.startsWith("Not run: ") ? why.slice("Not run: ".length) : why}`;
}

/** Why asking the log again may help: it was not reached or was busy, or its answer could not be read. */
function retryCause(c: CheckResult): "reach" | "unreadable" | undefined {
  return c.cause === "network" || c.cause === "busy" ? "reach" : c.cause;
}

function renderReport(doc: Document, report: ReceiptReport, index: number, total: number, asked: readonly CheckId[]): HTMLElement {
  const article = el(doc, "article", `report report--${report.valid ? "valid" : "invalid"}`);
  const label = total === 1 ? "The receipt" : `Receipt ${String(index + 1)} of ${String(total)}`;
  const own = report.checks.filter((c) => RECEIPT_CHECKS.includes(c.id));
  const reason = own.find((c) => c.status === "failed") ?? own.find((c) => c.status !== "passed");
  const verdict = report.valid
    ? `${label} is valid: signed by ${report.key ?? "the issuer key"}, and unchanged since.${logNote(report, asked)}`
    : `${label} is not valid. ${reason === undefined ? "A check did not pass." : detailOf(reason)}`;
  article.append(withHashes(doc, "h3", verdict));
  const list = el(doc, "ol", "checks");
  for (const c of report.checks) list.append(renderCheck(doc, c));
  article.append(list);
  if (report.action !== undefined) {
    article.append(el(doc, "h4", undefined, "The signed action"));
    article.append(el(doc, "pre", "action", JSON.stringify(report.action, null, 2)));
    if (report.repeated.length > 0) {
      const table = el(doc, "table", "repeated");
      table.append(el(doc, "caption", undefined, "Fields repeated beside the signed text"));
      const headRow = el(doc, "tr");
      for (const h of ["Field", "Beside the signed text", "In the signed text", "Same"]) {
        const th = el(doc, "th", undefined, h);
        th.scope = "col";
        headRow.append(th);
      }
      const thead = el(doc, "thead");
      thead.append(headRow);
      table.append(thead);
      const tbody = el(doc, "tbody");
      for (const r of report.repeated) {
        const row = el(doc, "tr");
        const th = el(doc, "th", undefined, r.field);
        th.scope = "row";
        row.append(th, el(doc, "td", undefined, show(r.beside)), el(doc, "td", undefined, r.signed === undefined ? "(not there)" : show(r.signed)), el(doc, "td", undefined, r.same ? "Yes" : "No"));
        tbody.append(row);
      }
      table.append(tbody);
      const wrap = el(doc, "div", "table-wrap");
      wrap.tabIndex = 0;
      wrap.setAttribute("role", "region");
      wrap.setAttribute("aria-label", "Fields repeated beside the signed text");
      wrap.append(table);
      article.append(wrap);
    }
  }
  return article;
}

async function run(doc: Document): Promise<void> {
  try {
    const status = byId(doc, "status");
    const results = byId(doc, "results");
    const list = byId(doc, "results-list");
    const retryButton = byId(doc, "retry");
    // Nothing from the last run stays on show while this one runs.
    results.hidden = true;
    list.replaceChildren();
    retryButton.hidden = true;
    byId(doc, "problems").hidden = true;
    clearFieldMarks(doc);
    status.textContent = "Checking…";
    const form = await readForm(doc);
    if ("problems" in form) {
      status.textContent = "";
      renderProblems(doc, form.problems);
      return;
    }
    const asked = askedOfLog(form.inputs);
    const reports = await checkReceipts(form.receipts, form.inputs);
    list.replaceChildren(...reports.map((r, i) => renderReport(doc, r, i, reports.length, asked)));
    const causes = new Set(reports.flatMap((r) => r.checks.map(retryCause)));
    retryButton.hidden = !(causes.has("reach") || causes.has("unreadable"));
    results.hidden = false;
    const validCount = reports.filter((r) => r.valid).length;
    const note = reports.map((r) => logNote(r, asked)).find((n) => n !== "") ?? "";
    status.textContent =
      `Checked ${String(reports.length)} ${reports.length === 1 ? "receipt" : "receipts"}: ${String(validCount)} valid.${note}` +
      (causes.has("reach") ? " The log could not be reached, or was busy; you can try it again." : "") +
      (causes.has("unreadable") ? " The log's answer could not be read; you can try it again." : "");
    byId(doc, "results-heading").focus();
  } catch {
    renderFailure(doc);
  }
}

/** Reads a chosen or dropped file into a text field. */
function loadFileInto(doc: Document, file: File, target: HTMLTextAreaElement): void {
  const status = byId(doc, "status");
  if (file.size > MAX_INPUT_CHARS) {
    status.textContent = `${file.name} is larger than 5 MB, so it was not read.`;
    return;
  }
  file.text().then(
    (text) => {
      target.value = text;
      status.textContent = `Read ${file.name}.`;
    },
    () => {
      status.textContent = `${file.name} could not be read. Choose it again, or paste its text.`;
    },
  );
}

function wireFiles(doc: Document): void {
  for (const input of doc.querySelectorAll<HTMLInputElement>("input[type=file][data-into]")) {
    const target = byId(doc, input.dataset.into ?? "");
    if (!(target instanceof HTMLTextAreaElement)) throw new Error(`${input.id} must load into a textarea`);
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      // Cleared, so that choosing the same file again reads it again.
      input.value = "";
      if (file !== undefined) loadFileInto(doc, file, target);
    });
    target.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    target.addEventListener("drop", (e) => {
      const file = e.dataTransfer?.files[0];
      if (file === undefined) return;
      e.preventDefault();
      loadFileInto(doc, file, target);
    });
  }
}

/**
 * Whether the page is inside another page's frame, or has no window. GitHub
 * Pages sends no headers, so frame-ancestors cannot be set; the page refuses
 * to run framed instead, so another site cannot dress up its verdicts.
 */
function framed(doc: Document): boolean {
  const view = doc.defaultView;
  return view === null || view.top !== view.self;
}

export async function start(doc: Document): Promise<void> {
  // The page says checking needs JavaScript until here, so a script that is
  // blocked, or refused for a changed hash, still leaves the page explained.
  byId(doc, "needs-js").hidden = true;
  if (framed(doc)) {
    byId(doc, "framed").hidden = false;
    return;
  }
  const form = byId(doc, "check-form");
  if (!(await hasEd25519())) {
    byId(doc, "no-ed25519").hidden = false;
    return;
  }
  wireFiles(doc);
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
  // aria-disabled and the guard, not the disabled property, so a button that
  // has focus keeps it while a run is in progress.
  let running = false;
  const busy = (on: boolean): void => {
    running = on;
    if (on) button?.setAttribute("aria-disabled", "true");
    else button?.removeAttribute("aria-disabled");
  };
  const go = (): void => {
    if (running) return;
    busy(true);
    void run(doc).finally(() => {
      busy(false);
    });
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    go();
  });
  byId(doc, "retry").addEventListener("click", go);
  form.hidden = false;
}
