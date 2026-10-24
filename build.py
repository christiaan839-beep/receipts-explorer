#!/usr/bin/env python3
"""Writes the site to ./dist, as GitHub Pages serves it under /receipts-explorer/.

Usage:  npm run bundle && python3 build.py

dist/ holds every page, 404.html, static/ (styles, images and check.js),
robots.txt and sitemap.xml. The output depends only on the
sources: no dates, no randomness, so a rebuild is byte-identical.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from app.assets import SCRIPT, hashes  # noqa: E402
from app.content import SITE  # noqa: E402
from app.pages import all_routes, render_not_found, render_route  # noqa: E402

DIST = ROOT / "dist"


def write(rel: str, content: str) -> None:
    path = DIST / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def sitemap() -> str:
    urls = "".join(f"<url><loc>{SITE['base_url']}{p}</loc></url>" for p in all_routes())
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n'


def robots() -> str:
    return f"User-agent: *\nAllow: /\nSitemap: {SITE['base_url']}/sitemap.xml\n"


def main() -> None:
    assets = hashes()
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    for route in all_routes():
        html = render_route(route, assets)
        assert html is not None
        write("index.html" if route == "/" else route.strip("/") + "/index.html", html)
    write("404.html", render_not_found(assets))
    shutil.copytree(ROOT / "static", DIST / "static")
    shutil.copyfile(SCRIPT, DIST / "static" / "check.js")
    write("robots.txt", robots())
    write("sitemap.xml", sitemap())
    print(f"Built {len(all_routes())} pages, 404.html, sitemap.xml and robots.txt in {DIST}")


if __name__ == "__main__":
    main()
