// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Writes test/fixtures/log/: the answers a receipts-log would give for a
// three-entry log whose entry 1 is the conformance receipt
// v2-valid-001.json, signed with throwaway keys. Each key is derived from
// a public label (its seed is the SHA-256 of the label), so the keys guard
// nothing, and every run writes the same bytes: Ed25519 signatures are
// deterministic. The unit tests and the Playwright tests serve these files
// in place of a live log, so CI never calls one.
//
// Usage: node scripts/make-stub-log.mjs
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const OUT = new URL("../test/fixtures/log/", import.meta.url);
const receipt = JSON.parse(readFileSync(new URL("../test/fixtures/conformance/v2-valid-001.json", import.meta.url), "utf8")).receipt;
mkdirSync(OUT, { recursive: true });

const leaf = (text) => createHash("sha256").update(Buffer.from([0])).update(text, "utf8").digest("hex");
const inner = (l, r) =>
  createHash("sha256").update(Buffer.from([1])).update(Buffer.from(l, "hex")).update(Buffer.from(r, "hex")).digest("hex");
// An Ed25519 key pair whose 32-byte seed is the SHA-256 of a public label,
// after the fixed PKCS #8 prefix of an Ed25519 private key (RFC 8410).
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const keyPair = (label) => {
  const seed = createHash("sha256").update(`receipts-explorer stub log: ${label}`, "utf8").digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  return { privateKey, publicKey: createPublicKey(privateKey) };
};
const pem = (k) => k.export({ type: "spki", format: "pem" });
const v2 = (privateKey, text) => "v2=" + sign(null, Buffer.from(text, "utf8"), privateKey).toString("base64");
const canonicalSth = (h) =>
  JSON.stringify({ logId: h.logId, rootHash: h.rootHash, timestamp: h.timestamp, treeSize: h.treeSize, v: h.v });
const write = (name, value) => writeFileSync(new URL(name, OUT), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");

// The tree: three entries; entry 1 is the conformance receipt.
const leaves = [leaf('{"note":"entry 0"}'), leaf(receipt.canonical), leaf('{"note":"entry 2"}')];
const root = inner(inner(leaves[0], leaves[1]), leaves[2]);

const log = keyPair("log");
const witnesses = [keyPair("witness 1"), keyPair("witness 2"), keyPair("witness 3")];
const other = keyPair("other");
write("log-public-key.pem", pem(log.publicKey));
witnesses.forEach((w, i) => write(`witness-${String(i + 1)}.pem`, pem(w.publicKey)));
write("other-public-key.pem", pem(other.publicKey));

const head = { v: 1, logId: "stub-log", treeSize: 3, rootHash: root, timestamp: "2026-10-23T12:00:00.000Z" };
const canonical = canonicalSth(head);
write("sth.json", { ...head, signature: v2(log.privateKey, canonical), canonical });

// A forged tree head: another root, under the log's old signature.
const forgedRoot = inner(leaves[0], leaves[1]);
write("sth-forged.json", { ...head, rootHash: forgedRoot, signature: v2(log.privateKey, canonical), canonical: canonicalSth({ ...head, rootHash: forgedRoot }) });

// The empty log: size 0, whose root is the SHA-256 of no bytes, signed by the log.
const empty = { v: 1, logId: "stub-log", treeSize: 0, rootHash: createHash("sha256").digest("hex"), timestamp: "2026-10-23T12:00:00.000Z" };
const emptyCanonical = canonicalSth(empty);
write("sth-empty.json", { ...empty, signature: v2(log.privateKey, emptyCanonical), canonical: emptyCanonical });

write("inclusion.json", {
  kind: "inclusion",
  logId: "stub-log",
  leafHashHex: leaves[1],
  leafIndex: 1,
  treeSize: 3,
  auditPath: [leaves[0], leaves[2]],
  rootHashHex: root,
});
// A valid proof for another entry of the same tree (entry 0), carrying that entry's leaf hash.
write("inclusion-other-leaf.json", {
  kind: "inclusion",
  logId: "stub-log",
  leafHashHex: leaves[0],
  leafIndex: 0,
  treeSize: 3,
  auditPath: [leaves[1], leaves[2]],
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

// Cosignatures. Witness 1 cosigned this tree head, and again at a later
// timestamp (same size and root). Witness 2 cosigned only an earlier
// signing of the same tree (same size and root, another timestamp), which
// counts; the log lists that cosignature twice. Witness 3 cosigned only
// this tree head's text with a space added, which is not canonical and
// does not count. Each witness counts once, however many of its
// cosignatures are listed. Witness 1 also cosigned the log's earlier tree
// of 2 entries, and witness 2 a tree of 3 entries of another log: other
// roots, but not forks, since the size or the log differs.
const earlier = canonicalSth({ ...head, timestamp: "2026-10-23T11:00:00.000Z" });
const later = canonicalSth({ ...head, timestamp: "2026-10-23T12:30:00.000Z" });
const fork = canonicalSth({ ...head, rootHash: forgedRoot, timestamp: "2026-10-23T11:30:00.000Z" });
const spaced = canonical.replace(":3,", ": 3,");
const smaller = canonicalSth({ ...head, treeSize: 2, rootHash: forgedRoot, timestamp: "2026-10-23T10:00:00.000Z" });
const anotherLog = canonicalSth({ ...head, logId: "another-log", rootHash: forgedRoot });
const cosig = (w, id, text) => ({
  witnessId: id,
  treeSize: JSON.parse(text).treeSize,
  rootHash: JSON.parse(text).rootHash,
  timestamp: JSON.parse(text).timestamp,
  sthCanonical: text,
  signature: v2(w.privateKey, text),
  publicKeyUrl: `https://witness.example/${id}.pem`,
  receivedAt: "2026-10-23T12:00:05.000Z",
});
const clean = [
  cosig(witnesses[0], "w1", canonical),
  cosig(witnesses[1], "w2", earlier),
  cosig(witnesses[2], "w3", spaced),
  cosig(witnesses[0], "w1", later),
  cosig(witnesses[1], "w2", earlier),
  cosig(witnesses[0], "w1", smaller),
  cosig(witnesses[1], "w2", anotherLog),
];
write("cosignatures-clean.json", { treeSize: 3, cosignatures: clean });
// The same, and witness 3 also cosigned a fork: a tree head of the same log
// and size with another root, in canonical text, under its own key.
write("cosignatures.json", { treeSize: 3, cosignatures: [...clean, cosig(witnesses[2], "w3", fork)] });
// The same fork, but signed by a key nobody gives as a witness's.
write("cosignatures-unverified-fork.json", { treeSize: 3, cosignatures: [...clean, cosig(other, "w3", fork)] });
// The same fork in text that is not canonical (a space added), signed by witness 3: not a fork, since the text is not a tree head's.
write("cosignatures-fork-noncanonical.json", { treeSize: 3, cosignatures: [...clean, cosig(witnesses[2], "w3", fork.replace(":3,", ": 3,"))] });
// The fork signed by witness 1, which also cosigned the right root: still a fork.
write("cosignatures-fork-by-w1.json", { treeSize: 3, cosignatures: [...clean, cosig(witnesses[0], "w1", fork)] });
// The fork signed by witnesses 1 and 3: both are named.
write("cosignatures-fork-by-w1-w3.json", { treeSize: 3, cosignatures: [...clean, cosig(witnesses[0], "w1", fork), cosig(witnesses[2], "w3", fork)] });
console.log(`wrote ${OUT.pathname}`);
