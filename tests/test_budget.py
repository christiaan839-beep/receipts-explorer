"""scripts/check_budget.py: passes the built site, fails a script over 40 KB compressed."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "check_budget.py"


class BudgetTest(unittest.TestCase):
    def run_on(self, dist: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run([sys.executable, str(SCRIPT), str(dist)], capture_output=True, text=True, check=False)

    def test_the_built_site_is_within_budget(self) -> None:
        subprocess.run([sys.executable, str(ROOT / "build.py")], check=True, capture_output=True)
        result = self.run_on(ROOT / "dist")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_a_script_over_40_kb_compressed_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            shutil.copytree(ROOT / "static", dist / "static")
            (dist / "static" / "check.js").write_bytes(os.urandom(41 * 1024))
            result = self.run_on(dist)
            self.assertEqual(result.returncode, 1)
            self.assertIn("over budget: static/check.js", result.stderr)


if __name__ == "__main__":
    unittest.main()
