"""The words and settings of the site, each stated once."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDORED = ROOT / "third_party" / "verifiable-receipts"
VR_REF = (VENDORED / "VR_REF").read_text(encoding="utf-8").strip()

SITE = {
    "name": "Receipts explorer",
    "base_url": "https://christiaan839-beep.github.io/receipts-explorer",
    "base_path": "/receipts-explorer",
    "locale": "en-ZA",
    "og_locale": "en_ZA",
    "description": (
        "Check a verifiable receipt in your browser: its signature, its content, and its place in a "
        "transparency log. Nothing you paste leaves your device."
    ),
    "repo": "https://github.com/christiaan839-beep/receipts-explorer",
    "vr_repo": "https://github.com/christiaan839-beep/verifiable-receipts",
    "author": "Christiaan de Wet / Sovereign Matrix",
}

NAV = [
    {"label": "Check a receipt", "path": "/", "key": "check"},
    {"label": "How it works", "path": "/how-it-works/", "key": "how"},
    {"label": "Terms", "path": "/terms/", "key": "terms"},
]

# The seven checks, shared with the script (src/ui.ts imports the same file).
CHECKS = json.loads((ROOT / "content" / "checks.json").read_text(encoding="utf-8"))

# The chain of trust, from issuer to witness, for the How it works page.
CHAIN = [
    ("issuer", "Issuer", "A business, or the host acting for it, signs a receipt for each action with its issuer key."),
    ("receipt", "Receipt", "The exact text that was signed, its hash and its signature. Change one character and it fails."),
    ("leaf", "Leaf", "The receipt's hash, appended to a transparency log, which can only grow."),
    ("tree-head", "Tree head", "The log signs its size and root from time to time, committing to every entry so far."),
    ("inclusion-proof", "Inclusion proof", "A few hashes that link one receipt to the root in a signed tree head."),
    ("witness", "Witness", "Independent parties cosign a tree head only if it extends the last one they saw."),
    ("verifier", "Verifier", "This page, or a library: it checks each link itself, and trusts none of them on its own."),
]

PRIVACY = [
    "Your receipts and keys stay in this browser tab. The page uploads nothing.",
    "If you give a log address, the page sends only GET requests, and only to that address. "
    "The log learns the hash of each receipt you look up.",
    "No cookies, no storage, no analytics. Nothing you type goes in the address bar.",
    "The page's script is checked by its hash before it runs, and every release is attested.",
]
