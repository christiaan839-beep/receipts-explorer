// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// The check page: reads the form, runs the checks, and shows the results.
// Everything is built with textContent, never parsed as HTML, and nothing
// the visitor gives is stored, put in the address bar or sent anywhere
// but the log address they typed.
import CHECKS from "../content/checks.json" with { type: "json" };
import { checkReceipts, show, type CheckResult, type Inputs, type ReceiptReport } from "./checks.ts";
import { hasEd25519 } from "./ed25519-support.ts";
import { MAX_INPUT_CHARS, parseReceipts } from "./input.ts";
import { KeyError, parsePublicKeys, type PublicKey } from "./keys.ts";
import { LogClient, parseLogAddress } from "./log-client.ts";

interface Problem {
  field: string;
  message: string;
}

const STATUS_LABEL: Record<CheckResult["status"], string> = { passed: "Passed", failed: "Failed", "not-run": "Not run" };

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

async function readKeys(text: string, field: string, source: string, problems: Problem[]): Promise<PublicKey[]> {
  try {
    return await parsePublicKeys(text, source);
  } catch (e) {
    problems.push({ field, message: e instanceof KeyError ? e.message : `${source} could not be read.` });
    return [];
  }
}

/** Reads the form into inputs for the checks, or the problems to show. */
async function readForm(doc: Document): Promise<{ receipts: unknown[]; inputs: Inputs } | { problems: Problem[] }> {
  const problems: Problem[] = [];
  const value = (id: string): string => textField(doc, id).value;
  const parsed = parseReceipts(value("receipt-text"));
  if (!parsed.ok) problems.push({ field: "receipt-text", message: parsed.reason });
  const issuerKeys = await readKeys(value("issuer-key"), "issuer-key", "The issuer key", problems);
  if (issuerKeys.length === 0 && !problems.some((p) => p.field === "issuer-key")) {
    problems.push({ field: "issuer-key", message: "Paste the issuer's public key (a PEM block), or choose its file." });
  }
  let log: Inputs["log"];
  const address = value("log-address").trim();
  const logKeyText = value("log-key");
  const witnessText = value("witness-keys");
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

function renderProblems(doc: Document, problems: Problem[]): void {
  const box = byId(doc, "problems");
  box.replaceChildren(el(doc, "h2", undefined, problems.length === 1 ? "There is a problem" : `There are ${String(problems.length)} problems`));
  const list = el(doc, "ul");
  for (const p of problems) {
    const field = byId(doc, p.field);
    field.setAttribute("aria-invalid", "true");
    const a = el(doc, "a", undefined, p.message);
    a.href = `#${p.field}`;
    const li = el(doc, "li");
    li.append(a);
    list.append(li);
  }
  box.append(list);
  box.hidden = false;
  box.focus();
}

function renderCheck(doc: Document, c: CheckResult): HTMLLIElement {
  const info = CHECKS.find((x) => x.id === c.id);
  const li = el(doc, "li", `check check--${c.network ? "network" : c.status}`);
  const head = el(doc, "p", "check-head");
  head.append(el(doc, "span", "check-status", c.network ? "Network error" : STATUS_LABEL[c.status]), " ");
  const name = el(doc, "a", "check-name", info?.name ?? c.id);
  name.href = `terms/${info?.term ?? ""}/`;
  head.append(name);
  li.append(head, el(doc, "p", "check-detail", c.detail));
  if (info !== undefined) {
    li.append(el(doc, "p", "check-proves", `What it proves: ${info.proves}`), el(doc, "p", "check-limits", `What it does not prove: ${info.doesNotProve}`));
  }
  return li;
}

/** The first of checks 5 to 7 that failed, for a receipt that is valid on its own: said beside the verdict, never hidden by it. */
function failedLogCheck(report: ReceiptReport): CheckResult | undefined {
  return report.valid ? report.checks.slice(4).find((c) => c.status === "failed") : undefined;
}

function renderReport(doc: Document, report: ReceiptReport, index: number, total: number): HTMLElement {
  const article = el(doc, "article", `report report--${report.valid ? "valid" : "invalid"}`);
  const label = total === 1 ? "The receipt" : `Receipt ${String(index + 1)} of ${String(total)}`;
  const firstFailure = report.checks.find((c) => c.status === "failed");
  const logFailure = failedLogCheck(report);
  const verdict = report.valid
    ? `${label} is valid: signed by ${report.key ?? "the issuer key"}, and unchanged since.${logFailure === undefined ? "" : ` But the log check failed: ${logFailure.detail}`}`
    : `${label} is not valid. ${firstFailure?.detail ?? "A check did not pass."}`;
  article.append(el(doc, "h3", undefined, verdict));
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
  const status = byId(doc, "status");
  const results = byId(doc, "results");
  const list = byId(doc, "results-list");
  const problemsBox = byId(doc, "problems");
  problemsBox.hidden = true;
  for (const f of doc.querySelectorAll("[aria-invalid]")) f.removeAttribute("aria-invalid");
  status.textContent = "Checking…";
  const form = await readForm(doc);
  if ("problems" in form) {
    status.textContent = "";
    renderProblems(doc, form.problems);
    return;
  }
  let reports: ReceiptReport[];
  try {
    reports = await checkReceipts(form.receipts, form.inputs);
  } catch {
    status.textContent = "The checks stopped on an error this page did not expect. Nothing was sent; reload the page and try again.";
    return;
  }
  list.replaceChildren(...reports.map((r, i) => renderReport(doc, r, i, reports.length)));
  const retry = reports.some((r) => r.checks.some((c) => c.retry));
  byId(doc, "retry").hidden = !retry;
  results.hidden = false;
  const validCount = reports.filter((r) => r.valid).length;
  const logFailure = reports.map(failedLogCheck).find((c) => c !== undefined);
  status.textContent = `Checked ${String(reports.length)} ${reports.length === 1 ? "receipt" : "receipts"}: ${String(validCount)} valid.${logFailure === undefined ? "" : ` But the log check failed: ${logFailure.detail}`}${retry ? " The log could not be reached, or was busy; you can try it again." : ""}`;
  byId(doc, "results-heading").focus();
}

/** Reads a chosen or dropped file into a text field. */
function loadFileInto(doc: Document, file: File, target: HTMLTextAreaElement): void {
  if (file.size > MAX_INPUT_CHARS) {
    byId(doc, "status").textContent = `${file.name} is larger than 5 MB, so it was not read.`;
    return;
  }
  void file.text().then((text) => {
    target.value = text;
    byId(doc, "status").textContent = `Read ${file.name}.`;
  });
}

function wireFiles(doc: Document): void {
  for (const input of doc.querySelectorAll<HTMLInputElement>("input[type=file][data-into]")) {
    const target = byId(doc, input.dataset.into ?? "");
    if (!(target instanceof HTMLTextAreaElement)) throw new Error(`${input.id} must load into a textarea`);
    input.addEventListener("change", () => {
      const file = input.files?.[0];
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

export async function start(doc: Document): Promise<void> {
  const form = byId(doc, "check-form");
  if (!(await hasEd25519())) {
    byId(doc, "no-ed25519").hidden = false;
    return;
  }
  wireFiles(doc);
  let running = false;
  const go = (): void => {
    if (running) return;
    running = true;
    void run(doc).finally(() => {
      running = false;
    });
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    go();
  });
  byId(doc, "retry").addEventListener("click", go);
  form.hidden = false;
}
