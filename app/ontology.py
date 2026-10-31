"""The terms, read from docs/ontology.md of verifiable-receipts.

The file is vendored byte-for-byte at the commit in
third_party/verifiable-receipts/VR_REF, so the term pages say exactly what
the ontology says at that commit. Relative links in it point to the same
commit on GitHub.

The reader fails closed: Markdown it does not handle, a section it does not
expect, a repeated heading or slug, or a link that leaves the repository
raises ValueError, so a change in the ontology's shape fails the build
instead of dropping words from the site.
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


_SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
# Files without an extension, which GitHub shows under /blob/, not /tree/.
_PLAIN_FILES = frozenset({"LICENSE", "NOTICE", "COPYING", "Makefile", "Dockerfile", "CODEOWNERS"})


def resolve(href: str) -> str:
    """A link in docs/ontology.md, as an absolute URL at VR_REF.

    Only https:// links and fragments pass as written; any other scheme, an
    absolute path, or a path that leaves the repository raises ValueError.
    """
    if href.startswith(("https://", "#")):
        return href
    if _SCHEME.match(href) or href.startswith("/") or "\\" in href:
        raise ValueError(f"link not allowed in the ontology: {href!r}")
    path = posixpath.normpath(posixpath.join("docs", href))
    if path == "." or path.startswith(("..", "/")):
        raise ValueError(f"link leaves the repository: {href!r}")
    name = posixpath.basename(path)
    is_file = not href.endswith("/") and (posixpath.splitext(name)[1] != "" or name.startswith(".") or name in _PLAIN_FILES)
    kind = "blob" if is_file else "tree"
    return f"{SITE['vr_repo']}/{kind}/{VR_REF}/{path}"


_CODE = re.compile(r"`([^`]+)`")
_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
_BOLD = re.compile(r"\*\*([^*]+)\*\*")
_STASHED = re.compile(r"\x00(\d+)\x00")


def _link(m: re.Match[str]) -> str:
    if "\x00" in m.group(2):
        raise ValueError(f"code in a link target: {m.group(0)!r}")
    return f'<a href="{html.escape(resolve(html.unescape(m.group(2))))}">{m.group(1)}</a>'


def inline(markdown: str) -> str:
    """The inline Markdown the ontology uses (code, links, bold) as HTML, escaped.

    Code spans are set aside first, so nothing inside them becomes a link or bold.
    """
    if "\x00" in markdown:
        raise ValueError("NUL in the ontology")
    codes: list[str] = []

    def stash(m: re.Match[str]) -> str:
        codes.append(f"<code>{m.group(1)}</code>")
        return f"\x00{len(codes) - 1}\x00"

    out = _CODE.sub(stash, html.escape(markdown, quote=False))
    out = _LINK.sub(_link, out)
    out = _BOLD.sub(lambda m: f"<strong>{m.group(1)}</strong>", out)
    return _STASHED.sub(lambda m: codes[int(m.group(1))], out)


def _is_fence(line: str) -> bool:
    return line.startswith("```")


def sections(text: str) -> dict[str, str]:
    """The body of each level-two section, by its heading; `## ` inside a code fence is not a heading."""
    out: dict[str, str] = {}

    def put(heading: str, lines: list[str]) -> None:
        if heading in out:
            raise ValueError(f"repeated heading in the ontology: {heading!r}")
        out[heading] = "\n".join(lines).strip()

    heading = ""
    lines: list[str] = []
    fenced = False
    for line in text.splitlines():
        if _is_fence(line):
            fenced = not fenced
        elif line.startswith("## ") and not fenced:
            put(heading, lines)
            heading, lines = line[3:].strip(), []
            continue
        lines.append(line)
    if fenced:
        raise ValueError("unclosed code fence in the ontology")
    put(heading, lines)
    return out


# The first line of a block, or any line of a paragraph, that starts Markdown this reader does not handle:
# headings, quotes, other lists, HTML, indented code, ~~~ fences, rules, link definitions, setext underlines.
_UNHANDLED = re.compile(r"^(#|>|[*+] |\d+[.)] |<|\s|~~~|-{3,}\s*$|\*{3,}|_{3,}|\[[^\]]*\]:|=+\s*$)")


def _kind(block: list[str]) -> str:
    if all(line.startswith("|") for line in block):
        return "table"
    if block[0].startswith("- ") and all(line.startswith(("- ", "  ")) for line in block):
        return "list"
    for line in block:
        if line.startswith(("|", "- ")) or _is_fence(line) or _UNHANDLED.match(line):
            raise ValueError(f"Markdown the site does not handle in the ontology: {line!r}")
    return "prose"


def blocks(body: str) -> list[tuple[str, list[str]]]:
    """The blocks of `body`, each "fence", "table", "list" or "prose"; anything else raises ValueError."""
    lines = body.splitlines()
    out: list[tuple[str, list[str]]] = []
    i = 0
    while i < len(lines):
        if lines[i].strip() == "":
            i += 1
        elif _is_fence(lines[i]):
            j = i + 1
            while j < len(lines) and not _is_fence(lines[j]):
                j += 1
            if j == len(lines):
                raise ValueError("unclosed code fence in the ontology")
            out.append(("fence", lines[i : j + 1]))
            i = j + 1
        else:
            j = i
            while j < len(lines) and lines[j].strip() != "" and not _is_fence(lines[j]):
                j += 1
            out.append((_kind(lines[i:j]), lines[i:j]))
            i = j
    return out


_SEPARATOR = re.compile(r"^\|(\s*:?-+:?\s*\|)+\s*$")


def table(body: str) -> list[list[str]]:
    """The rows of the one Markdown table in `body`, without its header."""
    tables = [b for kind, b in blocks(body) if kind == "table"]
    if len(tables) != 1:
        raise ValueError(f"expected one table in the ontology section, found {len(tables)}")
    rows = [[cell.strip() for cell in row.strip().strip("|").split("|")] for row in tables[0]]
    if len(rows) < 2 or not _SEPARATOR.match(tables[0][1].strip()):
        raise ValueError("an ontology table has no header row")
    if any(len(row) != len(rows[0]) for row in rows):
        raise ValueError("an ontology table row has the wrong number of cells")
    return rows[2:]


def paragraphs(body: str) -> list[str]:
    """The prose paragraphs of `body` (no tables, lists or code), as HTML."""
    return [inline(" ".join(line.strip() for line in b)) for kind, b in blocks(body) if kind == "prose"]


def bullets(body: str) -> list[str]:
    """The items of the Markdown list that is all of `body`, as HTML."""
    found = blocks(body)
    if [kind for kind, _ in found] != ["list"]:
        raise ValueError("expected one list, and nothing else, in the ontology section")
    items: list[str] = []
    for line in found[0][1]:
        if line.startswith("- "):
            items.append(line[2:].strip())
        else:
            items[-1] += " " + line.strip()
    return [inline(i) for i in items]


PROTOCOL = "Protocol terms"
AGENT = "Agent terms (sovereign-agents)"
# Each section the site reads, and the blocks it may hold; the title line of the preamble is dropped first.
SHAPE = {
    "": {"prose"},
    "One name to read carefully": {"prose"},
    "The chain of trust": {"fence"},
    PROTOCOL: {"table"},
    "Relations": {"list"},
    AGENT: {"prose", "table"},
}


def _preamble(parts: dict[str, str]) -> str:
    title, _, rest = parts[""].partition("\n")
    if not title.startswith("# "):
        raise ValueError("the ontology does not start with its title")
    return rest


def load(text: str) -> tuple[list[Term], dict[str, str]]:
    parts = sections(text)
    if set(parts) != set(SHAPE):
        raise ValueError(f"the ontology's sections changed: {sorted(set(parts) ^ set(SHAPE))}")
    for heading, allowed in SHAPE.items():
        body = _preamble(parts) if heading == "" else parts[heading]
        kinds = {kind for kind, _ in blocks(body)}
        if not kinds or not kinds <= allowed:
            raise ValueError(f"the ontology section {heading!r} holds {sorted(kinds)}, expected {sorted(allowed)}")
    terms: list[Term] = []
    for name, definition, scitt in table(parts[PROTOCOL]):
        terms.append(Term(name, slugify(name), inline(definition), inline(scitt), "protocol"))
    for name, definition in table(parts[AGENT]):
        terms.append(Term(name, slugify(name), inline(definition), "", "agent"))
    seen: set[str] = set()
    for t in terms:
        if not t.slug:
            raise ValueError(f"the term {t.name!r} has no slug")
        if not _SLUG.match(t.slug):
            raise ValueError(f"the term {t.name!r} has a malformed slug: {t.slug!r}")
        if t.slug in seen:
            raise ValueError(f"repeated slug in the ontology: {t.slug!r}")
        seen.add(t.slug)
    return terms, parts


# Words of the vendored ontology this site says otherwise, each replaced
# exactly once in the rendered definition, so the vendored file stays
# byte-for-byte upstream's and a change upstream fails the build here.
# The ontology calls a witness "An independent party", which the site
# cannot vouch for: a witness is only as independent as whoever runs it
# (verifiable-receipts should say so too).
OVERRIDES = {
    "witness": (
        "An independent party that cosigns",
        "A party other than the log that cosigns",
        " A witness is only as independent as whoever runs it.",
    ),
}


def override(terms: list[Term]) -> list[Term]:
    out = []
    for t in terms:
        if t.slug in OVERRIDES:
            old, new, after = OVERRIDES[t.slug]
            if t.definition.count(old) != 1:
                raise ValueError(f"the ontology's definition of {t.name!r} changed: {old!r} is not in it once")
            t = Term(t.name, t.slug, t.definition.replace(old, new) + after, t.scitt, t.group)
        out.append(t)
    return out


TERMS, SECTIONS = load(SOURCE.read_text(encoding="utf-8"))
TERMS = override(TERMS)
BY_SLUG = {t.slug: t for t in TERMS}
INTRO = paragraphs(_preamble(SECTIONS))
NAME_NOTE = paragraphs(SECTIONS["One name to read carefully"])
RELATIONS = bullets(SECTIONS["Relations"])
AGENT_INTRO = paragraphs(SECTIONS[AGENT])
