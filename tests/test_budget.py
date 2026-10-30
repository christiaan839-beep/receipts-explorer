"""scripts/check_budget.py: passes the built site, and fails a file over its budget, a missing file or a site with no pages."""

from __future__ import annotations

import gzip
import importlib.util
import random
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "check_budget.py"
KB = 1024


def load_budget() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_budget", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def gz(data: bytes) -> int:
    return len(gzip.compress(data, compresslevel=9, mtime=0))


def compressing_to(size: int) -> bytes:
    """Random bytes whose gzip at level 9 is exactly `size` bytes."""
    rng = random.Random(size)
    n = size
    for _ in range(64):
        data = rng.randbytes(n)
        diff = size - gz(data)
        if diff == 0:
            return data
        n += diff
    raise AssertionError(f"no random data compresses to {size} bytes")


class BudgetTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dist = Path(tmp.name) / "dist"
        shutil.copytree(ROOT / "static", self.dist / "static")
        (self.dist / "static" / "check.js").write_bytes(b"export {};\n")
        (self.dist / "index.html").write_bytes(b"<!doctype html><title>t</title>\n")

    def run_on(self, dist: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run([sys.executable, str(SCRIPT), str(dist)], capture_output=True, text=True, check=False)

    def test_the_budgets_are_the_design_s(self) -> None:
        budget = load_budget()
        self.assertEqual(budget.BUDGETS, {"static/check.js": 40 * KB, "static/styles.css": 8 * KB})
        self.assertEqual(budget.PAGE_BUDGET, 12 * KB)

    def test_the_built_site_is_within_budget(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp) / "dist"
            subprocess.run([sys.executable, str(ROOT / "build.py"), "--out", str(dist)], check=True, capture_output=True)
            result = self.run_on(dist)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("every file is within its budget", result.stdout)
        self.assertRegex(result.stdout, r"static/check\.js: \d+ bytes compressed \(budget 40960\)")
        self.assertRegex(result.stdout, r"static/styles\.css: \d+ bytes compressed \(budget 8192\)")

    def test_a_small_site_is_within_budget(self) -> None:
        result = self.run_on(self.dist)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")

    def test_sizes_are_gzip_at_level_9(self) -> None:
        data = b"".join(f"export const a{i} = {i * i};\n".encode("ascii") for i in range(2000))
        self.assertNotEqual(gz(data), len(gzip.compress(data, compresslevel=1, mtime=0)))
        (self.dist / "static" / "check.js").write_bytes(data)
        result = self.run_on(self.dist)
        self.assertIn(f"static/check.js: {gz(data)} bytes compressed (budget 40960)", result.stdout)

    def test_a_script_at_its_budget_passes_and_one_byte_over_fails(self) -> None:
        data = compressing_to(40 * KB)
        script = self.dist / "static" / "check.js"
        script.write_bytes(data)
        result = self.run_on(self.dist)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("static/check.js: 40960 bytes compressed (budget 40960)", result.stdout)
        over = data + b"\x00"
        self.assertEqual(gz(over), 40 * KB + 1)
        script.write_bytes(over)
        result = self.run_on(self.dist)
        self.assertEqual(result.returncode, 1)
        self.assertIn("over budget: static/check.js", result.stderr)

    def test_a_stylesheet_over_8_kb_compressed_fails(self) -> None:
        (self.dist / "static" / "styles.css").write_bytes(compressing_to(8 * KB + 1))
        result = self.run_on(self.dist)
        self.assertEqual(result.returncode, 1)
        self.assertIn("over budget: static/styles.css", result.stderr)

    def test_a_page_at_its_budget_passes_and_one_byte_over_fails(self) -> None:
        page = self.dist / "terms" / "receipt" / "index.html"
        page.parent.mkdir(parents=True)
        data = compressing_to(12 * KB)
        page.write_bytes(data)
        result = self.run_on(self.dist)
        self.assertEqual(result.returncode, 0, result.stderr)
        page.write_bytes(data + b"\x00")
        result = self.run_on(self.dist)
        self.assertEqual(result.returncode, 1)
        self.assertIn("terms/receipt/index.html: 12289 bytes compressed (budget 12288)", result.stdout)
        self.assertIn("over budget: terms/receipt/index.html", result.stderr)

    def test_a_missing_stylesheet_fails_and_says_so(self) -> None:
        (self.dist / "static" / "styles.css").unlink()
        result = self.run_on(self.dist)
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing: static/styles.css", result.stderr)

    def test_a_missing_script_fails_and_says_so(self) -> None:
        (self.dist / "static" / "check.js").unlink()
        result = self.run_on(self.dist)
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing: static/check.js", result.stderr)

    def test_a_site_with_no_pages_fails(self) -> None:
        (self.dist / "index.html").unlink()
        result = self.run_on(self.dist)
        self.assertEqual(result.returncode, 1)
        self.assertIn("no pages", result.stderr)


if __name__ == "__main__":
    unittest.main()
