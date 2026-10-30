# Ed25519 edge vectors

Sixteen Ed25519 signatures on the edges of RFC 8032, in the style of
Wycheproof and "Taming the many EdDSAs" (Chalkias et al., 2020): a
non-canonical `S` (`S + L`, `S + 2L`, `S = L`), small-order and mixed-order
public keys, small-order and non-canonical `R`, non-canonical key encodings,
and points not on the curve. They were built with BigInt curve arithmetic by
the review of Plan 3, Task 3, on 24 October 2026, with fresh random keys.

Each entry has the key as base64 SPKI DER (`spki`), the message and signature
as hex (`msg`, `sig`), a `note`, `strict`: the verdict under the strict
profile of VAOS 2.0 section 7.3, and, when that is false, `reason`: the
verifier's reason. Both are what verifiable-receipts' own
`verifyEd25519Strict` (`third_party/verifiable-receipts/verify-v2.mjs`)
answers at `VR_REF`. Only `valid` passes the strict checks; the rest are
refused before any library sees them, which is where Node.js versions and
browser engines were seen to differ (`SECURITY.md`, Browsers).

`test/ed25519.test.ts` checks the original verifier, the port and the
page's path against `strict` and `reason`, and node:crypto and WebCrypto
against `strict` on the vectors the strict checks pass on;
`e2e/ed25519.spec.ts` checks every browser Playwright runs.
