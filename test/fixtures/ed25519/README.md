# Ed25519 edge vectors

Sixteen Ed25519 signatures on the edges of RFC 8032, in the style of
Wycheproof and "Taming the many EdDSAs" (Chalkias et al., 2020): a
non-canonical `S` (`S + L`, `S + 2L`, `S = L`), small-order and mixed-order
public keys, small-order and non-canonical `R`, non-canonical key encodings,
and points not on the curve. They were built with BigInt curve arithmetic by
the review of Plan 3, Task 3, on 24 October 2026, with fresh random keys.

Each entry has the key as base64 SPKI DER (`spki`), the message and signature
as hex (`msg`, `sig`), a `note`, and `node`: what Node's `crypto.verify`
answers. Node, the browser port (`src/bytes.ts` `ed25519Verify`) and
Chromium 153 agree on every one: the verification is cofactorless, `S < L`
is enforced, and small-order keys are accepted, which is why `src/keys.ts`
refuses them. `test/ed25519.test.ts` checks Node and the port against `node`;
`e2e/ed25519.spec.ts` checks every browser Playwright runs. Any difference
fails.
