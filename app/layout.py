"""The HTML shell, once for every page.

Every page gets: lang="en-ZA"; a Content Security Policy as a meta tag
(GitHub Pages sends no headers) that allows scripts and styles from the
site only, no inline code, no HTML from strings (Trusted Types), and
connections only over https; no referrer; a unique title and description,
and, on a page to be indexed, a canonical URL; Open Graph and Twitter
metadata; JSON-LD; a skip link and landmarks. The stylesheet and the
script carry Subresource Integrity hashes.
"""

from __future__ import annotations

import html
import json

from .content import NAV, SITE

CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src https:; base-uri 'none'; "
    "form-action 'none'; require-trusted-types-for 'script'"
)


def url(path: str) -> str:
    """A site path under the base path (the root, on verify.sovereignmatrix.co.za), such as /glossary/."""
    return SITE["base_path"] + path


def absolute(path: str) -> str:
    return SITE["base_url"] + path


def esc(text: str) -> str:
    return html.escape(text, quote=True)


def _json_ld(meta: dict) -> str:
    graph = [
        {
            "@type": "WebSite",
            "@id": absolute("/#website"),
            "url": absolute("/"),
            "name": SITE["name"],
            "inLanguage": SITE["locale"],
            "publisher": {"@type": "Person", "name": "Christiaan de Wet"},
        },
        {**meta["schema"], "url": absolute(meta["path"]), "isPartOf": {"@id": absolute("/#website")}},
    ]
    text = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False, sort_keys=True)
    # A JSON-LD block is data, not code. Every "<" is written as <, which
    # JSON reads as the same character, so no text can end the element early
    # or open a comment in it.
    return text.replace("<", "\\u003c")


def _head(meta: dict, assets: dict[str, str]) -> str:
    title = meta["title"] if meta["path"] == "/" else f"{meta['title']} | {SITE['name']}"
    canonical = absolute(meta["path"])
    script = ""
    if meta.get("script"):
        script = f'\n  <script type="module" src="{url("/static/check.js")}" integrity="{assets["script"]}"></script>'
    robots = "noindex" if meta.get("noindex") else "index, follow"
    # A page not to be indexed, such as the 404 page, has no address of its own to name.
    link = "" if meta.get("noindex") else f'\n  <link rel="canonical" href="{canonical}">'
    og_url = "" if meta.get("noindex") else f'\n  <meta property="og:url" content="{canonical}">'
    return f"""  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="{CSP}">
  <meta name="referrer" content="no-referrer">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(meta["description"])}">
  <meta name="robots" content="{robots}">{link}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="{esc(SITE["name"])}">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(meta["description"])}">{og_url}
  <meta property="og:locale" content="{SITE["og_locale"]}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="{esc(title)}">
  <meta name="twitter:description" content="{esc(meta["description"])}">
  <link rel="icon" href="{url("/static/img/favicon.svg")}" type="image/svg+xml">
  <link rel="stylesheet" href="{url("/static/styles.css")}" integrity="{assets["styles"]}">{script}
  <script type="application/ld+json">{_json_ld(meta)}</script>"""


def _header(meta: dict) -> str:
    items = []
    for n in NAV:
        # "page" on the section's own page; "true" on a page within it, such as a term.
        current = ""
        if n["key"] == meta.get("active"):
            current = ' aria-current="page"' if n["path"] == meta["path"] else ' aria-current="true"'
        items.append(f'<li><a href="{url(n["path"])}"{current}>{esc(n["label"])}</a></li>')
    return f"""<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="container header-inner">
    <a class="brand" href="{url("/")}">{esc(SITE["name"])}</a>
    <nav aria-label="Main"><ul class="nav">{"".join(items)}</ul></nav>
  </div>
</header>"""


def _footer() -> str:
    return f"""<footer class="site-footer">
  <div class="container">
    <p>Open source, Apache-2.0: <a href="{esc(SITE["repo"])}">receipts-explorer on GitHub</a>.
    The checks are those of <a href="{esc(SITE["vr_repo"])}">verifiable-receipts</a>.</p>
    <p>{esc(SITE["author"])}.</p>
  </div>
</footer>"""


def render_page(meta: dict, body: str, assets: dict[str, str]) -> str:
    """Wraps a page body in the document shell."""
    return f"""<!doctype html>
<html lang="{SITE["locale"]}">
<head>
{_head(meta, assets)}
</head>
<body>
{_header(meta)}
<main id="main" class="container">
{body}
</main>
{_footer()}
</body>
</html>
"""
