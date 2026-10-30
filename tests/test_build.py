"""build.py: the whole site, byte-identical on a rebuild, swapped in only when the build succeeds."""

from __future__ import annotations

import base64
import contextlib
import hashlib
import io
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import build
from app.content import SITE
from app.pages import all_routes

ROOT = Path(__file__).resolve().parent.parent


def run_build(out: Path) -> str:
    result = subprocess.run([sys.executable, str(ROOT / "build.py"), "--out", str(out)], check=True, capture_output=True, text=True)
    return result.stdout


def snapshot(dist: Path) -> dict[str, str]:
    return {str(p.relative_to(dist)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(dist.rglob("*")) if p.is_file()}


def sri(path: Path) -> str:
    return "sha384-" + base64.b64encode(hashlib.sha384(path.read_bytes()).digest()).decode("ascii")


class BuildTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dist = Path(cls.tmp.name) / "dist"
        cls.stdout = run_build(cls.dist)
        cls.first = snapshot(cls.dist)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmp.cleanup()

    def test_it_says_what_it_built(self) -> None:
        self.assertIn(f"Built {len(all_routes())} pages, 404.html, sitemap.xml and robots.txt in {self.dist.resolve()}", self.stdout)

    def test_every_route_and_file_is_written(self) -> None:
        for route in all_routes():
            rel = "index.html" if route == "/" else route.strip("/") + "/index.html"
            self.assertIn(rel, self.first)
        for rel in ("404.html", "robots.txt", "sitemap.xml", "static/check.js", "static/styles.css", "static/img/favicon.svg"):
            self.assertIn(rel, self.first)

    def test_the_script_is_the_bundle(self) -> None:
        self.assertEqual((self.dist / "static" / "check.js").read_bytes(), (ROOT / "build" / "check.js").read_bytes())

    def test_every_integrity_attribute_is_the_hash_of_the_file_it_names(self) -> None:
        base = SITE["base_path"] + "/"
        pages = sorted(self.dist.rglob("*.html"))
        self.assertEqual(len(pages), len(all_routes()) + 1)
        seen = set()
        for page in pages:
            html = page.read_text(encoding="utf-8")
            tags = re.findall(r'<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"[^>]*?integrity="([^"]+)"', html)
            self.assertIn("static/styles.css", {src[len(base) :] for src, _ in tags}, page)
            for src, value in tags:
                self.assertTrue(src.startswith(base), src)
                self.assertEqual(value, sri(self.dist / src[len(base) :]), f"{page}: {src}")
                seen.add(src[len(base) :])
        self.assertEqual(seen, {"static/styles.css", "static/check.js"})

    def test_the_sitemap_lists_every_route_once_and_nothing_else(self) -> None:
        sitemap = (self.dist / "sitemap.xml").read_text(encoding="utf-8")
        locs = re.findall(r"<loc>([^<]*)</loc>", sitemap)
        self.assertEqual(locs, [f"https://verify.sovereignmatrix.co.za{route}" for route in all_routes()])
        self.assertTrue(all(loc.startswith("https://") for loc in locs))
        self.assertNotIn("404", sitemap)
        self.assertNotIn("lastmod", sitemap)
        self.assertTrue(
            sitemap.startswith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
        )

    def test_robots_allows_all_and_names_the_sitemap(self) -> None:
        robots = (self.dist / "robots.txt").read_text(encoding="utf-8").splitlines()
        self.assertEqual(robots, ["User-agent: *", "Allow: /", "Sitemap: https://verify.sovereignmatrix.co.za/sitemap.xml"])

    def test_a_rebuild_is_byte_identical_and_leaves_nothing_beside_it(self) -> None:
        run_build(self.dist)
        self.assertEqual(snapshot(self.dist), self.first)
        self.assertEqual([p.name for p in self.dist.parent.iterdir()], ["dist"])

    def test_the_site_is_readable_by_all(self) -> None:
        self.assertEqual(stat.S_IMODE(self.dist.stat().st_mode), 0o755)


class BuildInProcessTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.parent = Path(self.tmp.name)
        self.dist = self.parent / "dist"
        quiet = contextlib.redirect_stdout(io.StringIO())
        quiet.__enter__()
        self.addCleanup(quiet.__exit__, None, None, None)

    def test_a_failed_build_leaves_the_last_build_in_place(self) -> None:
        build.main(["--out", str(self.dist)])
        before = snapshot(self.dist)
        with mock.patch.object(build, "render_not_found", side_effect=RuntimeError("boom")), self.assertRaises(RuntimeError):
            build.main(["--out", str(self.dist)])
        self.assertEqual(snapshot(self.dist), before)
        self.assertEqual(sorted(p.name for p in self.parent.iterdir()), ["dist"])

    def test_a_route_that_does_not_render_stops_the_build(self) -> None:
        with mock.patch.object(build, "render_route", return_value=None), self.assertRaisesRegex(RuntimeError, "did not render"):
            build.main(["--out", str(self.dist)])
        self.assertEqual(list(self.parent.iterdir()), [])

    def test_hidden_files_in_static_are_not_published(self) -> None:
        static = self.parent / "static"
        shutil.copytree(ROOT / "static", static)
        (static / ".DS_Store").write_bytes(b"x")
        (static / "img" / ".hidden").write_bytes(b"x")
        with mock.patch.object(build, "STATIC", static):
            build.main(["--out", str(self.dist)])
        names = {str(p.relative_to(self.dist)) for p in self.dist.rglob("*")}
        self.assertIn("static/styles.css", names)
        self.assertFalse([n for n in names if Path(n).name.startswith(".")], names)

    def test_the_default_output_is_dist(self) -> None:
        self.assertEqual(build.DIST, ROOT / "dist")


if __name__ == "__main__":
    unittest.main()
