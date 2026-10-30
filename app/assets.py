"""Subresource Integrity for the stylesheet and the script."""

from __future__ import annotations

import base64
import hashlib
from pathlib import Path

from .content import ROOT

STYLES = ROOT / "static" / "styles.css"
SCRIPT = ROOT / "build" / "check.js"


def integrity(path: Path) -> str:
    """The integrity attribute value of a file: sha384, base64."""
    digest = hashlib.sha384(path.read_bytes()).digest()
    return "sha384-" + base64.b64encode(digest).decode("ascii")


def hashes() -> dict[str, str]:
    """The integrity values the pages need. The script must be built first (npm run bundle)."""
    if not SCRIPT.is_file():
        raise SystemExit(f"{SCRIPT} is missing: run npm run bundle first")
    return {"styles": integrity(STYLES), "script": integrity(SCRIPT)}
