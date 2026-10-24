"""build.py: the whole site, byte-identical on a rebuild."""

from __future__ import annotations

import hashlib
import subprocess
import sys
import unittest
from pathlib import Path

from app.pages import all_routes

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"


def snapshot() -> dict[str, str]:
    return {str(p.relative_to(DIST)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(DIST.rglob("*")) if p.is_file()}


class BuildTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        subprocess.run([sys.executable, str(ROOT / "build.py")], check=True, capture_output=True)
        cls.first = snapshot()

    def test_every_route_and_file_is_written(self) -> None:
        for route in all_routes():
            rel = "index.html" if route == "/" else route.strip("/") + "/index.html"
            self.assertIn(rel, self.first)
        for rel in ("404.html", "robots.txt", "sitemap.xml", "static/check.js", "static/styles.css"):
            self.assertIn(rel, self.first)

    def test_the_sitemap_lists_every_route(self) -> None:
        sitemap = (DIST / "sitemap.xml").read_text(encoding="utf-8")
        for route in all_routes():
            self.assertIn(f"<loc>https://christiaan839-beep.github.io/receipts-explorer{route}</loc>", sitemap)

    def test_a_rebuild_is_byte_identical(self) -> None:
        subprocess.run([sys.executable, str(ROOT / "build.py")], check=True, capture_output=True)
        self.assertEqual(snapshot(), self.first)


if __name__ == "__main__":
    unittest.main()
