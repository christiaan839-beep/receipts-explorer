"""The terms, read from docs/ontology.md of verifiable-receipts.

The file is vendored byte-for-byte at the commit in
third_party/verifiable-receipts/VR_REF, so the term pages say exactly what
the ontology says at that commit. Relative links in it point to the same
commit on GitHub.
"""

from __future__ import annotations

import html
import posixpath
import re
from dataclasses import dataclass

from .content import SITE, VENDORED, VR_REF

SOURCE = VENDORED / "ontology.md"


@dataclass(frozen=True)
class Term:
    name: str
    slug: str
    definition: str  # HTML
    scitt: str  # HTML; empty for the agent terms
    group: str  # "protocol" or "agent"


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def resolve(href: str) -> str:
    """A link in docs/ontology.md, as an absolute URL at VR_REF."""
    if href.startswith(("https://", "http://", "#")):
        return href
    path = posixpath.normpath(posixpath.join("docs", href))
    kind = "blob" if posixpath.splitext(path)[1] else "tree"
    return f"{SITE['vr_repo']}/{kind}/{VR_REF}/{path}"


_CODE = re.compile(r"`([^`]+)`")
_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
_BOLD = re.compile(r"\*\*([^*]+)\*\*")


def inline(markdown: str) -> str:
    """The inline Markdown the ontology uses (code, links, bold) as HTML, escaped."""
    out = html.escape(markdown, quote=False)
    out = _CODE.sub(lambda m: f"<code>{m.group(1)}</code>", out)
    out = _LINK.sub(lambda m: f'<a href="{html.escape(resolve(html.unescape(m.group(2))))}">{m.group(1)}</a>', out)
    return _BOLD.sub(lambda m: f"<strong>{m.group(1)}</strong>", out)


def sections(text: str) -> dict[str, str]:
    """The body of each level-two section, by its heading."""
    out: dict[str, str] = {}
    heading = ""
    lines: list[str] = []
    for line in text.splitlines():
        if line.startswith("## "):
            out[heading] = "\n".join(lines).strip()
            heading, lines = line[3:].strip(), []
        else:
            lines.append(line)
    out[heading] = "\n".join(lines).strip()
    return out


def table(body: str) -> list[list[str]]:
    """The rows of the first Markdown table in `body`, without its header."""
    rows = [line for line in body.splitlines() if line.startswith("|")]
    return [[cell.strip() for cell in row.strip().strip("|").split("|")] for row in rows[2:]]


def paragraphs(body: str) -> list[str]:
    """The prose paragraphs of `body` (no tables, lists or code), as HTML."""
    out: list[str] = []
    for block in re.split(r"\n\s*\n", body):
        if block.strip() == "" or block.lstrip().startswith(("|", "-", "```")):
            continue
        out.append(inline(" ".join(line.strip() for line in block.splitlines() if line.strip())))
    return out


def bullets(body: str) -> list[str]:
    """The items of the Markdown list in `body`, as HTML."""
    items: list[str] = []
    for line in body.splitlines():
        if line.startswith("- "):
            items.append(line[2:].strip())
        elif line.startswith("  ") and items:
            items[-1] += " " + line.strip()
    return [inline(i) for i in items]


def load() -> tuple[list[Term], dict[str, str]]:
    text = SOURCE.read_text(encoding="utf-8")
    parts = sections(text)
    terms: list[Term] = []
    for name, definition, scitt in table(parts["Protocol terms"]):
        terms.append(Term(name, slugify(name), inline(definition), inline(scitt), "protocol"))
    for name, definition in table(parts["Agent terms (sovereign-agents)"]):
        terms.append(Term(name, slugify(name), inline(definition), "", "agent"))
    return terms, parts


TERMS, SECTIONS = load()
BY_SLUG = {t.slug: t for t in TERMS}
INTRO = paragraphs(SECTIONS[""].split("\n", 1)[1])
NAME_NOTE = paragraphs(SECTIONS["One name to read carefully"])
RELATIONS = bullets(SECTIONS["Relations"])
AGENT_INTRO = paragraphs(SECTIONS["Agent terms (sovereign-agents)"])
