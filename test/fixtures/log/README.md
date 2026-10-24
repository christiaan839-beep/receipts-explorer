# Recorded log answers

What a receipts-log would answer (its `API.md`) for a log `stub-log` of three
entries, whose entry 1 is the receipt in
`test/fixtures/conformance/v2-valid-001.json`. Written by
`node scripts/make-stub-log.mjs` with throwaway Ed25519 keys, each derived
from a public label, so they guard nothing; rerunning it writes the same
bytes.

| File | Answer to |
|---|---|
| `sth.json` | `GET /v1/sth`, signed by `log-public-key.pem` |
| `sth-forged.json` | `GET /v1/sth`, with another root under the old signature |
| `sth-empty.json` | `GET /v1/sth` for the empty log (size 0, the root of no bytes), signed by `log-public-key.pem` |
| `inclusion.json` | `GET /v1/proof/inclusion` for entry 1 at size 3 |
| `inclusion-lying-root.json` | the same, with a wrong audit path and a `rootHashHex` that agrees with it |
| `inclusion-other-leaf.json` | a valid proof for entry 0 of the same tree, with entry 0's `leafHashHex` |
| `not-found.json` | the 404 body for a leaf hash the log does not hold |
| `busy.json` | the 503 body when the log is at its in-flight limit |
| `cosignatures-clean.json` | `GET /v1/cosignatures?treeSize=3` from an honest log: witness 1 over `sth.json` and over a later signing of the same tree; witness 2 over an earlier signing (same size and root, another timestamp), listed twice; witness 3 over `sth.json`'s text with a space added, which is not canonical and does not count; and two other roots that are not forks: witness 1 over the log's tree of 2 entries, witness 2 over a tree of 3 entries of another log |
| `cosignatures.json` | the same, and witness 3 over a fork (same log and size, another root) in canonical text under its own key: evidence the log showed two histories |
| `cosignatures-unverified-fork.json` | the same as the clean list, and the fork signed by `other-public-key.pem`, which no test gives as a witness key |
| `cosignatures-fork-noncanonical.json` | the clean list, and witness 3 over the fork's text with a space added: not canonical, so not a fork, and skipped |
| `cosignatures-fork-by-w1.json` | the clean list, and witness 1, which also cosigned the right root, over the fork |
| `cosignatures-fork-by-w1-w3.json` | the clean list, and witnesses 1 and 3 over the fork: both are named |
| `witness-1.pem`, `witness-2.pem`, `witness-3.pem` | the witnesses' keys |
| `other-public-key.pem` | a key that is no one's here: not the log's, the issuer's or a witness's; it signed only the fork in `cosignatures-unverified-fork.json` |

The unit tests (`test/checks.test.ts`) and the Playwright tests (`e2e/`) serve
these in place of a live log, so CI never calls one.
