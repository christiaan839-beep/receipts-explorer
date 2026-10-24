# Recorded log answers

What a receipts-log would answer (its `API.md`) for a log `stub-log` of three
entries, whose entry 1 is the receipt in
`test/fixtures/conformance/v2-valid-001.json`. Written by
`node scripts/make-stub-log.mjs` with throwaway Ed25519 keys whose private
halves were discarded; rerunning it writes new keys and signatures.

| File | Answer to |
|---|---|
| `sth.json` | `GET /v1/sth`, signed by `log-public-key.pem` |
| `sth-forged.json` | `GET /v1/sth`, with another root under the old signature |
| `inclusion.json` | `GET /v1/proof/inclusion` for entry 1 at size 3 |
| `inclusion-lying-root.json` | the same, with a wrong audit path and a `rootHashHex` that agrees with it |
| `not-found.json` | the 404 body for a leaf hash the log does not hold |
| `busy.json` | the 503 body when the log is at its in-flight limit |
| `cosignatures.json` | `GET /v1/cosignatures?treeSize=3`: witness 1 over `sth.json`; witness 2 over an earlier signing of the same tree (same size and root, another timestamp), which counts; witness 3 over a fork (same size, another root) and over `sth.json`'s text with a space added, neither of which counts |
| `witness-1.pem`, `witness-2.pem`, `witness-3.pem` | the witnesses' keys |
| `other-public-key.pem` | a key that signed nothing here |

The unit tests (`test/checks.test.ts`) and the Playwright tests (`e2e/`) serve
these in place of a live log, so CI never calls one.
