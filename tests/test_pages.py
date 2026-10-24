"""Every page: one h1, lang en-ZA, the CSP, SEO metadata, no inline code, working links."""

from __future__ import annotations

import json
import unittest
from html.parser import HTMLParser

from app.layout import CSP
from app.pages import all_routes, render_not_found, render_route

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
            title = "".join(p.data["title"])
            description = p.meta("name", "description")
            canonical = next(a["href"] for a in p.all("link") if a.get("rel") == "canonical")
            self.assertLessEqual(len(description), 160, route)
            for key, value in (("title", title), ("description", description), ("canonical", canonical)):
                self.assertNotIn(value, seen[key], f"{route}: repeated {key}")
                seen[key].add(value)

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
