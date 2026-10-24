#!/usr/bin/env python3
"""Fails when the built site is over its size budget.

Usage:  python3 scripts/check_budget.py [dist]

The design's budget is the script: under 40 KB compressed. The stylesheet
and each page have budgets too, because the Largest Contentful Paint target
(1.5 s on fast 3G) leaves room for little more than one page and one
stylesheet. Sizes are gzip at level 9, the smallest gzip makes, so they are
a lower bound on what GitHub Pages sends: its own compression may be lighter.
A budgeted file that is missing, or a site with no pages, fails too.
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
    failed = False
    for rel, budget in BUDGETS.items():
        if not (dist / rel).is_file():
            print(f"missing: {rel}", file=sys.stderr)
            failed = True
            continue
        size = compressed(dist / rel)
        print(f"{rel}: {size} bytes compressed (budget {budget})")
        if size > budget:
            over.append(rel)
    pages = sorted(dist.rglob("*.html"))
    if not pages:
        print(f"no pages: {dist} has no .html file", file=sys.stderr)
        failed = True
    for page in pages:
        size = compressed(page)
        if size > PAGE_BUDGET:
            print(f"{page.relative_to(dist)}: {size} bytes compressed (budget {PAGE_BUDGET})")
            over.append(str(page.relative_to(dist)))
    if over:
        print(f"over budget: {', '.join(over)}", file=sys.stderr)
    if over or failed:
        return 1
    print("every file is within its budget")
    return 0


if __name__ == "__main__":
    sys.exit(main())
