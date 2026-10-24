#!/usr/bin/env python3
"""Fails when the built site is over its size budget.

Usage:  python3 scripts/check_budget.py [dist]

The design's budget is the script: under 40 KB compressed (gzip, level 9,
as a lower bound on what GitHub Pages sends). The stylesheet and each page
have budgets too, because the Largest Contentful Paint target (1.5 s on
fast 3G) leaves room for little more than one page and one stylesheet.
"""

from __future__ import annotations

import gzip
import sys
from pathlib import Path

KB = 1024
BUDGETS = {"static/check.js": 40 * KB, "static/styles.css": 8 * KB}
PAGE_BUDGET = 12 * KB


def compressed(path: Path) -> int:
    return len(gzip.compress(path.read_bytes(), compresslevel=9, mtime=0))


def main() -> int:
    dist = Path(sys.argv[1] if len(sys.argv) > 1 else "dist")
    over = []
    for rel, budget in BUDGETS.items():
        size = compressed(dist / rel)
        print(f"{rel}: {size} bytes compressed (budget {budget})")
        if size > budget:
            over.append(rel)
    for page in sorted(dist.rglob("*.html")):
        size = compressed(page)
        if size > PAGE_BUDGET:
            print(f"{page.relative_to(dist)}: {size} bytes compressed (budget {PAGE_BUDGET})")
            over.append(str(page.relative_to(dist)))
    if over:
        print(f"over budget: {', '.join(over)}", file=sys.stderr)
        return 1
    print("every file is within its budget")
    return 0


if __name__ == "__main__":
    sys.exit(main())
