# receipts-explorer

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/christiaan839-beep/receipts-explorer/badge)](https://scorecard.dev/viewer/?uri=github.com/christiaan839-beep/receipts-explorer)

A web page that checks a [verifiable receipt](https://github.com/christiaan839-beep/verifiable-receipts)
in your browser: that the issuer signed exactly this text, that the receipt
does not contradict itself, and, given a [receipts-log](https://github.com/christiaan839-beep/receipts-log)
address, that the receipt is in the log and that witnesses saw the same log.

**<https://christiaan839-beep.github.io/receipts-explorer/>**

Your receipt is not uploaded. Receipts and keys stay in the browser tab; if
you give a log address, the page sends that log only GET requests, carrying
the receipt's leaf hash, never its text.

## The seven checks

The page runs these on each receipt. What each proves and does not prove is
quoted from `content/checks.json`, the same sentences the site shows.

1. **Format**: a v2 receipt, its signature in the one valid spelling.
   - Proves: "The receipt is a v2 receipt, and its signature is written in the one valid spelling."
   - Does not prove: "Nothing about who signed it or whether its content is true."
2. **Signature**: valid under the issuer key you give, named by fingerprint.
   - Proves: "The holder of this key signed exactly this text, and nobody changed it afterwards."
   - Does not prove: "That the key belongs to the issuer you think it does: that depends on where you got the key."
3. **Content hash**: matches the signed text.
   - Proves: "The contentHash beside the signed text is the SHA-256 of that text."
   - Does not prove: "Anything the signature does not already prove; it lets other tools find the receipt by its hash."
4. **Repeated fields**: each equals the signed text.
   - Proves: "Every field beside the signed text says the same as the signed text."
   - Does not prove: "That the action happened as recorded; only that the receipt does not contradict itself."
5. **Tree head**: the log's latest tree head (`GET /v1/sth`), signed by the
   log key you give.
   - Proves: "The log's key signed this tree head: the log committed to this size and root."
   - Does not prove: "That the log shows everyone the same tree head; witnesses check that."
6. **In the log**: an inclusion proof for the receipt (`GET /v1/proof/inclusion`,
   with its leaf hash and the tree size), checked against the signed root,
   never against a root the log's answer brings with it.
   - Proves: "The receipt is an entry in the tree the signed tree head commits to, so the log cannot later deny holding it."
   - Does not prove: "When the action happened, or that the log holds no other receipts that contradict this one."
7. **Witnesses**: how many of the witness keys you give cosigned a tree head
   with that log, size and root, at any timestamp (`GET /v1/cosignatures`).
   It fails on a witness-signed fork: a cosignature over the same log and
   size with another root, signed by a witness key you gave. A fork
   cosignature whose text is not canonical, or whose signature does not
   verify under a key you gave, is skipped.
   - Proves: "Independent witnesses saw this log at this size with this same root, so the log would have to fool them too to show you a different one, and none of the cosignatures the log returned shows a witness you gave cosigning another root for this size."
   - Does not prove: "That the witnesses are independent of the log; that depends on who runs them."

Each is passed, failed or not run. A check that cannot run is never shown
as passed, and a network error is never shown as a verdict. The issuer's
key is required. Without a log address, or without the log's key, checks 5
to 7 are not run and no log is asked: the page never fetches the log's key
from the log, because a key fetched from the log proves nothing. Without
witness keys, Witnesses is not run. Per run, the log is asked for one tree
head and one list of cosignatures, and for one inclusion proof per receipt.

## How it is built

- **Pages**: Python 3 standard library only (`app/content.py`, `app/ontology.py`,
  `app/layout.py`, `app/pages.py`; `serve.py`; `build.py` writes `dist/`).
  Python 3.9 or later; CI uses 3.12. Every page reads in full without
  JavaScript.
- **Checks**: one TypeScript bundle, `static/check.js`, built with esbuild, with
  no runtime dependencies and WebCrypto's Ed25519. Its verifier is a browser
  port of verifiable-receipts' at a pinned commit (`third_party/verifiable-receipts/`).
  The only code that makes requests is `src/log-client.ts`.
- **Hosting**: GitHub Pages, deployed from `main` by `.github/workflows/deploy.yml`,
  which runs CI, builds `dist/`, checks the size budget and attests the
  build provenance of every file before it deploys. A Content Security
  Policy allows scripts and styles from the site only, no inline code, and
  connections over https only; in a browser that enforces Trusted Types it
  also refuses HTML built from strings. The stylesheet and the script carry
  Subresource Integrity hashes.
- **Search engines**: crawlers read `robots.txt` only at the host root, so
  the one `build.py` writes has no effect under this project path. Submit
  <https://christiaan839-beep.github.io/receipts-explorer/sitemap.xml> in
  Google Search Console and Bing Webmaster Tools instead.

## Run it

```bash
npm ci
npm run bundle            # build/check.js
python3 serve.py          # live render at http://127.0.0.1:8000/receipts-explorer/
python3 serve.py --dist   # or the built dist/, as GitHub Pages serves it
npm run check             # type check, lint, unit tests, build dist/, size budget
npx playwright install chromium firefox webkit
npm run e2e               # Playwright and axe against dist/ (build it first)
```

`serve.py` listens on 127.0.0.1 and answers only requests addressed to
127.0.0.1 or localhost, with its port.

## Licence

Apache-2.0. See `LICENSE`, and `third_party/verifiable-receipts/` for the
vendored code.
