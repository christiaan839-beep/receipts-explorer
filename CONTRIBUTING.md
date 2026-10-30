# Contributing

Thank you for helping. receipts-explorer is a static page that checks
verifiable receipts in the browser.

## Reporting

- **A security flaw**: report it privately, as `SECURITY.md` says. Don't open a public issue.
- **A bug**: open an issue with the browser and its version, the receipt and keys
  that show it (test keys only), what you expected and what happened.

## Changing code

1. Fork, branch from `main`, and open a pull request. CI must pass and every
   review conversation must be resolved before it merges; `main` takes merge
   commits only.
2. `src/vendor/verifiable-receipts/` is a browser port of the verifiable-receipts
   verifier. Change the verifier there first; then move
   `third_party/verifiable-receipts/VR_REF` to the new commit, copy the files
   `third_party/verifiable-receipts/README.md` lists, bring the port up to date,
   and rewrite `SHA256SUMS`. The `vendor` job checks every copy against `VR_REF`.
3. The page sends nothing anywhere but the log address the visitor types, stores
   nothing, never parses input as HTML and loads no code at run time. ESLint
   enforces this in `src/`; keep it so.

## The checks CI runs

`.github/workflows/ci.yml` runs these on every push and pull request. Run
them locally with Node 22.18 or later and Python 3.9 or later (CI uses 3.12):

```bash
npm ci
npm run check                                   # tsc, eslint, node --test, build, budget
npm audit --audit-level=moderate
python3 -m unittest discover -s tests -t .      # the Python site (test_serve.py binds a local port)
python3 -m pip install --require-hashes --no-deps -r .github/tools/python-ci/requirements.txt   # in a venv
ruff check . && ruff format --check .           # ruff 0.17.0, installed by hash on the line above
npx playwright install chromium firefox webkit
npx playwright test                             # against dist/, which npm run check builds
bash scripts/check-vendor.sh <verifiable-receipts checkout at VR_REF>
```

CI runs the unit and property tests with `FC_NUM_RUNS=2000` (2,000 cases per
property), on Node 22 and 24. The `vendor` job also checks that `VR_REF` is on
verifiable-receipts' `main`. Separate workflows run CodeQL (`codeql.yml`) and
zizmor (`zizmor.yml`) on every pull request, and OpenSSF Scorecard
(`scorecard.yml`) on `main` and weekly. To audit the workflows locally:

```bash
uvx zizmor@1.30.1 --persona pedantic .github/
```

## Style

- Plain, declarative prose in docs, comments and messages; each fact once.
  Every message says what is wrong and what to do.
- Commit messages: a subject line under 72 characters, a blank line, then what
  changed and why.
- No runtime dependencies in the bundle, and none beyond the standard library in Python.

By contributing you agree that your contribution is licensed under the Apache
License 2.0 (`LICENSE`).
