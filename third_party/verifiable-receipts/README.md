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

`SHA256SUMS` holds the SHA-256 at `VR_REF` of those two sources and of
`packages/verifiable-receipts/src/hash.ts`, whose `isHashHex` the
transparency port inlines. When `VR_REF` moves to a commit where any of the
three changed, the `vendor` job fails until the port is brought up to date
and `SHA256SUMS` rewritten.
