"""The page bodies and the ROUTES map.

Every page has one h1, reads in full without JavaScript, and links each
check to the term it relies on. Only the check page loads the script.
"""

from __future__ import annotations

import html
import re

from .content import CHAIN, CHECKS, PRIVACY, SITE, VR_REF
from .layout import absolute, esc, render_page, url
from .ontology import AGENT_INTRO, BY_SLUG, NAME_NOTE, RELATIONS, TERMS, Term


def plain(fragment: str, limit: int = 155) -> str:
    """HTML as plain text, cut at a word to `limit` characters, for a meta description."""
    text = html.unescape(re.sub(r"<[^>]+>", "", fragment))
    if len(text) <= limit:
        return text
    return text[: limit - 1].rsplit(" ", 1)[0] + "…"


def term_link(slug: str, label: str | None = None) -> str:
    return f'<a href="{url(f"/terms/{slug}/")}">{esc(label or BY_SLUG[slug].name)}</a>'


def file_field(id_: str, label: str, hint: str, file_label: str, rows: int) -> str:
    return f"""<div class="field">
    <label for="{id_}">{label}</label>
    <p class="hint" id="{id_}-hint">{hint}</p>
    <textarea id="{id_}" rows="{rows}" spellcheck="false" autocomplete="off" aria-describedby="{id_}-hint"></textarea>
    <label class="file-label" for="{id_}-file">{file_label}</label>
    <input type="file" id="{id_}-file" accept=".json,.pem,.txt,application/json" data-into="{id_}">
  </div>"""


def check_list() -> str:
    items = "".join(
        f"<li><h3>{term_link(c['term'], c['name'])}</h3><p>{esc(c['proves'])}</p>"
        f'<p class="limits">It does not prove: {esc(c["doesNotProve"])}</p></li>'
        for c in CHECKS
    )
    return f'<ol class="check-list">{items}</ol>'


RECEIPT_HINT = "Paste the receipt's JSON, or drop its file here. A list of receipts is checked one by one."
ISSUER_HINT = "Paste the PEM block, from -----BEGIN PUBLIC KEY----- to -----END PUBLIC KEY-----. Several keys may be pasted."
LOG_KEY_HINT = "The key the log signs its tree heads with. Get it from the log's operator, not from the log itself."


def page_check() -> tuple[dict, str]:
    meta = {
        "path": "/",
        "title": "Check a receipt: signature, content and transparency log",
        "description": SITE["description"],
        "active": "check",
        "script": True,
        "schema": {
            "@type": "WebApplication",
            "name": SITE["name"],
            "applicationCategory": "SecurityApplication",
            "operatingSystem": "Any, in a current web browser",
            "description": SITE["description"],
            "isAccessibleForFree": True,
            "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
        },
    }
    privacy = "".join(f"<li>{esc(p)}</li>" for p in PRIVACY)
    body = f"""<h1>Check a receipt</h1>
<p class="lede">A receipt is an issuer's signed record of something an AI agent did. Paste one with the issuer's public key,
and this page checks, in your browser, that the issuer signed exactly this text. Give a receipts-log address and the
log's public key too, and it checks that the receipt is in the log; with witness keys, that witnesses saw the same log.</p>
<p id="needs-js" class="notice">Checking needs JavaScript, which is off or did not load. The rest of this page explains the checks.</p>
<p id="framed" class="notice" hidden>This page checks receipts only at its own address, not inside another page.
<a href="{url("/")}" target="_top">Open it on its own</a>.</p>
<p id="no-ed25519" class="notice" hidden>This browser cannot check Ed25519 signatures, so no checks can run here.
Use a current version of Firefox, Chrome, Edge or Safari.</p>
<div id="problems" class="problems" tabindex="-1" role="alert" hidden></div>
<form id="check-form" class="check-form" novalidate hidden>
  {file_field("receipt-text", "Receipt", RECEIPT_HINT, "Or choose a receipt file", 8)}
  {file_field("issuer-key", "Issuer's public key", ISSUER_HINT, "Or choose a key file", 4)}
  <details class="optional">
    <summary>Also check the transparency log (optional)</summary>
    <div class="field">
      <label for="log-address">Log address</label>
      <p class="hint" id="log-address-hint">The receipts-log address the issuer uses, starting with https://.</p>
      <input type="url" id="log-address" inputmode="url" spellcheck="false" autocomplete="off" aria-describedby="log-address-hint">
    </div>
    {file_field("log-key", "Log's public key", LOG_KEY_HINT, "Or choose the log key file", 4)}
    {file_field("witness-keys", "Witness public keys", "Optional. One PEM block per witness.", "Or choose a witness key file", 4)}
  </details>
  <button type="submit" class="button">Check</button>
</form>
<p id="status" class="status" role="status" aria-live="polite"></p>
<section id="results" class="results" aria-labelledby="results-heading" hidden>
  <h2 id="results-heading" tabindex="-1">Results</h2>
  <div id="results-list"></div>
  <button type="button" id="retry" class="button button--secondary" hidden>Try the log again</button>
</section>
<section aria-labelledby="checks-heading">
  <h2 id="checks-heading">The seven checks</h2>
  <p>Each check is passed, failed or not run. A check that cannot run, because a key or the log address is missing or the
  log cannot be reached, is shown as not run, or as a network error, never as passed.</p>
  {check_list()}
</section>
<section aria-labelledby="privacy-heading">
  <h2 id="privacy-heading">What this page does with your receipt</h2>
  <ul>{privacy}</ul>
</section>"""
    return meta, body


def chain_figure() -> str:
    step, width, box = 64, 300, 44
    shapes = []
    for i, (_, name, _) in enumerate(CHAIN):
        y = i * step
        shapes.append(f'<rect class="chain-box" x="10" y="{y}" width="{width - 20}" height="{box}" rx="6"></rect>')
        shapes.append(f'<text class="chain-label" x="{width // 2}" y="{y + 28}" text-anchor="middle">{esc(name)}</text>')
        if i < len(CHAIN) - 1:
            top, bottom = y + box, y + step
            shapes.append(f'<path class="chain-arrow" d="M{width // 2} {top} V{bottom - 4} m-5 -6 l5 6 l5 -6"></path>')
    height = (len(CHAIN) - 1) * step + box
    names = ", ".join(name for _, name, _ in CHAIN)
    steps = "".join(f"<li>{term_link(slug, name)}: {esc(text)}</li>" for slug, name, text in CHAIN)
    return f"""<figure class="chain">
  <svg viewBox="0 0 {width} {height}" role="img" aria-labelledby="chain-title">
    <title id="chain-title">The chain of trust: {esc(names)}.</title>
    {"".join(shapes)}
  </svg>
  <figcaption>The chain of trust, from the issuer to the witnesses. Each link is checked on its own.</figcaption>
</figure>
<ol class="chain-steps">{steps}</ol>"""


def page_how() -> tuple[dict, str]:
    meta = {
        "path": "/how-it-works/",
        "title": "How it works: the chain of trust",
        "description": (
            "How a receipt is checked without trusting the agent, its host or the log: issuer, receipt, "
            "transparency log, tree head, inclusion proof and witnesses."
        ),
        "active": "how",
        "schema": {"@type": "TechArticle", "headline": "How it works: the chain of trust", "inLanguage": SITE["locale"]},
    }
    relations = "".join(f"<li>{r}</li>" for r in RELATIONS)
    note = "".join(f"<p>{p}</p>" for p in NAME_NOTE)
    body = f"""<h1>How it works</h1>
<p class="lede">An AI agent acts for a business. The business signs a receipt for each action, and appends it to a
transparency log that is meant only to grow; witnesses check that it does. Anyone can then check the receipt, and its
place in the log, without trusting the agent, its host or the log.</p>
{chain_figure()}
<h2>What each part promises</h2>
<ul>{relations}</ul>
<h2>One name to read carefully</h2>
{note}
<p>Every term has its own page: see <a href="{url("/terms/")}">the terms</a>.</p>"""
    return meta, body


def page_terms() -> tuple[dict, str]:
    meta = {
        "path": "/terms/",
        "title": "Terms: the ontology of verifiable receipts",
        "description": "Every term verifiable receipts uses, defined once, with its SCITT (RFC 9943) equivalent where there is one.",
        "active": "terms",
        "schema": {
            "@type": "DefinedTermSet",
            "@id": absolute("/terms/"),
            "name": "Verifiable receipts ontology",
            "inLanguage": SITE["locale"],
        },
    }
    protocol = "".join(
        f"<li>{term_link(t.slug)}<span class='term-scitt'>SCITT: {t.scitt}</span></li>" for t in TERMS if t.group == "protocol"
    )
    agent = "".join(f"<li>{term_link(t.slug)}</li>" for t in TERMS if t.group == "agent")
    note = "".join(f"<p>{p}</p>" for p in NAME_NOTE)
    intro = "".join(f"<p>{p}</p>" for p in AGENT_INTRO)
    body = f"""<h1>Terms</h1>
<p class="lede">The terms of verifiable receipts, each defined once, from
<a href="{SITE["vr_repo"]}/blob/{VR_REF}/docs/ontology.md">docs/ontology.md</a> at commit <code>{VR_REF[:12]}</code>.</p>
{note}
<h2>Protocol terms</h2>
<ul class="term-list">{protocol}</ul>
<h2>Agent terms</h2>
{intro}
<ul class="term-list">{agent}</ul>"""
    return meta, body


def page_term(term: Term) -> tuple[dict, str]:
    meta = {
        "path": f"/terms/{term.slug}/",
        "title": f"{term.name}: definition",
        "description": plain(term.definition),
        "active": "terms",
        "schema": {
            "@type": "DefinedTerm",
            "name": term.name,
            "description": plain(term.definition, 1000),
            "inDefinedTermSet": {
                "@type": "DefinedTermSet",
                "@id": absolute("/terms/"),
                "url": absolute("/terms/"),
                "name": "Verifiable receipts ontology",
            },
        },
    }
    scitt = f"<h2>In SCITT (RFC 9943)</h2><p>{term.scitt}</p>" if term.scitt else ""
    checks = [c for c in CHECKS if c["term"] == term.slug]
    used = ""
    if checks:
        names = " and ".join(f"“{esc(c['name'])}”" for c in checks)
        noun = "check" if len(checks) == 1 else "checks"
        used = f'<h2>Checked on this site</h2><p>This term is used by the {names} {noun}. <a href="{url("/")}">Check a receipt</a>.</p>'
    body = f"""<nav class="breadcrumb" aria-label="Breadcrumb"><a href="{url("/terms/")}">Terms</a></nav>
<h1>{esc(term.name)}</h1>
<p class="definition">{term.definition}</p>
{scitt}
{used}
<p class="source">From <a href="{SITE["vr_repo"]}/blob/{VR_REF}/docs/ontology.md">docs/ontology.md</a>
at commit <code>{VR_REF[:12]}</code>.</p>"""
    return meta, body


def not_found() -> tuple[dict, str]:
    meta = {
        "path": "/404.html",
        "title": "Page not found",
        "description": "There is no page at this address.",
        "noindex": True,
        "schema": {"@type": "WebPage", "name": "Page not found"},
    }
    body = f"""<h1>Page not found</h1>
<p>There is no page at this address. <a href="{url("/")}">Check a receipt</a>, or see the <a href="{url("/terms/")}">terms</a>.</p>"""
    return meta, body


ROUTES = {"/": page_check, "/how-it-works/": page_how, "/terms/": page_terms}
for _t in TERMS:
    ROUTES[f"/terms/{_t.slug}/"] = lambda t=_t: page_term(t)


def render_route(path: str, assets: dict[str, str]) -> str | None:
    fn = ROUTES.get(path)
    if fn is None:
        return None
    meta, body = fn()
    return render_page(meta, body, assets)


def render_not_found(assets: dict[str, str]) -> str:
    meta, body = not_found()
    return render_page(meta, body, assets)


def all_routes() -> list[str]:
    return list(ROUTES)
