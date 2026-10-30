# Security

## Reporting a vulnerability

Report a suspected flaw privately, through a GitHub security advisory:
<https://github.com/christiaan839-beep/receipts-explorer/security/advisories/new>
(the repository's **Security** tab, then **Report a vulnerability**).
Don't open a public issue for it.

If you cannot use GitHub, email `sovereign.systems007@gmail.com` with
`[security]` at the start of the subject.

Please include the browser and its version, what you expected and what
happened, and the receipt, keys and log answers that show it, using test
keys only, never a key in real use.

You should get a first reply within seven days. A fix is developed in the
private advisory, and the advisory is published with the deploy that fixes
it, crediting you unless you ask otherwise.

## Scope

In scope: anything that makes the page show a check as passed when it
should fail or did not run; give a different verdict in one supported
browser than in another; trust a log's own `rootHashHex`; send a visitor's
receipt, keys or anything else to a host other than the log address they
typed, or with a method other than GET; store or put in the address bar
anything a visitor gives; run script the build did not ship; or hang on
input a visitor or a log can supply.

Out of scope: a compromised issuer, log or witness key; a visitor given
the wrong key out of band; and a bug in a browser's WebCrypto that the
page never reaches, because the page refuses that input first or because
the browser fails the page's own Ed25519 check and runs nothing (report
those to the browser's maker).

## Framing, and the site's own origin

GitHub Pages cannot send response headers, and a Content Security Policy
in a meta tag ignores `frame-ancestors`, so the site cannot forbid other
sites to frame it. The page refuses to run inside a frame instead: when
`top !== self` it shows the `#framed` notice and checks nothing, so another
site cannot show the page's verdicts as its own.

The site is served from `https://verify.sovereignmatrix.co.za`, an origin
of its own: no other site, and no other GitHub Pages site of the account,
shares it, so none can reach into this page in a window it opened or
register a service worker that answers its requests. The Content Security
Policy's `'self'` means this origin only. The page stores nothing, so no
visitor data waits on it either.

## Browsers

The supported browsers are current releases of Chrome, Edge, Firefox and
Safari, which run on the Chromium, Firefox and WebKit engines. CI tests
those engines at the versions Playwright 1.64.0 ships: Chromium 156,
Firefox 157 and WebKit 27.2 (Playwright's WebKit build, not Safari
itself).

Before it checks anything, the page tests the browser's WebCrypto Ed25519
(`src/ed25519-support.ts`): RFC 8032 section 7.1 test 2, a one-byte message,
must verify, and a copy of its signature with one bit flipped must not,
with the key imported both raw and as SPKI. A browser that fails is told
so, and the page runs no checks. The test does not use RFC 8032 test 1, the
empty message: WebKit 27.2 answers false to it where Node answers true. The
page never asks WebCrypto about an empty message: a receipt whose canonical
text is empty fails Format before any signature is checked, and tree heads
and cosignatures are verified over their JSON text, which is never empty.

The engines' Ed25519 differs on keys and signatures at the edges of
RFC 8032, so the page does not leave those to WebCrypto. It applies the
strict profile of VAOS 2.0 section 7.3, the same code as verifiable-receipts
at `VR_REF` (`src/vendor/verifiable-receipts/ed25519-key.ts` and
`edwards25519.ts`), before WebCrypto sees a key or a signature: a key, and
a signature's R, must each be the canonical encoding of a point of order L
(not a non-canonical encoding, not off the curve, not of small order, the
identity included, and not of mixed order), and S must be below L. The key
reader refuses such a key with the verifier's reason ("public key is a
small-order point", "... is not a canonical encoding", "... is not a point
on the curve", "... is not in the prime-order subgroup"); check 2 fails
such a signature with its reason ("signature R is ..."), or, for an S of L
or more, as a signature that does not verify. On what passes these checks
every correct Ed25519 verifier, cofactored or cofactorless, gives the same
answer. What the engines were seen to do without them:

- Node.js 24.22.1 (OpenSSL 3.5.9) refuses R = identity, and the small-order
  keys, which Node.js 22.23.2 (OpenSSL 3.5.7) accepts.
- WebKit 27.2 on Linux (Playwright's build on ubuntu-latest) verified
  signatures with S + L and S + 2L, with R = identity, and under an
  order-8 key where the cofactorless check fails; it refused a mixed-order
  key under which the cofactorless check holds; and its web process
  crashed, closing the page, when asked to verify under the identity key
  (01 00 ... 00, with R = identity and S = 0) or under a key off the curve
  (y = 2). The page never gives WebCrypto those keys: the key reader
  refuses them, as a small-order point and as not a point on the curve,
  before it imports them.
- WebKit 27.2 on macOS, and Firefox 157, refuse the identity key with
  y = p + 1 and with the sign bit set, which Node.js 22 accepts.
- WebKit 27.2 answers false to RFC 8032 test 1, the empty message.

`e2e/ed25519.spec.ts` checks this in Chromium, Firefox and WebKit on
every pull request: the 16 edge vectors, the 17 receipts of the corpus's
strict vectors and RFC 8032 test 1 are run through the page, which must
give each the same refusal, verdict and words in every browser; and the
browser's own WebCrypto must give the strict verdict on every case the page
passes on to it. A receipt, tree head or cosignature to which the page
gives a different verdict in one supported browser than in another, or
than verifiable-receipts gives it, is in scope, even when the cause is a
WebCrypto bug: the page must refuse that input before WebCrypto sees it.

## Supported versions

Only the deployed site and `main` are supported. Every deploy is built
from `main` in CI with signed provenance for each file
(`.github/workflows/deploy.yml`).
