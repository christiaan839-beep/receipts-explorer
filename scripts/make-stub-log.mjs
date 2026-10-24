// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Writes test/fixtures/log/: the answers a receipts-log would give for a
// three-entry log whose entry 1 is the conformance receipt
// v2-valid-001.json, signed with throwaway keys whose private halves are
// discarded. The unit tests and the Playwright tests serve these files in
// place of a live log, so CI never calls one.
//
// Usage: node scripts/make-stub-log.mjs
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const OUT = new URL("../test/fixtures/log/", import.meta.url);
const receipt = JSON.parse(readFileSync(new URL("../test/fixtures/conformance/v2-valid-001.json", import.meta.url), "utf8")).receipt;
mkdirSync(OUT, { recursive: true });

const leaf = (text) => createHash("sha256").update(Buffer.from([0])).update(text, "utf8").digest("hex");
const inner = (l, r) =>
  createHash("sha256").update(Buffer.from([1])).update(Buffer.from(l, "hex")).update(Buffer.from(r, "hex")).digest("hex");
const keyPair = () => generateKeyPairSync("ed25519");
const pem = (k) => k.export({ type: "spki", format: "pem" });
const v2 = (privateKey, text) => "v2=" + sign(null, Buffer.from(text, "utf8"), privateKey).toString("base64");
const canonicalSth = (h) =>
  JSON.stringify({ logId: h.logId, rootHash: h.rootHash, timestamp: h.timestamp, treeSize: h.treeSize, v: h.v });
const write = (name, value) => writeFileSync(new URL(name, OUT), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");

// The tree: three entries; entry 1 is the conformance receipt.
const leaves = [leaf('{"note":"entry 0"}'), leaf(receipt.canonical), leaf('{"note":"entry 2"}')];
const root = inner(inner(leaves[0], leaves[1]), leaves[2]);

const log = keyPair();
const witnesses = [keyPair(), keyPair(), keyPair()];
write("log-public-key.pem", pem(log.publicKey));
witnesses.forEach((w, i) => write(`witness-${String(i + 1)}.pem`, pem(w.publicKey)));
write("other-public-key.pem", pem(keyPair().publicKey));

const head = { v: 1, logId: "stub-log", treeSize: 3, rootHash: root, timestamp: "2026-10-23T12:00:00.000Z" };
const canonical = canonicalSth(head);
write("sth.json", { ...head, signature: v2(log.privateKey, canonical), canonical });

// A forged tree head: another root, under the log's old signature.
const forgedRoot = inner(leaves[0], leaves[1]);
write("sth-forged.json", { ...head, rootHash: forgedRoot, signature: v2(log.privateKey, canonical), canonical: canonicalSth({ ...head, rootHash: forgedRoot }) });

write("inclusion.json", {
  kind: "inclusion",
  logId: "stub-log",
  leafHashHex: leaves[1],
  leafIndex: 1,
  treeSize: 3,
  auditPath: [leaves[0], leaves[2]],
  rootHashHex: root,
});
// A proof that agrees with its own rootHashHex but not with the signed root.
const fakeSibling = leaf('{"note":"not in the log"}');
write("inclusion-lying-root.json", {
  kind: "inclusion",
  logId: "stub-log",
  leafHashHex: leaves[1],
  leafIndex: 1,
  treeSize: 3,
  auditPath: [leaves[0], fakeSibling],
  rootHashHex: inner(inner(leaves[0], leaves[1]), fakeSibling),
});
write("not-found.json", { error: "leaf hash not in the log" });
write("busy.json", { error: "server busy" });

// Witness 1 cosigned this tree head. Witness 2 cosigned only an earlier
// signing of the same tree (same size and root, another timestamp), which
// counts. Witness 3 cosigned only things that must not count: a tree head
// of the same size with another root (a fork), and this tree head's text
// with a space added, which is not canonical.
const earlier = canonicalSth({ ...head, timestamp: "2026-10-23T11:00:00.000Z" });
const fork = canonicalSth({ ...head, rootHash: forgedRoot, timestamp: "2026-10-23T11:30:00.000Z" });
const spaced = canonical.replace(":3,", ": 3,");
const cosig = (w, id, text) => ({
  witnessId: id,
  treeSize: 3,
  rootHash: root,
  timestamp: JSON.parse(text).timestamp,
  sthCanonical: text,
  signature: v2(w.privateKey, text),
  publicKeyUrl: `https://witness.example/${id}.pem`,
  receivedAt: "2026-10-23T12:00:05.000Z",
});
write("cosignatures.json", {
  treeSize: 3,
  cosignatures: [
    cosig(witnesses[0], "w1", canonical),
    cosig(witnesses[1], "w2", earlier),
    cosig(witnesses[2], "w3", fork),
    cosig(witnesses[2], "w3", spaced),
  ],
});
console.log(`wrote ${OUT.pathname}`);
