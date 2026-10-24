#!/usr/bin/env bash
# Checks every file copied from verifiable-receipts against a checkout of it
# at the commit in third_party/verifiable-receipts/VR_REF, and fails closed:
# each vendored directory must hold exactly the files listed here, and
# SHA256SUMS must list exactly the three sources the browser ports are made
# from. CI runs it in the vendor job; run it locally, from the repository
# root, against an export of that commit.
#
# Usage: bash scripts/check-vendor.sh <verifiable-receipts checkout at VR_REF>
set -euo pipefail
export LC_ALL=C

fail() { echo "::error file=$1::$2" >&2; exit 1; }
# The files directly in a directory, one per line, sorted; dotfiles included.
listing() { (cd "$1" && find . -mindepth 1 -maxdepth 1 -print | sed 's|^\./||' | sort); }
# Fails unless directory $1 holds exactly the names on stdin.
exactly() {
  local want got
  [[ -d "$1" ]] || fail "$1" "is missing"
  want=$(sort)
  got=$(listing "$1")
  [[ -n "$want" ]] || fail "$1" "the expected listing is empty"
  [[ "$got" == "$want" ]] || fail "$1" "holds $(echo "$got" | tr '\n' ' ')but must hold exactly $(echo "$want" | tr '\n' ' ')"
}

upstream="${1:?usage: check-vendor.sh <verifiable-receipts checkout at VR_REF>}"
tp=third_party/verifiable-receipts
up="$upstream/packages/verifiable-receipts"

# Preflight: run from this repository's root, against a verifiable-receipts tree.
[[ -f package.json && -f "$tp/VR_REF" ]] && grep -q '"name": "receipts-explorer"' package.json ||
  fail scripts/check-vendor.sh "run it from the receipts-explorer repository root"
[[ -d "$up/conformance/fixtures" ]] || fail scripts/check-vendor.sh "$upstream is not a verifiable-receipts tree"

ref=$(cat "$tp/VR_REF")
[[ "$ref" =~ ^[0-9a-f]{40}$ ]] || fail "$tp/VR_REF" "must be one full commit SHA"
if [[ -e "$upstream/.git" ]]; then
  head=$(git -C "$upstream" rev-parse HEAD)
  [[ "$head" == "$ref" ]] || fail "$tp/VR_REF" "the upstream checkout is at $head, not $ref"
fi

# SHA256SUMS: exactly the three ported sources (transparency.ts inlines
# isHashHex from hash.ts), each with a matching hash.
# sha256sum skips lines it cannot read and passes an empty file, so the
# listed paths are checked first.
[[ -f "$tp/SHA256SUMS" ]] || fail "$tp/SHA256SUMS" "is missing"
sums_paths=$(sed -E 's/^[0-9a-f]{64}  //' "$tp/SHA256SUMS" | sort)
[[ "$sums_paths" == "$(printf '%s\n' packages/verifiable-receipts/conformance/verify-v2.mjs packages/verifiable-receipts/src/hash.ts packages/verifiable-receipts/src/transparency.ts | sort)" ]] ||
  fail "$tp/SHA256SUMS" "must list exactly conformance/verify-v2.mjs, src/hash.ts and src/transparency.ts, one '<sha256>  <path>' line each"
(cd "$upstream" && sha256sum --strict -c --quiet "$OLDPWD/$tp/SHA256SUMS") ||
  fail "$tp/SHA256SUMS" "a ported source changed; update the port"

# Exactly these files, each identical to VR_REF.
printf '%s\n' LICENSE README.md SHA256SUMS VR_REF ontology.md verify-v2.d.mts verify-v2.mjs | exactly "$tp"
cmp "$up/conformance/verify-v2.mjs" "$tp/verify-v2.mjs" || fail "$tp/verify-v2.mjs" "differs from VR_REF"
cmp "$up/conformance/verify-v2.d.mts" "$tp/verify-v2.d.mts" || fail "$tp/verify-v2.d.mts" "differs from VR_REF"
cmp "$up/LICENSE" "$tp/LICENSE" || fail "$tp/LICENSE" "differs from VR_REF"
cmp "$upstream/docs/ontology.md" "$tp/ontology.md" || fail "$tp/ontology.md" "differs from VR_REF"

{ listing "$up/conformance/fixtures"; printf '%s\n' README.md public-key.pem; } | exactly test/fixtures/conformance
for f in "$up"/conformance/fixtures/*.json; do
  cmp "$f" "test/fixtures/conformance/$(basename "$f")" || fail "test/fixtures/conformance/$(basename "$f")" "differs from VR_REF"
done
cmp "$up/conformance/public-key.pem" test/fixtures/conformance/public-key.pem || fail test/fixtures/conformance/public-key.pem "differs from VR_REF"

printf '%s\n' README.md cosignature.json tree-head.json | exactly test/fixtures/schemas
for f in tree-head.json cosignature.json; do
  cmp "$upstream/schemas/examples/$f" "test/fixtures/schemas/$f" || fail "test/fixtures/schemas/$f" "differs from VR_REF"
done

echo "every vendored file matches verifiable-receipts at $ref"
