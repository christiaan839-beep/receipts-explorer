#!/usr/bin/env python3
"""Writes the site to ./dist, as GitHub Pages serves it at the root of verify.sovereignmatrix.co.za.

Usage:  npm run bundle && python3 build.py [--out DIR]

dist/ holds every page, 404.html, static/ (styles, images and check.js),
a page for each old /terms/<term>/ address that sends its reader to
/glossary/<term>/, robots.txt, sitemap.xml and .well-known/security.txt
(RFC 9116), which
deploy.yml uploads with include-hidden-files: upload-pages-artifact leaves
out files whose names start with a dot unless told otherwise. The output depends only on the
sources: no dates, no randomness, so a rebuild is byte-identical.

The site is written to a new directory beside the output and swapped in
only when it is complete, so a build that fails leaves the last one in
place. Hidden files in static/ are not published.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from app.assets import SCRIPT, hashes  # noqa: E402
from app.content import SITE  # noqa: E402
from app.pages import REDIRECTS, all_routes, render_moved, render_not_found, render_route  # noqa: E402
from app.policies import security_txt  # noqa: E402

DIST = ROOT / "dist"
STATIC = ROOT / "static"
SECURITY_TXT = ".well-known/security.txt"


def write(out: Path, rel: str, content: str) -> None:
    path = out / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def sitemap() -> str:
    urls = "".join(f"<url><loc>{SITE['base_url']}{p}</loc></url>" for p in all_routes())
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n'


def robots() -> str:
    return f"User-agent: *\nAllow: /\nSitemap: {SITE['base_url']}/sitemap.xml\n"


def render_into(out: Path) -> None:
    assets = hashes()
    for route in all_routes():
        html = render_route(route, assets)
        if html is None:
            raise RuntimeError(f"route {route} did not render")
        write(out, "index.html" if route == "/" else route.strip("/") + "/index.html", html)
    for old in REDIRECTS:
        write(out, old.strip("/") + "/index.html", render_moved(old, assets) or "")
    write(out, "404.html", render_not_found(assets))
    shutil.copytree(STATIC, out / "static", ignore=shutil.ignore_patterns(".*"))
    shutil.copyfile(SCRIPT, out / "static" / "check.js")
    write(out, "robots.txt", robots())
    write(out, "sitemap.xml", sitemap())
    write(out, SECURITY_TXT, security_txt())


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Write the site to a directory, as GitHub Pages serves it.")
    parser.add_argument("--out", type=Path, default=DIST, help="the output directory (default: dist/)")
    out = parser.parse_args(argv).out.resolve()
    hashes()  # fail before touching anything if the script is not built
    out.parent.mkdir(parents=True, exist_ok=True)
    new = Path(tempfile.mkdtemp(prefix=f".{out.name}-new-", dir=out.parent))
    old = out.parent / f".{out.name}-old-{new.name.rsplit('-', 1)[1]}"
    try:
        new.chmod(0o755)
        render_into(new)
        if out.exists():
            out.rename(old)
        new.rename(out)
    except BaseException:
        shutil.rmtree(new, ignore_errors=True)
        if old.exists() and not out.exists():
            old.rename(out)
        raise
    shutil.rmtree(old, ignore_errors=True)
    print(f"Built {len(all_routes())} pages, 404.html, sitemap.xml, robots.txt and {SECURITY_TXT} in {out}")


if __name__ == "__main__":
    main()
