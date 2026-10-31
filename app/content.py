"""The words and settings of the site, each stated once."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDORED = ROOT / "third_party" / "verifiable-receipts"
VR_REF = (VENDORED / "VR_REF").read_text(encoding="utf-8").strip()

SITE = {
    "name": "Receipts explorer",
    "base_url": "https://verify.sovereignmatrix.co.za",
    "base_path": "",
    "locale": "en-ZA",
    "og_locale": "en_ZA",
    "description": (
        "Check a verifiable receipt's signature, hash and log proof in your browser. "
        "Your receipt is not uploaded; given a log address, only its hash goes to that log."
    ),
    "repo": "https://github.com/christiaan839-beep/receipts-explorer",
    "vr_repo": "https://github.com/christiaan839-beep/verifiable-receipts",
    "author": "Christiaan de Wet / Sovereign Matrix",
    "operator": "Sovereign Matrix",
    "email": "sovereign.systems007@gmail.com",
}

# The projects the docs describe, and the specifications they cite, at the
# commit the vendored code comes from (VR_REF), so a section number names
# the text the site was written against.
REPOS = {
    "verifiable-receipts": "https://github.com/christiaan839-beep/verifiable-receipts",
    "receipts-log": "https://github.com/christiaan839-beep/receipts-log",
    "verify-receipts-action": "https://github.com/christiaan839-beep/verify-receipts-action",
    "sovereign-agents": "https://github.com/christiaan839-beep/sovereign-agents",
    "receipts-explorer": "https://github.com/christiaan839-beep/receipts-explorer",
}
VAOS = f"{REPOS['verifiable-receipts']}/blob/{VR_REF}/docs/specs/vaos-2.0.md"
LOG_SPEC = f"{REPOS['verifiable-receipts']}/blob/{VR_REF}/docs/specs/transparency-log.md"

# The repositories that take a private report through GitHub's private
# vulnerability reporting. sovereign-agents has it switched off, so its
# reports go by email.
ADVISORY_REPOS = ["receipts-explorer", "verifiable-receipts", "receipts-log", "verify-receipts-action"]

# security.txt (RFC 9116). Expires is a fixed date, so a rebuild stays
# byte-identical; tests/test_policies.py fails once it is less than 30
# days away, which is the reminder to renew it.
SECURITY_TXT_EXPIRES = "2027-10-01T00:00:00.000Z"

NAV = [
    {"label": "Check a receipt", "path": "/", "key": "check"},
    {"label": "How it works", "path": "/how-it-works/", "key": "how"},
    {"label": "Docs", "path": "/docs/", "key": "docs"},
    {"label": "Keys", "path": "/keys/", "key": "keys"},
    {"label": "Glossary", "path": "/glossary/", "key": "glossary"},
]

# The footer's links: the docs, the policies, and the files for machines.
FOOTER = [
    {"label": "Docs", "path": "/docs/"},
    {"label": "Quickstart", "path": "/docs/quickstart/"},
    {"label": "Keys", "path": "/keys/"},
    {"label": "Privacy", "path": "/privacy/"},
    {"label": "Terms of use", "path": "/terms/"},
    {"label": "Security", "path": "/security/"},
    {"label": "security.txt", "path": "/.well-known/security.txt"},
    {"label": "Sitemap", "path": "/sitemap.xml"},
]

# The seven checks, shared with the script (src/ui.ts imports the same file).
CHECKS = json.loads((ROOT / "content" / "checks.json").read_text(encoding="utf-8"))

# The chain of trust, from issuer to witness, for the How it works page.
CHAIN = [
    ("issuer", "Issuer", "A business, or the host acting for it, signs a receipt for each action with its issuer key."),
    (
        "receipt",
        "Receipt",
        "The exact text that was signed, its hash and its signature. Change one character of the signed text and it fails.",
    ),
    (
        "leaf",
        "Leaf",
        "A hash of the receipt's signed text, appended to a transparency log, which is meant only to grow; witnesses check that it does.",
    ),
    ("tree-head", "Tree head", "The log signs its size and root from time to time, committing to every entry so far."),
    ("inclusion-proof", "Inclusion proof", "A few hashes that link one receipt to the root in a signed tree head."),
    ("witness", "Witness", "Independent parties cosign a tree head only if it extends the last one they cosigned."),
    (
        "verifier",
        "Verifier",
        "This page: it checks each link itself, and trusts none of them on its own. "
        "The libraries check receipts and inclusion proofs, not tree-head signatures or cosignatures.",
    ),
]

PRIVACY = [
    "Your receipt is not uploaded; receipts and keys stay in this tab.",
    "If you give a log address, the page sends only GET requests, and only to that address. "
    "The log learns the leaf hash of each receipt you look up, never its text.",
    "The log, like any web server, also sees your IP address and when you asked, so it can tell "
    "that someone at that address looked up that entry. GitHub Pages, which serves this page, "
    "sees the visit but nothing you paste.",
    "No cookies, no storage, no analytics. Nothing you type goes in the address bar.",
    "The page's script is checked by its hash before it runs, and every release is attested.",
]
