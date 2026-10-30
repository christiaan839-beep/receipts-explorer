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

## Framing, and the origin the site shares

GitHub Pages cannot send response headers, and a Content Security Policy
in a meta tag ignores `frame-ancestors`, so the site cannot forbid other
sites to frame it. The page refuses to run inside a frame instead: when
`top !== self` it shows the `#framed` notice and checks nothing, so another
site cannot show the page's verdicts as its own.

The site is served from `christiaan839-beep.github.io`, an origin it shares
with every other GitHub Pages project site of that account. The browser
treats them as one origin: a script on one of those sites could, for
example, reach into this page in a window it opened, and a service
worker served from the origin's root (the account's user site,
`christiaan839-beep.github.io` itself) could answer this page's
requests. The page stores nothing, so no visitor data waits on that
origin. A custom domain would give the site an origin of its own.

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

Firefox 157 and WebKit 27.2 also differ from Node on two of the Ed25519
edge vectors (`test/fixtures/ed25519/`), both identity keys: the
non-canonical encoding y = p + 1, and the encoding with the sign bit set.
Node verifies both signatures; those browsers do not. The page refuses both
keys as small-order points when it reads them, before WebCrypto sees them,
so every browser gives the same verdict.

`e2e/ed25519.spec.ts` checks this in Chromium, Firefox and WebKit on
every pull request, with the edge vectors and RFC 8032 test 1 run
through the page. A receipt, tree head or cosignature to which the page
gives a different verdict in one supported browser than in another, or
than Node gives it, is in scope, even when the cause is a WebCrypto bug:
the page must refuse that input before WebCrypto sees it, as it does the
two cases above.

## Supported versions

Only the deployed site and `main` are supported. Every deploy is built
from `main` in CI with signed provenance for each file
(`.github/workflows/deploy.yml`).
