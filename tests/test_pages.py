"""Every page: one h1, lang en-ZA, the CSP, SEO metadata, no inline code, working links."""

from __future__ import annotations

import json
import unittest
from html.parser import HTMLParser
from unittest import mock

from app.layout import CSP, render_page
from app.ontology import Term
from app.pages import all_routes, page_term, render_not_found, render_route

ASSETS = {"styles": "sha384-styles", "script": "sha384-script"}
BASE = "/receipts-explorer"
STATIC = {f"{BASE}/static/styles.css", f"{BASE}/static/check.js", f"{BASE}/static/img/favicon.svg"}


class Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tags: list[tuple[str, dict[str, str]]] = []
        self.data: dict[str, list[str]] = {}
        self._open: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.tags.append((tag, {k: v or "" for k, v in attrs}))
        self._open.append(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag in self._open:
            self._open.remove(tag)

    def handle_data(self, data: str) -> None:
        if self._open:
            self.data.setdefault(self._open[-1], []).append(data)

    def all(self, tag: str) -> list[dict[str, str]]:
        return [a for t, a in self.tags if t == tag]

    def meta(self, key: str, value: str) -> str:
        return next(a["content"] for a in self.all("meta") if a.get(key) == value)


def parse(html: str) -> Page:
    p = Page()
    p.feed(html)
    return p


PAGES = {route: render_route(route, ASSETS) or "" for route in all_routes()}
PAGES["/404.html"] = render_not_found(ASSETS)

# A term whose name and definition hold markup: the name is text, the
# definition is HTML as app/ontology.py renders it, with its text escaped.
EVIL = Term(
    name='<script>"&amp; x',
    slug="evil",
    definition="A &lt;script&gt;&quot;&amp; definition.",
    scitt="",
    group="protocol",
)
EVIL_PAGE = render_page(*page_term(EVIL), ASSETS)
PAGES["/terms/evil/"] = EVIL_PAGE

NOINDEX = {"/404.html"}


class PagesTest(unittest.TestCase):
    def test_every_page_has_the_shell(self) -> None:
        for route, html in PAGES.items():
            with self.subTest(route=route):
                p = parse(html)
                self.assertEqual(p.all("html")[0]["lang"], "en-ZA")
                self.assertEqual(len(p.all("h1")), 1)
                self.assertEqual(p.meta("http-equiv", "Content-Security-Policy"), CSP)
                self.assertEqual(p.meta("name", "referrer"), "no-referrer")
                self.assertTrue(p.all("main")[0]["id"] == "main")
                self.assertEqual(p.all("a")[0]["href"], "#main")

    def test_the_csp_forbids_inline_code(self) -> None:
        self.assertIn("default-src 'none'", CSP)
        self.assertIn("script-src 'self';", CSP)
        self.assertIn("style-src 'self';", CSP)
        self.assertNotIn("unsafe", CSP)
        for route, html in PAGES.items():
            with self.subTest(route=route):
                for tag, attrs in parse(html).tags:
                    self.assertNotIn("style", attrs, f"<{tag} style>")
                    self.assertFalse([k for k in attrs if k.startswith("on")], f"<{tag}> has an event handler")
                    if tag == "script":
                        self.assertTrue(attrs.get("type") == "application/ld+json" or "src" in attrs)
                    if tag == "style":
                        self.fail("inline <style>")

    def test_titles_descriptions_and_canonicals_are_unique(self) -> None:
        seen: dict[str, set[str]] = {"title": set(), "description": set(), "canonical": set()}
        for route, html in PAGES.items():
            p = parse(html)
            title = p.data["title"][0]  # the head's title, not the figure's SVG title
            description = p.meta("name", "description")
            canonicals = [a["href"] for a in p.all("link") if a.get("rel") == "canonical"]
            self.assertLessEqual(len(description), 160, route)
            values = [("title", title), ("description", description)]
            if route in NOINDEX:
                self.assertEqual(canonicals, [], f"{route}: a page not indexed has no canonical")
            else:
                self.assertEqual(len(canonicals), 1, route)
                values.append(("canonical", canonicals[0]))
            for key, value in values:
                self.assertNotIn(value, seen[key], f"{route}: repeated {key}")
                seen[key].add(value)

    def test_open_graph_and_robots(self) -> None:
        for route, html in PAGES.items():
            with self.subTest(route=route):
                p = parse(html)
                title = p.data["title"][0]  # the head's title, not the figure's SVG title
                description = p.meta("name", "description")
                self.assertEqual(p.meta("property", "og:title"), title)
                self.assertEqual(p.meta("property", "og:description"), description)
                self.assertEqual(p.meta("name", "twitter:title"), title)
                og_urls = [a["content"] for a in p.all("meta") if a.get("property") == "og:url"]
                if route in NOINDEX:
                    self.assertEqual(p.meta("name", "robots"), "noindex")
                    self.assertEqual(og_urls, [])
                else:
                    self.assertEqual(p.meta("name", "robots"), "index, follow")
                    canonical = next(a["href"] for a in p.all("link") if a.get("rel") == "canonical")
                    self.assertEqual(og_urls, [canonical])
                    self.assertTrue(canonical.startswith("https://christiaan839-beep.github.io/receipts-explorer/"))

    def test_the_stylesheet_carries_its_hash(self) -> None:
        for route, html in PAGES.items():
            with self.subTest(route=route):
                sheets = [a for a in parse(html).all("link") if a.get("rel") == "stylesheet"]
                self.assertEqual(sheets, [{"rel": "stylesheet", "href": f"{BASE}/static/styles.css", "integrity": "sha384-styles"}])

    def test_the_csp_is_exactly_this(self) -> None:
        directives = dict(d.split(" ", 1) for d in CSP.split("; "))
        self.assertEqual(
            directives,
            {
                "default-src": "'none'",
                "script-src": "'self'",
                "style-src": "'self'",
                "img-src": "'self' data:",
                "connect-src": "https:",
                "base-uri": "'none'",
                "form-action": "'none'",
                "require-trusted-types-for": "'script'",
            },
        )

    def test_ids_are_unique_and_every_reference_exists(self) -> None:
        for route, html in PAGES.items():
            with self.subTest(route=route):
                p = parse(html)
                ids = [a["id"] for _, a in p.tags if "id" in a]
                self.assertEqual(len(ids), len(set(ids)), f"repeated ids: {sorted(i for i in ids if ids.count(i) > 1)}")
                for _, attrs in p.tags:
                    for key in ("aria-describedby", "aria-labelledby", "for"):
                        for ref in attrs.get(key, "").split():
                            self.assertIn(ref, ids, f"{key}={ref}")

    def test_markup_in_a_term_is_text(self) -> None:
        p = parse(EVIL_PAGE)
        self.assertEqual([a for a in p.all("script") if a.get("type") != "application/ld+json"], [])
        self.assertEqual("".join(p.data["h1"]), '<script>"&amp; x')
        self.assertEqual(p.data["title"][0], '<script>"&amp; x: definition | Receipts explorer')
        self.assertEqual(p.meta("name", "description"), 'A <script>"& definition.')
        self.assertEqual("".join(p.data["p"]).count('A <script>"& definition.'), 1)
        self.assertNotIn('<script>"', EVIL_PAGE)
        data = json.loads("".join(p.data["script"]))
        self.assertEqual(data["@graph"][1]["name"], '<script>"&amp; x')
        self.assertEqual(data["@graph"][1]["description"], 'A <script>"& definition.')

    def test_the_nav_labels_and_site_name_are_text(self) -> None:
        nav = [{"label": "<b>&amp;", "path": "/terms/", "key": "terms"}]
        with mock.patch("app.layout.NAV", nav), mock.patch.dict("app.layout.SITE", {"name": "<i>&amp;"}):
            p = parse(render_route("/terms/", ASSETS) or "")
        self.assertEqual([t for t, _ in p.tags if t in ("b", "i")], [])
        links = [a for a in p.all("a") if a.get("class") == "brand" or "aria-current" in a]
        self.assertEqual(len(links), 2)
        self.assertIn("<i>&amp;", p.data["a"])
        self.assertIn("<b>&amp;", p.data["a"])

    def test_json_ld_has_no_markup(self) -> None:
        for route, html in PAGES.items():
            with self.subTest(route=route):
                self.assertNotIn("<", "".join(parse(html).data["script"]))

    def test_the_nav_marks_the_page_and_its_section(self) -> None:
        def current(route: str) -> list[tuple[str, str]]:
            return [(a["href"], a["aria-current"]) for a in parse(PAGES[route]).all("a") if "aria-current" in a]

        self.assertEqual(current("/"), [(f"{BASE}/", "page")])
        self.assertEqual(current("/terms/"), [(f"{BASE}/terms/", "page")])
        self.assertEqual(current("/terms/receipt/"), [(f"{BASE}/terms/", "true")])
        self.assertEqual(current("/404.html"), [])
        navs = [a.get("aria-label") for a in parse(PAGES["/terms/receipt/"]).all("nav")]
        self.assertEqual(navs, ["Main", "Breadcrumb"])

    def test_the_check_page_says_it_needs_javascript_until_the_script_starts(self) -> None:
        p = parse(PAGES["/"])
        by_id = {a["id"]: a for _, a in p.tags if "id" in a}
        self.assertNotIn("hidden", by_id["needs-js"])
        self.assertIn("hidden", by_id["framed"])
        self.assertIn("hidden", by_id["check-form"])
        self.assertEqual(p.all("noscript"), [])
        self.assertIn("Checking needs JavaScript", PAGES["/"])

    def test_json_ld_parses(self) -> None:
        for route, html in PAGES.items():
            with self.subTest(route=route):
                blocks = parse(html).data["script"]
                data = json.loads("".join(blocks))
                self.assertEqual(data["@context"], "https://schema.org")

    def test_only_the_check_page_loads_the_script_and_it_carries_its_hash(self) -> None:
        for route, html in PAGES.items():
            scripts = [a for a in parse(html).all("script") if "src" in a]
            if route == "/":
                self.assertEqual(scripts, [{"type": "module", "src": f"{BASE}/static/check.js", "integrity": "sha384-script"}])
            else:
                self.assertEqual(scripts, [], route)

    def test_every_internal_link_resolves(self) -> None:
        targets = {BASE + r for r in all_routes()} | STATIC
        for route, html in PAGES.items():
            p = parse(html)
            ids = {a["id"] for _, a in p.tags if "id" in a}
            for _, attrs in p.tags:
                href = attrs.get("href") or attrs.get("src") or ""
                if href.startswith("#"):
                    self.assertIn(href[1:], ids, f"{route}: {href}")
                elif href.startswith("/"):
                    self.assertIn(href.split("#")[0], targets, f"{route}: {href}")

    def test_every_form_field_has_a_label(self) -> None:
        p = parse(PAGES["/"])
        labelled = {a["for"] for a in p.all("label")}
        for tag in ("input", "textarea"):
            for attrs in p.all(tag):
                self.assertIn(attrs["id"], labelled)


if __name__ == "__main__":
    unittest.main()
