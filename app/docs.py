"""The docs: an overview of the receipts stack, the quickstart and the key page.

Every claim about the format names the section of VAOS 2.0 or of the
transparency-log spec it comes from, at the commit in VR_REF. The
quickstart's receipt and key are the conformance corpus's own
(test/fixtures/conformance/), and tests/test_docs.py checks that they are
and that each fingerprint shown is its key's. The pages load no script.
"""

from __future__ import annotations

import json

from .content import LOG_SPEC, REPOS, ROOT, SITE, VAOS, VR_REF
from .layout import esc, url

FIXTURES = ROOT / "test" / "fixtures"
TEST_RECEIPT = json.dumps(json.loads((FIXTURES / "conformance" / "v2-valid-001.json").read_text(encoding="utf-8"))["receipt"], indent=2)
TEST_ISSUER_KEY = (FIXTURES / "conformance" / "public-key.pem").read_text(encoding="utf-8").strip()
TEST_LOG_KEY = (FIXTURES / "log" / "log-public-key.pem").read_text(encoding="utf-8").strip()
# "sha256:" and the first 16 hex characters of the SHA-256 of the key's SPKI DER,
# as this site and verify-receipts-action show it.
TEST_ISSUER_FINGERPRINT = "sha256:aed57754623c5598"
TEST_LOG_FINGERPRINT = "sha256:a5aa2522ffabd27b"

# The commits the quickstart's samples were run against, on 31 October 2026.
SAMPLES_RUN = {"verifiable-receipts": "7a741a4898141f6729f8ff74d21ef92f273d4e18", "verify-receipts-action": "068148a"}
ACTION_V010 = "e0061c5da823f0889d1720ab68fa4f1e7c721cee"
GO_MODULE = "github.com/christiaan839-beep/verifiable-receipts/packages/verifiable-receipts-go"


def sec(number: str, anchor: str, spec: str = VAOS) -> str:
    """A link to one section of a spec, such as §7.3 of VAOS 2.0."""
    return f'<a href="{spec}#{anchor}">§{number}</a>'


def log_sec(number: str, anchor: str) -> str:
    return sec(number, anchor, LOG_SPEC)


def repo(name: str) -> str:
    return f'<a href="{REPOS[name]}">{esc(name)}</a>'


def code(text: str, label: str) -> str:
    """A block of code or text to copy, named for screen readers."""
    return f'<pre class="code" aria-label="{esc(label)}"><code>{esc(text)}</code></pre>'


def contents(items: list[tuple[str, str]]) -> str:
    links = "".join(f'<li><a href="#{id_}">{esc(text)}</a></li>' for id_, text in items)
    return f'<nav class="toc" aria-label="On this page"><ul>{links}</ul></nav>'


def section(id_: str, title: str, body: str) -> str:
    return f'<section aria-labelledby="{id_}">\n<h2 id="{id_}">{esc(title)}</h2>\n{body}\n</section>\n'


def sections(parts: list[tuple[str, str, str]]) -> str:
    return contents([(id_, title) for id_, title, _ in parts]) + "\n" + "".join(section(*p) for p in parts)


def article(headline: str, description: str) -> dict:
    return {"@type": "TechArticle", "headline": headline, "description": description, "inLanguage": SITE["locale"]}


SHORT_RECEIPT = (
    '{"verdictId": "v_1", "overall": "pass",\n'
    ' "canonical": "{\\"overall\\":\\"pass\\",\\"verdictId\\":\\"v_1\\"}",\n'
    ' "contentHash": "sha256:…", "signature": "v2=…"}'
)


def page_docs() -> tuple[dict, str]:
    description = (
        "What a VAOS 2.0 receipt is, what the transparency log and witnesses add, and what a valid receipt "
        "proves and does not prove, with the spec section for each."
    )
    meta = {
        "path": "/docs/",
        "title": "Docs: what a verifiable receipt proves",
        "description": description,
        "active": "docs",
        "schema": article("What a verifiable receipt proves, and what it does not", description),
    }
    parts = [
        (
            "receipt",
            "What a receipt is",
            f"""<p>A receipt is a JSON object that an issuer signs with its Ed25519 key, so that anyone with the issuer's public
key can check it without the issuer's help or its secret ({sec("1", "1-abstract")}, {sec("2", "2-motivation")}).</p>
<ul>
<li><code>canonical</code> holds the exact text that was signed: its UTF-8 bytes, as the receipt carries them, are the
signed message ({sec("5", "5-canonical-projection")}, {sec("6.1", "61-generation")}).</li>
<li><code>signature</code> is <code>v2=</code> and the standard base64 of the 64-byte Ed25519 signature
({sec("3", "3-terminology")}, {sec("6.2", "62-wire-format")}).</li>
<li><code>contentHash</code>, which the issuer should set, is <code>sha256:</code> and the hex SHA-256 of
<code>canonical</code> ({sec("6.1", "61-generation")}, step 6).</li>
<li>Every other field must appear in <code>canonical</code> with the same value. They are a convenience copy: read values
from <code>canonical</code> ({sec("6.1", "61-generation")}; {sec("7", "7-verification-procedure")}, step 6).</li>
</ul>
{code(SHORT_RECEIPT, "A receipt, shortened")}
<p>Neither the receipt nor <code>canonical</code> may nest deeper than 64 levels ({sec("7.2", "72-nesting-depth")}).</p>""",
        ),
        (
            "verify",
            "How a verifier checks one",
            f"""<p>{sec("7", "7-verification-procedure")} sets the order. A verifier:</p>
<ol>
<li>refuses a receipt nested deeper than 64 before it reads any field ({sec("7.2", "72-nesting-depth")});</li>
<li>reads the <code>v2=</code> prefix, and refuses a signature not written in the one valid spelling of base64 (steps 1 and 2);</li>
<li>checks <code>contentHash</code>, when there is one, against the SHA-256 of <code>canonical</code> (step 3);</li>
<li>checks the Ed25519 signature over the bytes of <code>canonical</code> under the issuer's key, by the strict profile
below (step 4);</li>
<li>parses <code>canonical</code> as a JSON object nested at most 64 deep (step 5);</li>
<li>checks that every other field of the receipt equals the same field of <code>canonical</code> (step 6).</li>
</ol>
<p>It does nothing with a receipt (no database write, no network call, no log line holding its body) before the signature
check passes, and it answers every input with a verdict, never a crash ({sec("7", "7-verification-procedure")}).
The <a href="{url("/")}">check page</a> runs these steps in your browser, and <a href="{url("/docs/quickstart/")}">the
quickstart</a> runs them with each library.</p>""",
        ),
        (
            "strict-ed25519",
            "The strict Ed25519 profile, in plain words",
            f"""<p>Ed25519's standard, RFC 8032, leaves verifiers some room in how they check a signature, and two verifiers that use
the room differently accept different signatures: one receipt is then valid in one program and invalid in another.
{sec("7.3", "73-ed25519-verification")} closes the room. Before any Ed25519 library sees a signature, a verifier refuses
it unless:</p>
<ul>
<li><strong>S has one value.</strong> The second half of the signature, S, must be less than the group order L. S + L
satisfies the same equation, so without this rule one signature would have two valid spellings.</li>
<li><strong>The key is an ordinary key.</strong> The public key must be the one correct encoding of a point in the curve's
large prime-order group. That refuses the few points of "small order", under which some signatures verify every message
(under the key <code>01 00 … 00</code>, R = <code>01 00 … 00</code> with S = 0 does), and points of "mixed order", under
which verifiers disagree.</li>
<li><strong>R is an ordinary point.</strong> The first half of the signature, R, must pass the same test, so R cannot be
the identity point, or of small or mixed order.</li>
</ul>
<p>Then the platform's library makes its usual check. On what passes these rules, every correct Ed25519 verifier gives
the same answer, and an honest signer, whose key is made as RFC 8032 says, never makes a signature they refuse
({sec("7.3", "73-ed25519-verification")}). The rules answer a real disagreement: on 30 October 2026 newer Node.js lines
refused a signature with R = identity that Node.js 22 accepted, and WebKit on Linux refused one under a mixed-order key
that other verifiers accepted. Under the strict profile both are refused everywhere. An issuer must not publish such a
key, and a verifier must refuse every receipt checked with one (the weak-keys rule of
{sec("7.3", "73-ed25519-verification")}).</p>""",
        ),
        (
            "log",
            "What the transparency log adds",
            f"""<p>A signature shows that the issuer signed a receipt. It does not show that the issuer published it, or that it
shows every party the same history: a receipt signed and then withheld is still valid ({log_sec("1", "1-problem")}).
A transparency log, such as {repo("receipts-log")}, addresses that.</p>
<ul>
<li>The log admits a receipt only after it verifies under one of the issuer keys the log is configured with
({log_sec("4", "4-append-protocol")}, step 2), and stores it as a leaf: the SHA-256 of a zero byte and
<code>canonical</code> ({log_sec("3.1", "31-leaf-hash")}).</li>
<li>From time to time the log signs a tree head, its size and the Merkle root over every leaf so far, with a key of its
own ({log_sec("3.3", "33-signed-tree-head-sth")}).</li>
<li>An inclusion proof links one receipt to the root in a signed tree head ({log_sec("3.4", "34-inclusion-proof")}), so
the log cannot later deny holding it. A consistency proof shows that a later tree only appended to an earlier one
({log_sec("3.5", "35-consistency-proof")}). A log never removes a leaf ({log_sec("4", "4-append-protocol")}).</li>
</ul>
<p>Anyone can read what a log holds, so a receipt's <code>canonical</code> must hold no personal information that may not
be published ({log_sec("4", "4-append-protocol")}; {log_sec("6", "6-threat-model")}).</p>""",
        ),
        (
            "witnesses",
            "What witnesses add",
            f"""<p>A witness is a party other than the log. It fetches the log's tree head, checks a consistency proof from the last
tree head it cosigned, and cosigns the new one only if it extends that one; if not, it refuses to sign and stops
({log_sec("5", "5-witness-protocol")}). A log that forks its history then goes without the witnesses' cosignatures, or
fails their check.</p>
<p>The limits are those of {log_sec("6", "6-threat-model")}: a fork is caught only when someone compares tree heads, and
these projects have no gossip between witnesses; witnesses that collude can cosign a fork; and a witness is only as
independent as whoever runs it.</p>""",
        ),
        (
            "proves",
            "What a valid receipt proves, and what it does not",
            f"""<p>It proves that whoever held the issuer's secret key signed exactly the text in <code>canonical</code>, and that the
receipt's other fields say nothing <code>canonical</code> does not. With a log and witnesses it also shows that the log
holds the receipt, in a history the witnesses saw.</p>
<p>It does not prove:</p>
<ul>
<li><strong>That the content is true.</strong> The issuer signs what it is given: a receipt records what the issuer
claimed, not what the agent or the model did.</li>
<li><strong>That the key is the issuer's.</strong> The key must come from the issuer by a route you trust, never from the
receipt ({sec("7.3", "73-ed25519-verification")}; {sec("6.3", "63-key-publication")}). See <a href="{url("/keys/")}">keys</a>.</li>
<li><strong>When it was signed.</strong> <code>issuedAt</code> is a signed claim. After a key is compromised, a receipt
under it is only as trustworthy as independent evidence of when it was made, such as a witnessed log entry from before
({sec("8", "8-visibility")}).</li>
<li><strong>That nothing was left out.</strong> An issuer can decline to sign or to log a receipt. Requiring a logged
receipt for every decision is a matter for contracts, not for the format ({log_sec("6", "6-threat-model")}).</li>
</ul>
<p>So a receipt is <strong>evidence for an audit</strong>: an auditor, a customer or a counterparty can check it for
themselves. Whether it meets a law, a standard or a contract is for whoever sets that requirement to judge. A receipt does
not make anyone compliant, and nothing here is guaranteed.</p>""",
        ),
        (
            "projects",
            "The projects",
            f"""<ul>
<li>{repo("verifiable-receipts")}: the specifications, and the TypeScript, Python and Go libraries that sign and verify receipts.</li>
<li>{repo("receipts-log")}: a transparency-log server and witness, in Go.</li>
<li>{repo("verify-receipts-action")}: a GitHub Action that fails a build on a forged or altered receipt.</li>
<li>{repo("sovereign-agents")}: an agent kit that signs a receipt for every action, with the business's own key.</li>
<li>{repo("receipts-explorer")}: this site.</li>
</ul>
<p>All are 0.x software by one author, not independently reviewed. The sections cited are those of
<a href="{VAOS}">VAOS 2.0</a> and <a href="{LOG_SPEC}">the transparency-log spec</a> at commit
<code>{VR_REF[:12]}</code> of verifiable-receipts.</p>""",
        ),
    ]
    body = f"""<h1>Docs</h1>
<p class="lede">How verifiable receipts work: what a receipt is, what the transparency log and its witnesses add, and what a
valid receipt does and does not prove. A receipt is evidence for an audit, not automatic compliance.</p>
{sections(parts)}<p><a href="{url("/docs/quickstart/")}">Verify a receipt in five minutes</a>, or read how issuer keys are
<a href="{url("/keys/")}">published and checked</a>.</p>"""
    return meta, body


PY_SAMPLE = """from sovereign_matrix.verifiable_receipts import parse_receipt, verify_v2_receipt

receipt = parse_receipt(open("receipt.json", encoding="utf-8").read())
result = verify_v2_receipt(receipt, open("ed25519.pem", "rb").read())
print(result.ok, result.reason)"""

GO_SAMPLE = f"""package main

import (
	"fmt"
	"os"

	vaos "{GO_MODULE}"
)

func main() {{
	pemBytes, err := os.ReadFile("ed25519.pem")
	if err != nil {{
		panic(err)
	}}
	pub, err := vaos.LoadEd25519PublicKeyFromPEM(pemBytes)
	if err != nil {{
		panic(err)
	}}
	data, err := os.ReadFile(os.Args[1])
	if err != nil {{
		panic(err)
	}}
	receipt, err := vaos.ParseReceipt(data)
	if err != nil {{
		panic(err)
	}}
	result := vaos.VerifyV2Receipt(receipt, pub)
	fmt.Println(result.OK, result.Reason)
}}"""

TS_SAMPLE = """import { readFileSync } from "node:fs";
import { loadEd25519PublicKey, verifyEd25519 } from "@sovereignos/verifiable-receipts";

const receipt = JSON.parse(readFileSync("receipt.json", "utf8"));
const key = loadEd25519PublicKey(readFileSync("ed25519.pem"));
const signature = Buffer.from(receipt.signature.slice("v2=".length), "base64");
console.log(verifyEd25519(key, Buffer.from(receipt.canonical, "utf8"), signature));"""

ACTION_SAMPLE = """permissions:
  contents: read

jobs:
  receipts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - name: Verify receipts
        uses: christiaan839-beep/verify-receipts-action@FULL_COMMIT_SHA # the release you reviewed
        with:
          receipts: |
            receipts/**/*.json
          public-keys-file: .github/receipt-keys/issuer.pem"""

PY_INSTALL = """git clone https://github.com/christiaan839-beep/verifiable-receipts
pip install ./verifiable-receipts/packages/verifiable-receipts-py"""

GO_INSTALL = f"""go mod init example.com/verify
go mod edit -replace={GO_MODULE}=/path/to/verifiable-receipts/packages/verifiable-receipts-go
go mod tidy"""

TS_INSTALL = """git clone https://github.com/christiaan839-beep/verifiable-receipts
(cd verifiable-receipts/packages/verifiable-receipts && npm ci)
npm install --install-links /path/to/verifiable-receipts/packages/verifiable-receipts"""


def unpublished(command: str, release: str) -> str:
    return f"""<p class="unpublished"><strong>Available from release {esc(release)}, which is not published yet.</strong>
Once it is: <code>{esc(command)}</code>. Until then, install from the repository:</p>"""


def page_quickstart() -> tuple[dict, str]:
    description = (
        "Check a receipt in five minutes: on this site, with the Python, Go or TypeScript library, "
        "or in CI with the GitHub Action, using a test receipt and test key."
    )
    steps = ["Save the test receipt and its key", "Check it on this site", "Check it with a library", "Check it in CI"]
    meta = {
        "path": "/docs/quickstart/",
        "title": "Quickstart: verify a receipt in five minutes",
        "description": description,
        "active": "docs",
        "schema": {
            "@type": "HowTo",
            "name": "Verify a verifiable receipt",
            "description": description,
            "inLanguage": SITE["locale"],
            "totalTime": "PT5M",
            "step": [{"@type": "HowToStep", "position": i, "name": name} for i, name in enumerate(steps, 1)],
        },
    }
    parts = [
        (
            "files",
            "1. Save the test receipt and its key",
            f"""<p>Save this as <code>receipt.json</code>. It is <code>v2-valid-001.json</code> of the verifiable-receipts
conformance corpus, a receipt made for tests.</p>
{code(TEST_RECEIPT, "receipt.json, the test receipt")}
<p>Save this as <code>ed25519.pem</code>. <strong>It is a test key</strong>: the corpus was signed with it and its private
half was discarded. Its fingerprint is <code>{TEST_ISSUER_FINGERPRINT}</code>. Never trust a receipt because it verifies
under this key.</p>
{code(TEST_ISSUER_KEY, "ed25519.pem, the test key")}""",
        ),
        (
            "site",
            "2. Check it on this site",
            f"""<ol>
<li>Open <a href="{url("/")}">Check a receipt</a>.</li>
<li>Paste <code>receipt.json</code> into <strong>Receipt</strong> and <code>ed25519.pem</code> into <strong>Issuer's public
key</strong>, or choose the files.</li>
<li>Press <strong>Check</strong>. The page says "Checked 1 receipt: 1 valid.": Format, Signature (under
<code>{TEST_ISSUER_FINGERPRINT}</code>), Content hash and Repeated fields pass, and the log checks are not run, because no
log was given.</li>
<li>Change one letter inside <code>canonical</code> and check again: Signature fails.</li>
</ol>
<p>Nothing is uploaded: the checks run in the tab (see <a href="{url("/privacy/")}">privacy</a>).</p>""",
        ),
        (
            "python",
            "3. With Python",
            f"""<p>Python 3.10 or later, package <code>sovereign-matrix-verifiable-receipts</code>.</p>
{unpublished("pip install sovereign-matrix-verifiable-receipts", "0.3.0 on PyPI")}
{code(PY_INSTALL, "Install the Python package from the repository")}
<p>Save as <code>verify.py</code> beside the two files and run <code>python verify.py</code>:</p>
{code(PY_SAMPLE, "verify.py")}
<p>It prints <code>True None</code>; for a receipt that fails, <code>False</code> and the reason.</p>""",
        ),
        (
            "go",
            "4. With Go",
            f"""<p>Go 1.22 or later; the module uses the standard library only.</p>
{unpublished(f"go get {GO_MODULE}@v0.2.0", "v0.2.0 of the Go module")}
{code(GO_INSTALL, "Use a clone of the repository from your module")}
<p>Save as <code>main.go</code> and run <code>go run . receipt.json</code>; it prints <code>true</code>.</p>
{code(GO_SAMPLE, "main.go")}""",
        ),
        (
            "typescript",
            "5. With TypeScript or JavaScript",
            f"""<p>Node.js 22.12 or later, package <code>@sovereignos/verifiable-receipts</code>.</p>
{unpublished("npm install @sovereignos/verifiable-receipts", "0.5.1 on npm")}
{code(TS_INSTALL, "Install the TypeScript package from the repository")}
<p>Save as <code>verify.mjs</code> and run <code>node verify.mjs</code>; it prints <code>{{ ok: true }}</code>.</p>
{code(TS_SAMPLE, "verify.mjs")}
<p>This checks the signature over <code>canonical</code> under the strict profile of
{sec("7.3", "73-ed25519-verification")}. The package exports no whole-receipt v2 verifier, so this does not check
<code>contentHash</code> or the fields beside <code>canonical</code>; the Python and Go libraries, the action and this site
do.</p>""",
        ),
        (
            "action",
            "6. In CI, with the GitHub Action",
            f"""<p>{repo("verify-receipts-action")} fails the build when a receipt in the checkout does not verify under a key pinned in
the repository. It makes no network request.</p>
{code(ACTION_SAMPLE, "A workflow that verifies receipts")}
<p>Put the receipts under <code>receipts/</code> and the key in <code>.github/receipt-keys/issuer.pem</code>. Pin a full
commit SHA, as for any third-party action: release v0.1.0 is <code>{ACTION_V010}</code>. The strict Ed25519 profile is on
the action's main branch, listed as unreleased in its CHANGELOG. The job summary lists the receipt as verified, with the
key <code>{TEST_ISSUER_FINGERPRINT}</code>.</p>""",
        ),
    ]
    body = f"""<nav class="breadcrumb" aria-label="Breadcrumb"><a href="{url("/docs/")}">Docs</a></nav>
<h1>Verify a receipt in five minutes</h1>
<p class="lede">Check one test receipt on this site, with each library and in CI. None of the libraries is on a package
registry yet: the commands below install from the repository, and each registry command is marked with the release it
will work from.</p>
{sections(parts)}<p class="source">Each sample was run on 31 October 2026 on the files above, against verifiable-receipts
<code>{SAMPLES_RUN["verifiable-receipts"][:12]}</code> and verify-receipts-action
<code>{SAMPLES_RUN["verify-receipts-action"]}</code>.</p>"""
    return meta, body


def key_block(id_: str, title: str, pem: str, fingerprint: str, note: str) -> str:
    return f"""<div class="key key--test" role="group" aria-labelledby="{id_}">
<p class="key-label"><strong>Test key. Never trust a receipt because it verifies under it.</strong></p>
<h3 id="{id_}">{esc(title)}</h3>
<p>Fingerprint: <code>{fingerprint}</code>. {note}</p>
{code(pem, title)}
</div>"""


ISSUER_NOTE = "It signed the conformance corpus of verifiable-receipts, and its private half was discarded. The quickstart uses it."
LOG_NOTE = (
    "This site's tests sign a stub log's tree heads with it. Its private half is derived from a public label, so anyone can sign with it."
)
FINGERPRINT_COMMAND = "grep -v -- ----- ed25519.pem | base64 -d | shasum -a 256 | cut -c1-16"


def page_keys() -> tuple[dict, str]:
    description = (
        "How issuer keys are published, checked and fingerprinted, and Sovereign Matrix's policy for "
        "rotating and revoking them. No production key is published yet."
    )
    meta = {
        "path": "/keys/",
        "title": "Keys: publication, fingerprints, rotation and revocation",
        "description": description,
        "active": "keys",
        "schema": article("Issuer keys: publication, fingerprints, rotation and revocation", description),
    }
    parts = [
        (
            "publish",
            "How an issuer publishes its key",
            f"""<p>An issuer must publish its Ed25519 public key at a stable URL, in PEM (RFC 7468), served as
<code>application/x-pem-file</code> with <code>Access-Control-Allow-Origin: *</code> ({sec("6.3", "63-key-publication")}).
The recommended place is:</p>
{code("https://<issuer-domain>/.well-known/sovereign-receipts/ed25519.pem", "The recommended key URL")}
<p>It should be cached for at most 300 seconds, so that an emergency rotation spreads within one deploy
({sec("6.3", "63-key-publication")}). Anyone may cache, mirror or pin the public key; the secret key must never leave the
issuer's signing infrastructure ({sec("8", "8-visibility")}).</p>""",
        ),
        (
            "check",
            "How to check a key before you trust it",
            f"""<ul>
<li>Take the key from the issuer by a route you trust, never from the receipt ({sec("7.3", "73-ed25519-verification")}).
This site and the action never fetch an issuer key: you give it.</li>
<li>Compare its fingerprint with one you got another way: from the issuer in person, in a contract or in a reviewed file.</li>
<li>A verifier refuses a key that is not the correct encoding of an ordinary point: a point of small order, a non-canonical
encoding, a point off the curve or a point of mixed order, each with its own reason
({sec("7.3", "73-ed25519-verification")}).</li>
<li>A log signs its tree heads with a key of its own, separate from the issuer's ({log_sec("6", "6-threat-model")}), and
each witness has its own. Get those from their operators too: the check page never takes a log's key from the log.</li>
</ul>""",
        ),
        (
            "fingerprints",
            "Fingerprints",
            f"""<p>This site and verify-receipts-action name a key by <code>sha256:</code> and the first 16 hex characters of the
SHA-256 of its SPKI DER encoding, for example <code>{TEST_ISSUER_FINGERPRINT}</code>. VAOS 2.0 defines no fingerprint;
this is the projects' own convention. Sixteen hex characters are enough to tell keys apart at a glance; when it matters,
compare the whole key. The base64 inside a PEM block is the SPKI DER, so on macOS or Linux:</p>
{code(FINGERPRINT_COMMAND, "Compute a key's fingerprint")}
<p>On Linux, <code>sha256sum</code> in place of <code>shasum -a 256</code> works too.</p>""",
        ),
        (
            "rotation",
            "Rotation and revocation: what the spec says",
            f"""<ul>
<li>An issuer should publish a key-rotation manifest at <code>/.well-known/sovereign-receipts/keys.json</code>, listing its
active and retired keys with <code>not_before</code> and <code>not_after</code> times ({sec("8", "8-visibility")}).</li>
<li>The short cache time of {sec("6.3", "63-key-publication")} lets an emergency rotation spread quickly.</li>
<li>After a key is compromised, a receipt under it is only as trustworthy as independent evidence of when it was made,
such as a witnessed log entry from before the compromise ({sec("8", "8-visibility")}; {log_sec("6", "6-threat-model")}).</li>
</ul>
<p>VAOS 2.0 does not define the format of <code>keys.json</code>, a way to revoke a key, how a verifier applies the dates,
or a key identifier in the receipt; verify-receipts-action notes that its keys carry no validity period. Until the spec
defines these, the policy below is how this operator handles them.</p>""",
        ),
        (
            "policy",
            "Sovereign Matrix's key policy",
            f"""<div class="policy">
<p class="policy-label"><strong>This is the operator's policy, not part of VAOS 2.0.</strong> {esc(SITE["operator"])}
follows it for the keys it publishes; other issuers set their own.</p>
<ol>
<li><strong>Publication.</strong> Each production key is listed below with its PEM, fingerprint, status and the date it
was first used, and is served at the issuer's URL as {sec("6.3", "63-key-publication")} says. Every change to this page
goes through a reviewed pull request on receipts-explorer, so its history is public.</li>
<li><strong>Generation.</strong> A key is made as RFC 8032 says, checked against the key rule of
{sec("7.3", "73-ed25519-verification")} before it is published, and its private half is never put in a repository.</li>
<li><strong>Rotation.</strong> A new key is listed here before it signs anything. The key it replaces is marked retired,
with the date it stopped signing, and stays listed, so older receipts can still be checked.</li>
<li><strong>Revocation.</strong> A key that is compromised, or whose private half is lost, is marked revoked with the date
from which it is not to be trusted, and a security advisory says so. Do not trust a receipt signed under it after that
date; trust one from before only as far as independent evidence of when it was made, such as a witnessed log entry,
allows ({sec("8", "8-visibility")}).</li>
<li><strong>The list.</strong> Until VAOS defines a format for <code>keys.json</code>, this page is the list of the
operator's keys.</li>
</ol>
</div>""",
        ),
        (
            "test-keys",
            "Test keys",
            f"""<p>These keys are for trying the site and the libraries. They guard nothing.</p>
{key_block("test-issuer-key", "Conformance issuer key", TEST_ISSUER_KEY, TEST_ISSUER_FINGERPRINT, ISSUER_NOTE)}
{key_block("test-log-key", "Test log key", TEST_LOG_KEY, TEST_LOG_FINGERPRINT, LOG_NOTE)}""",
        ),
        (
            "production-keys",
            "Production keys",
            """<div class="key key--production">
<p><strong>No production key is published yet.</strong> When the operator signs receipts in real use, its keys will be
listed here, with their fingerprints, status and dates, by the policy above. Until then, no key on this site belongs to a
real issuer.</p>
</div>""",
        ),
    ]
    body = f"""<h1>Keys</h1>
<p class="lede">How an issuer's public key is published, checked and named, and how keys are rotated and revoked. Anyone
can check a receipt, but only against a key they trust: this page is about getting that key right.</p>
{sections(parts)}"""
    return meta, body
