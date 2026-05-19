from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


GTO_DIR = Path(__file__).parent.parent / "gto"
if str(GTO_DIR) not in sys.path:
    sys.path.insert(0, str(GTO_DIR))

import run_solver


class RunSolverExecutableSelectionTests(unittest.TestCase):
    def test_linux_prefers_explicit_linux_solver_binary_when_present(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            solver_dir = Path(tmp_dir) / "solver"
            solver_dir.mkdir()
            linux_solver = solver_dir / "console_solver_linux"
            linux_solver.write_text("", encoding="utf-8")
            generic_solver = solver_dir / "console_solver"
            generic_solver.write_text("", encoding="utf-8")

            self.assertEqual(
                run_solver._resolve_solver_executable(
                    script_dir=Path(tmp_dir),
                    platform="linux",
                ),
                str(linux_solver),
            )

    def test_linux_falls_back_to_generic_solver_binary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            solver_dir = Path(tmp_dir) / "solver"
            solver_dir.mkdir()
            generic_solver = solver_dir / "console_solver"
            generic_solver.write_text("", encoding="utf-8")

            self.assertEqual(
                run_solver._resolve_solver_executable(
                    script_dir=Path(tmp_dir),
                    platform="linux",
                ),
                str(generic_solver),
            )


if __name__ == "__main__":
    unittest.main()
