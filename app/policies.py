"""The site's policies: privacy, terms of use and security, and security.txt.

The operator is Sovereign Matrix. The privacy policy states what the code
does (tests/test_policies.py holds it to the code: no cookies, no
storage, no requests but the log's) and is written for both POPIA and the
GDPR. The pages load no script.
"""

from __future__ import annotations

from .content import ADVISORY_REPOS, REPOS, SECURITY_TXT_EXPIRES, SITE
from .layout import absolute, esc, url

UPDATED = "31 October 2026"
GITHUB_PRIVACY = "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement"
GITHUB_PAGES_DATA = "https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages"
REGULATOR = "https://inforegulator.org.za/complaints/"
EDPB_MEMBERS = "https://www.edpb.europa.eu/about-edpb/about-edpb/members_en"


def mail(subject: str = "") -> str:
    # The subject is fixed text from this module, never a visitor's input.
    query = f"?subject={subject.replace(' ', '%20')}" if subject else ""
    return f'<a href="mailto:{SITE["email"]}{query}">{esc(SITE["email"])}</a>'


def section(id_: str, title: str, body: str) -> str:
    return f'<section aria-labelledby="{id_}">\n<h2 id="{id_}">{esc(title)}</h2>\n{body}\n</section>\n'


def web_page(name: str, description: str) -> dict:
    return {"@type": "WebPage", "name": name, "description": description, "inLanguage": SITE["locale"], "dateModified": "2026-10-31"}


def page_privacy() -> tuple[dict, str]:
    description = (
        "What this site does with personal information, under POPIA and the GDPR: it is static, checks run in "
        "your browser, nothing is uploaded, and it sets no cookies."
    )
    meta = {"path": "/privacy/", "title": "Privacy policy", "description": description, "schema": web_page("Privacy policy", description)}
    operator = esc(SITE["operator"])
    who = f"""<p>{operator} runs this site. It is the responsible party under the Protection of Personal Information Act, 2013
(POPIA), and the controller under the EU General Data Protection Regulation (GDPR), for the little personal information
this site handles. Contact: {mail("Privacy")}.</p>
<p>Information Officer (POPIA): {operator}, at {mail("Information Officer")}.</p>"""
    what = """<ul>
<li><strong>The site is static.</strong> It is a set of files served by GitHub Pages. There is no server of ours, no
account, and no form that sends anything to us.</li>
<li><strong>Checks run in your browser.</strong> A receipt or key you paste or choose stays in the tab and is not
uploaded. Nothing you type is put in the address bar.</li>
<li><strong>No cookies, no storage, no analytics.</strong> The site sets no cookies, stores nothing in your browser, and
loads no analytics, trackers, adverts, fonts or scripts from other sites. Its Content Security Policy allows scripts,
styles and images from this site only.</li>
<li><strong>If you give a log address,</strong> your browser sends that log only GET requests, carrying the leaf hash of
each receipt you look up, never its text. Like any web server, the log sees your IP address and the time, so it can tell
that someone at that address looked up that entry. You choose the log; whoever runs it is responsible for its logs, and
its own privacy terms apply.</li>
</ul>"""
    github = f"""<p>GitHub Pages serves the site. GitHub says that when a GitHub Pages site is visited, the visitor's IP address is
logged and stored for security purposes (<a href="{GITHUB_PAGES_DATA}">What is GitHub Pages?</a>). GitHub, Inc. processes
those logs under the <a href="{GITHUB_PRIVACY}">GitHub General Privacy Statement</a>, and may do so outside South Africa
and the European Union, including in the United States. {operator} does not receive those logs.</p>"""
    contact = f"""<p>If you email {mail()} or send a private security report through GitHub, we receive your address or GitHub
account and what you write. We use it only to answer you and, for a security report, to fix the flaw and credit you if you
wish, and we keep it for as long as that takes. The basis is our legitimate interest in answering you (POPIA section
11(1)(f); GDPR article 6(1)(f)). The mailbox is hosted by Google and the reports by GitHub, so these messages may be stored
outside South Africa and the European Union. We do not sell this information, use it for advertising, or make automated
decisions about anyone from it.</p>"""
    rights = f"""<p>Under POPIA you may ask whether we hold personal information about you and for a copy of it (section 23), ask us
to correct or delete it (section 24), and object to its processing (section 11(3)). Under the GDPR, where it applies to
you, you may ask for access (article 15), correction (article 16), erasure (article 17), restriction (article 18) and a
portable copy (article 20), and you may object (article 21). Write to {mail("Privacy request")}; we answer within the time
each law sets, and may first need to confirm that the request is yours.</p>"""
    complaints = f"""<p>Please write to us first, so we can put it right. You may also complain to:</p>
<ul>
<li><strong>South Africa's Information Regulator</strong>, under section 74 of POPIA. Complaints are lodged through its
eServices portal: see <a href="{REGULATOR}">how to lodge a complaint</a>.</li>
<li><strong>A data protection supervisory authority in the European Union</strong>, under article 77 of the GDPR, in the
member state where you live or work or where the matter arose. The European Data Protection Board lists them among
<a href="{EDPB_MEMBERS}">its members</a>.</li>
</ul>"""
    changes = f"""<p>When this policy changes, the date above changes with it. Every version is in the site's public repository,
<a href="{REPOS["receipts-explorer"]}">receipts-explorer</a>.</p>"""
    body = f"""<h1>Privacy policy</h1>
<p class="lede">This site checks receipts in your browser. It collects nothing about you itself, and what you paste stays
in your browser tab.</p>
<p>Last updated {UPDATED}.</p>
{section("who", "Who is responsible", who)}{section("what", "What happens when you use the site", what)}\
{section("github", "GitHub, which hosts the site", github)}{section("contact", "When you write to us", contact)}\
{section("rights", "Your rights", rights)}{section("complaints", "Complaints", complaints)}{section("changes", "Changes", changes)}"""
    return meta, body


def page_terms_of_use() -> tuple[dict, str]:
    description = (
        "The terms of use of the receipts explorer: South African law, provided as is with no warranty, "
        "and its results are evidence, not legal or compliance advice."
    )
    meta = {"path": "/terms/", "title": "Terms of use", "description": description, "schema": web_page("Terms of use", description)}
    operator = esc(SITE["operator"])
    site = f"""<p>{operator} runs this site, at {esc(absolute("/"))}. It checks verifiable receipts in your browser and explains
how they work. Its code is open source under the Apache License 2.0, which governs the code; see
<a href="{REPOS["receipts-explorer"]}">receipts-explorer</a>. These terms govern your use of the site.</p>"""
    evidence = """<p>A check on this site gives evidence about a receipt: for instance that a key signed exactly this text, or that a
log holds it. A receipt is evidence for an audit. It is not automatic compliance with any law, standard or contract, and a
passed check is not a certificate.</p>
<p>The site does not give legal, compliance, regulatory, financial or other professional advice. A passed check does not
mean that what a receipt records is true, that the key belongs to whom you think, or that any requirement is met. Where it
matters, decide what a receipt is worth with a qualified adviser.</p>"""
    as_is = f"""<p>The site is provided as is and as available, without warranty of any kind, express or implied, including that it
is accurate, complete, available, fit for a purpose or free of errors, to the extent the law allows. Nothing in these terms
limits a right you have under the Consumer Protection Act, 2008, or any other law, that cannot lawfully be limited.</p>
<p>To the extent the law allows, {operator} is not liable for any loss or damage that comes from using the site or relying
on its results, including indirect or consequential loss, loss of profit and loss of data.</p>"""
    others = """<p>A transparency log you ask the site to check, GitHub, which hosts the site, and any site linked from it are run by
others, under their own terms. We are not responsible for them.</p>"""
    fair = f"""<p>Do not attack the site, overload it, or try to make it harm its visitors. Security research that follows the
<a href="{url("/security/")}">security policy</a> is welcome.</p>"""
    law = """<p>These terms are governed by the law of the Republic of South Africa, and the courts of South Africa have
jurisdiction over any dispute about them.</p>"""
    changes = f"""<p>When these terms change, the date above changes with it, and every version is in the site's public repository.
Questions: {mail("Terms of use")}.</p>"""
    body = f"""<h1>Terms of use</h1>
<p class="lede">The receipts explorer is free to use. By using it you accept these terms.</p>
<p>Last updated {UPDATED}.</p>
{section("site", "The site", site)}{section("evidence", "Evidence, not advice", evidence)}\
{section("as-is", "Provided as is", as_is)}{section("others", "Other services", others)}\
{section("use", "Using the site fairly", fair)}{section("law", "Law", law)}{section("changes", "Changes and contact", changes)}"""
    return meta, body


def page_security() -> tuple[dict, str]:
    description = (
        "How to report a security flaw in the receipts explorer or the receipts projects, privately, "
        "through GitHub or by email, and what happens next."
    )
    meta = {
        "path": "/security/",
        "title": "Security: reporting a vulnerability",
        "description": description,
        "schema": web_page("Security: reporting a vulnerability", description),
    }
    advisories = "".join(f'<li><a href="{REPOS[r]}/security/advisories/new">{esc(r)}</a></li>' for r in ADVISORY_REPOS)
    report = f"""<p>Report it through GitHub's private vulnerability reporting, on the repository the flaw is in (the
<strong>Security</strong> tab, then <strong>Report a vulnerability</strong>):</p>
<ul>{advisories}</ul>
<p>For sovereign-agents, or if you cannot use GitHub, email {mail("[security]")} with <code>[security]</code> at the start of
the subject. Please do not open a public issue.</p>
<p>Include what you expected and what happened, the browser or version, and the receipt, keys or log answers that show it,
using test keys only, never a key in real use. You can test against your own copy of this site
(<code>python3 serve.py</code>), which answers only on your own machine.</p>"""
    after = """<p>You should get a first reply within seven days. A fix is developed in a private advisory, and the advisory is
published with the release or deploy that fixes it, crediting you unless you ask otherwise.</p>"""
    scope = f"""<p>For this site, in scope is anything that makes the page show a check as passed when it should fail or did not
run, give different verdicts in different supported browsers, send a visitor's receipt or keys anywhere but the log
address they typed, store anything a visitor gives, or run script the build did not ship. The full scope, and what is out
of scope, is in the repository's <a href="{REPOS["receipts-explorer"]}/blob/main/SECURITY.md">SECURITY.md</a>; each project
has its own.</p>"""
    tools = f"""<p>This policy is also at <a href="{url("/.well-known/security.txt")}">/.well-known/security.txt</a> (RFC 9116).</p>"""
    body = f"""<h1>Security</h1>
<p class="lede">Found a flaw in this site or in the receipts projects? Please tell us privately, so it can be fixed before
it is made public.</p>
{section("report", "How to report", report)}{section("next", "What happens next", after)}\
{section("scope", "Scope", scope)}{section("machine", "For tools", tools)}"""
    return meta, body


def security_txt() -> str:
    """/.well-known/security.txt, RFC 9116: how to report a vulnerability, for tools."""
    lines = [
        f"Contact: {REPOS['receipts-explorer']}/security/advisories/new",
        f"Contact: mailto:{SITE['email']}",
        f"Expires: {SECURITY_TXT_EXPIRES}",
        "Preferred-Languages: en",
        f"Canonical: {absolute('/.well-known/security.txt')}",
        f"Policy: {absolute('/security/')}",
    ]
    return "\n".join(lines) + "\n"
