"""The terms read from the vendored docs/ontology.md."""

from __future__ import annotations

import unittest

from app.content import CHAIN, CHECKS, VR_REF
from app.ontology import BY_SLUG, NAME_NOTE, RELATIONS, TERMS, inline, resolve, slugify


class OntologyTest(unittest.TestCase):
    def test_every_term_the_site_links_to_exists(self) -> None:
        for slug in [c["term"] for c in CHECKS] + [s for s, _, _ in CHAIN]:
            self.assertIn(slug, BY_SLUG)

    def test_protocol_terms_have_a_scitt_equivalent_and_agent_terms_do_not(self) -> None:
        protocol = [t for t in TERMS if t.group == "protocol"]
        agent = [t for t in TERMS if t.group == "agent"]
        self.assertGreaterEqual(len(protocol), 15)
        self.assertGreaterEqual(len(agent), 7)
        self.assertTrue(all(t.scitt for t in protocol))
        self.assertTrue(all(t.scitt == "" for t in agent))

    def test_slugs_are_unique(self) -> None:
        self.assertEqual(len(BY_SLUG), len(TERMS))
        self.assertEqual(slugify("Issuer key"), "issuer-key")

    def test_the_sections_the_pages_quote_are_there(self) -> None:
        self.assertTrue(NAME_NOTE)
        self.assertTrue(RELATIONS)

    def test_inline_markdown_is_escaped_then_formatted(self) -> None:
        self.assertEqual(inline("a <b> `c<d>`"), "a &lt;b&gt; <code>c&lt;d&gt;</code>")
        self.assertEqual(inline("**x**"), "<strong>x</strong>")

    def test_relative_links_point_to_the_pinned_commit(self) -> None:
        base = "https://github.com/christiaan839-beep/verifiable-receipts"
        self.assertEqual(resolve("../schemas/receipt.schema.json"), f"{base}/blob/{VR_REF}/schemas/receipt.schema.json")
        self.assertEqual(resolve("../schemas"), f"{base}/tree/{VR_REF}/schemas")
        self.assertEqual(resolve("specs/vaos-2.0.md"), f"{base}/blob/{VR_REF}/docs/specs/vaos-2.0.md")
        self.assertIn(f"/blob/{VR_REF}/schemas/receipt.schema.json", BY_SLUG["receipt"].definition)


if __name__ == "__main__":
    unittest.main()
