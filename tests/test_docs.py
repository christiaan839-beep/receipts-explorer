"""The docs, quickstart and key pages: the test receipt and keys are the fixtures, labelled as tests, and claims cite the spec."""

from __future__ import annotations

import base64
import hashlib
import html
import json
import re
import unittest
from pathlib import Path

from app import docs
from app.content import LOG_SPEC, VAOS, VR_REF
from app.pages import render_route

ROOT = Path(__file__).resolve().parent.parent
ASSETS = {"styles": "sha384-styles", "script": "sha384-script"}
DOCS = render_route("/docs/", ASSETS) or ""
QUICKSTART = render_route("/docs/quickstart/", ASSETS) or ""
KEYS = render_route("/keys/", ASSETS) or ""
PEM = re.compile(r"-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+-----END PUBLIC KEY-----")


def fingerprint(pem: str) -> str:
    """The fingerprint keys.ts and verify-receipts-action show: sha256: and 16 hex of the SPKI DER."""
    der = base64.b64decode("".join(line for line in pem.splitlines() if not line.startswith("-----")))
    return "sha256:" + hashlib.sha256(der).hexdigest()[:16]


def text(page: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", page))


class QuickstartTest(unittest.TestCase):
    def test_the_test_receipt_and_key_are_the_conformance_fixtures(self) -> None:
        fixture = json.loads((ROOT / "test/fixtures/conformance/v2-valid-001.json").read_text(encoding="utf-8"))
        self.assertTrue(fixture["expected"]["ok"])
        self.assertEqual(json.loads(docs.TEST_RECEIPT), fixture["receipt"])
        self.assertIn(html.escape(docs.TEST_RECEIPT, quote=True), QUICKSTART)
        key = (ROOT / "test/fixtures/conformance/public-key.pem").read_text(encoding="utf-8").strip()
        self.assertEqual(docs.TEST_ISSUER_KEY, key)
        self.assertIn(key, QUICKSTART)

    def test_each_fingerprint_shown_is_its_key_s(self) -> None:
        self.assertEqual(fingerprint(docs.TEST_ISSUER_KEY), docs.TEST_ISSUER_FINGERPRINT)
        self.assertEqual(fingerprint(docs.TEST_LOG_KEY), docs.TEST_LOG_FINGERPRINT)
        for page in (QUICKSTART, KEYS):
            for shown in set(re.findall(r"sha256:[0-9a-f]{16}\b", page)):
                self.assertIn(shown, {docs.TEST_ISSUER_FINGERPRINT, docs.TEST_LOG_FINGERPRINT})

    def test_every_registry_command_says_it_is_not_published_yet(self) -> None:
        for command, release in (
            ("pip install sovereign-matrix-verifiable-receipts", "0.3.0"),
            ("npm install @sovereignos/verifiable-receipts", "0.5.1"),
            (f"go get {docs.GO_MODULE}@v0.2.0", "v0.2.0"),
        ):
            with self.subTest(command=command):
                at = QUICKSTART.index(command)
                start = QUICKSTART.rindex('<p class="unpublished">', 0, at)
                note = QUICKSTART[start : QUICKSTART.index("</p>", at)]
                self.assertIn(f"Available from release {release}", note)
                self.assertIn("not published yet", note)
                self.assertEqual(QUICKSTART.count(command), 1)
        # And nothing claims a package is on a registry.
        self.assertNotRegex(text(QUICKSTART), r"(?i)is (now )?(on|published to|available on) (npm|pypi)")

    def test_the_typescript_sample_says_what_it_does_not_check(self) -> None:
        self.assertIn("exports no whole-receipt v2 verifier", QUICKSTART)


class KeysTest(unittest.TestCase):
    def test_every_key_on_the_page_is_a_test_key_and_labelled_so(self) -> None:
        keys = PEM.findall(KEYS)
        self.assertEqual(keys, [docs.TEST_ISSUER_KEY, docs.TEST_LOG_KEY])
        blocks = re.findall(r'<div class="key key--test".*?</div>', KEYS, re.S)
        self.assertEqual(len(blocks), 2)
        for block in blocks:
            self.assertIn("Test key. Never trust a receipt because it verifies under it.", block)
            self.assertEqual(len(PEM.findall(block)), 1)

    def test_the_production_keys_section_is_there_and_empty(self) -> None:
        start = KEYS.index('<h2 id="production-keys">')
        section = KEYS[start : KEYS.index("</section>", start)]
        self.assertIn("No production key is published yet.", section)
        self.assertNotIn("BEGIN PUBLIC KEY", section)
        self.assertIsNone(re.search(r"sha256:[0-9a-f]{16}", section))

    def test_the_policy_is_marked_as_the_operator_s(self) -> None:
        start = KEYS.index('<div class="policy">')
        self.assertIn("This is the operator's policy, not part of VAOS 2.0.", html.unescape(KEYS[start : start + 400]))
        for word in ("Rotation.", "Revocation."):
            self.assertIn(word, KEYS)

    def test_the_fingerprint_command_gives_the_fingerprint(self) -> None:
        # grep -v -- ----- | base64 -d | shasum -a 256 | cut -c1-16, in Python.
        self.assertIn(docs.FINGERPRINT_COMMAND, html.unescape(KEYS))
        self.assertEqual(fingerprint(docs.TEST_ISSUER_KEY), docs.TEST_ISSUER_FINGERPRINT)


class CitationsTest(unittest.TestCase):
    def test_every_spec_link_is_at_vr_ref(self) -> None:
        for page in (DOCS, QUICKSTART, KEYS):
            links = re.findall(r'href="([^"]*docs/specs/[^"]*)"', page)
            self.assertTrue(links)
            for link in links:
                self.assertTrue(link.startswith((VAOS, LOG_SPEC)), link)
                self.assertIn(f"/blob/{VR_REF}/", link)

    def test_the_docs_cite_the_sections_the_brief_names(self) -> None:
        for anchor in ("73-ed25519-verification", "63-key-publication", "7-verification-procedure", "8-visibility"):
            self.assertIn(f"{VAOS}#{anchor}", DOCS)
        for anchor in ("5-witness-protocol", "6-threat-model", "34-inclusion-proof"):
            self.assertIn(f"{LOG_SPEC}#{anchor}", DOCS)

    def test_the_docs_call_a_receipt_evidence_not_compliance(self) -> None:
        words = text(DOCS)
        self.assertIn("evidence for an audit", words)
        self.assertIn("not automatic compliance", words)


if __name__ == "__main__":
    unittest.main()
