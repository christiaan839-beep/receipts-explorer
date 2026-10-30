# verifiable-receipts

Source: https://github.com/christiaan839-beep/verifiable-receipts, at the
commit in `VR_REF` beside this file.

Licence: Apache License 2.0, in `LICENSE` beside this file (copied from
`packages/verifiable-receipts/LICENSE`).

Copied unchanged, and checked byte for byte against `VR_REF` in CI
(`.github/workflows/ci.yml`, job `vendor`, which runs `scripts/check-vendor.sh`;
each directory must hold exactly these files and no others):

- `ontology.md`, from `docs/ontology.md`: the term pages are generated from it.
- `verify-v2.d.mts`, from `packages/verifiable-receipts/conformance/verify-v2.d.mts`:
  the types of the original verifier, so the tests import it without a type error.
- `verify-v2.mjs`, from `packages/verifiable-receipts/conformance/verify-v2.mjs`:
  the original receipt verifier, which `test/port.properties.test.ts` runs beside
  the browser port to check that both give the same verdict and reason.
- `test/fixtures/conformance/`, from `packages/verifiable-receipts/conformance/fixtures/`
  and `public-key.pem`.
- `test/fixtures/schemas/`, from `schemas/examples/tree-head.json` and `cosignature.json`.

Ported to the browser (WebCrypto, no Node APIs), each stating its changes in
its header:

- `src/vendor/verifiable-receipts/receipt.ts`, from `packages/verifiable-receipts/conformance/verify-v2.mjs`.
- `src/vendor/verifiable-receipts/transparency.ts`, from `packages/verifiable-receipts/src/transparency.ts`.
- `src/vendor/verifiable-receipts/edwards25519.ts`, from `packages/verifiable-receipts/src/edwards25519.ts`:
  the point arithmetic of the strict Ed25519 profile (VAOS 2.0 section 7.3).
- `src/vendor/verifiable-receipts/ed25519-key.ts`, from `packages/verifiable-receipts/src/ed25519-key.ts`:
  `ed25519PublicKeyProblem` and `ed25519SignatureProblem`, which the receipt
  port, the key reader (`src/keys.ts`), check 2 (`src/checks.ts`) and
  `ed25519Verify` (`src/bytes.ts`) run before WebCrypto sees a key or a
  signature.

`SHA256SUMS` holds the SHA-256 at `VR_REF` of those four sources, of
`packages/verifiable-receipts/conformance/verify-v2.mjs`, and of
`packages/verifiable-receipts/src/hash.ts`, whose `isHashHex` the
transparency port inlines. When `VR_REF` moves to a commit where any of the
five changed, the `vendor` job fails until the ports are brought up to date
and `SHA256SUMS` rewritten.
