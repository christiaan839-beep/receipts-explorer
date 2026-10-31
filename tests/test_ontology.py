"""The terms read from the vendored docs/ontology.md."""

from __future__ import annotations

import re
import unittest

from app.content import CHAIN, CHECKS, SITE, VR_REF
from app.ontology import (
    BY_SLUG,
    NAME_NOTE,
    RELATIONS,
    SOURCE,
    TERMS,
    bullets,
    inline,
    load,
    paragraphs,
    resolve,
    sections,
    slugify,
    table,
)

BASE = "https://github.com/christiaan839-beep/verifiable-receipts"
TEXT = SOURCE.read_text(encoding="utf-8")


def changed(old: str, new: str) -> str:
    """The vendored ontology with one change, which must apply."""
    assert old in TEXT, old
    return TEXT.replace(old, new, 1)


class OntologyTest(unittest.TestCase):
    def test_every_term_the_site_links_to_exists(self) -> None:
        for slug in [c["term"] for c in CHECKS] + [s for s, _, _ in CHAIN]:
            self.assertIn(slug, BY_SLUG)

    def test_protocol_terms_have_a_scitt_equivalent_and_agent_terms_do_not(self) -> None:
        protocol = [t for t in TERMS if t.group == "protocol"]
        agent = [t for t in TERMS if t.group == "agent"]
        self.assertEqual(len(protocol), 17)
        self.assertEqual(len(agent), 7)
        self.assertTrue(all(t.scitt for t in protocol))
        self.assertTrue(all(t.scitt == "" for t in agent))

    def test_every_term_is_read_once_with_a_well_formed_slug(self) -> None:
        self.assertEqual(len(TERMS), 24)
        self.assertEqual(len(BY_SLUG), len(TERMS))
        for t in TERMS:
            self.assertRegex(t.slug, r"^[a-z0-9]+(-[a-z0-9]+)*$")
        self.assertIn("fork", BY_SLUG)
        self.assertIn("job", BY_SLUG)

    def test_slugify(self) -> None:
        self.assertEqual(slugify("Issuer key"), "issuer-key")
        self.assertEqual(slugify("Agent terms (sovereign-agents)"), "agent-terms-sovereign-agents")
        self.assertEqual(slugify("(Tree_Head)"), "tree-head")

    def test_a_repeated_or_empty_slug_fails(self) -> None:
        self.assertEqual(len(load(TEXT)[0]), 24)
        with self.assertRaisesRegex(ValueError, "repeated slug"):
            load(changed("| Fork | Two", "| Witness | Two"))
        with self.assertRaisesRegex(ValueError, "repeated slug"):
            load(changed("| Fork | Two", "| Tree-head | Two"))
        with self.assertRaisesRegex(ValueError, "no slug"):
            load(changed("| Fork | Two", "| ... | Two"))

    def test_the_sections_the_pages_quote_are_there(self) -> None:
        self.assertTrue(NAME_NOTE)
        self.assertEqual(len(RELATIONS), 7)
        self.assertTrue(RELATIONS[0].startswith("An Issuer signs a Receipt"))
        self.assertIn("(a Fork)", RELATIONS[-1])

    def test_inline_markdown_is_escaped_then_formatted(self) -> None:
        self.assertEqual(inline("a <b> `c<d>`"), "a &lt;b&gt; <code>c&lt;d&gt;</code>")
        self.assertEqual(inline("**x**"), "<strong>x</strong>")

    def test_links_are_escaped(self) -> None:
        self.assertEqual(inline('[a<b](https://x/"y&z)'), '<a href="https://x/&quot;y&amp;z">a&lt;b</a>')
        self.assertEqual(inline("[`s/`](https://x)"), '<a href="https://x"><code>s/</code></a>')

    def test_code_spans_are_not_formatted(self) -> None:
        self.assertEqual(inline("`[a](b)` and `**x**`"), "<code>[a](b)</code> and <code>**x**</code>")

    def test_relative_links_point_to_the_pinned_commit(self) -> None:
        self.assertEqual(resolve("../schemas/receipt.schema.json"), f"{BASE}/blob/{VR_REF}/schemas/receipt.schema.json")
        self.assertEqual(resolve("../schemas"), f"{BASE}/tree/{VR_REF}/schemas")
        self.assertEqual(resolve("../schemas/"), f"{BASE}/tree/{VR_REF}/schemas")
        self.assertEqual(resolve("specs/v1.0/"), f"{BASE}/tree/{VR_REF}/docs/specs/v1.0")
        self.assertEqual(resolve("specs/vaos-2.0.md"), f"{BASE}/blob/{VR_REF}/docs/specs/vaos-2.0.md")
        self.assertEqual(resolve("../LICENSE"), f"{BASE}/blob/{VR_REF}/LICENSE")
        self.assertEqual(resolve("../.gitattributes"), f"{BASE}/blob/{VR_REF}/.gitattributes")
        self.assertEqual(resolve("https://example.org/a"), "https://example.org/a")
        self.assertEqual(resolve("#relations"), "#relations")
        self.assertIn(f"/blob/{VR_REF}/schemas/receipt.schema.json", BY_SLUG["receipt"].definition)

    def test_links_that_leave_the_repository_or_use_another_scheme_fail(self) -> None:
        for href in ["javascript:x", "JavaScript:x", "http://example.org", "mailto:a@b", "data:x", "../../x", "/x", "//host/x", "../"]:
            with self.subTest(href=href), self.assertRaises(ValueError):
                resolve(href)
        with self.assertRaises(ValueError):
            inline("[a](javascript:x)")

    def test_sections_skip_headings_inside_a_fence(self) -> None:
        self.assertEqual(sections("intro\n## A\n```\n## B\n```\ntext"), {"": "intro", "A": "```\n## B\n```\ntext"})
        terms, parts = load(changed("  Issuer -- signs with -->", "## Protocol terms\n  Issuer -- signs with -->"))
        self.assertEqual(len(terms), 24)
        self.assertIn("## Protocol terms", parts["The chain of trust"])

    def test_a_repeated_heading_or_an_open_fence_fails(self) -> None:
        with self.assertRaisesRegex(ValueError, "repeated heading"):
            sections("## A\nx\n## A\ny")
        with self.assertRaisesRegex(ValueError, "fence"):
            sections("## A\n```\nx")
        with self.assertRaisesRegex(ValueError, "fence"):
            paragraphs("p\n\n```\nx")
        with self.assertRaisesRegex(ValueError, "repeated heading"):
            load(changed("## Relations", "## Protocol terms"))
        with self.assertRaisesRegex(ValueError, "sections"):
            load(TEXT + "\n## Another section\n\nText.\n")

    def test_paragraphs_skip_fences_tables_and_lists(self) -> None:
        self.assertEqual(paragraphs("p1\n\n```\nx\n\ny\n```\n\n| a |\n\n- b\n\np2\nmore"), ["p1", "p2 more"])

    def test_markdown_the_parser_does_not_handle_fails(self) -> None:
        for body in ["# h", "### h", "> quote", "* item", "+ item", "1. item", "    code", "~~~\nx\n~~~", "---", "<div>", "p\n- item"]:
            with self.subTest(body=body), self.assertRaises(ValueError):
                paragraphs(body)
        with self.assertRaises(ValueError):
            load(changed("## Relations\n", "## Relations\n\nA paragraph the page would drop.\n"))

    def test_bullets_keep_every_item(self) -> None:
        self.assertEqual(bullets("- a\n  b\n- c"), ["a b", "c"])
        for body in ["* a", "- a\ntext", "- a\n\nb"]:
            with self.subTest(body=body), self.assertRaises(ValueError):
                bullets(body)
        with self.assertRaises(ValueError):
            load(changed("- An Issuer signs", "* An Issuer signs"))

    def test_tables_need_a_header_and_one_table(self) -> None:
        self.assertEqual(table("| a | b |\n|---|---|\n| c | d |"), [["c", "d"]])
        for body in ["| a |\n| b |\n| c |", "| a |\n|---|\n| b |\n\n| c |\n|---|\n| d |", "| a | b |\n|---|---|\n| c |", "text"]:
            with self.subTest(body=body), self.assertRaises(ValueError):
                table(body)


class OverrideTest(unittest.TestCase):
    def test_the_witness_is_not_called_independent(self) -> None:
        from app.ontology import BY_SLUG

        witness = BY_SLUG["witness"].definition
        self.assertTrue(witness.startswith("A party other than the log that cosigns"), witness)
        self.assertTrue(witness.endswith("only as independent as whoever runs it."), witness)
        self.assertNotIn("An independent party", witness)

    def test_an_override_whose_words_are_gone_fails_the_build(self) -> None:
        from app.ontology import Term, override

        changed = Term("Witness", "witness", "Someone who cosigns.", "", "protocol")
        with self.assertRaisesRegex(ValueError, "definition of 'Witness' changed"):
            override([changed])


class ContentTest(unittest.TestCase):
    def test_the_seven_checks(self) -> None:
        self.assertEqual(len(CHECKS), 7)
        self.assertEqual(len({c["id"] for c in CHECKS}), 7)
        for c in CHECKS:
            for key in ("id", "name", "term", "proves", "doesNotProve"):
                self.assertIsInstance(c[key], str)
                self.assertTrue(c[key].strip(), (c["id"], key))

    def test_the_description_fits_a_search_result(self) -> None:
        self.assertLessEqual(len(SITE["description"]), 160)
        self.assertNotRegex(SITE["description"], re.compile(r"\s{2}"))


if __name__ == "__main__":
    unittest.main()
