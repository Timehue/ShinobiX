"""A failed worker step says why, and every worker function can import the worker's own modules on Modal."""
import ast
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))
import modal  # noqa: E402


def service():
    with patch.dict("os.environ", SPRITE_PAINTED_COSTUMES="1"), patch.object(modal, "is_local", return_value=False):
        import modal_sprite_worker
    return modal_sprite_worker


class StepErrorTest(unittest.TestCase):
    """Three failed jobs (2026-11-17 to 11-21) could only be read as "returned non-zero exit status 1"."""

    def test_a_failed_step_carries_the_end_of_its_stderr(self):
        script = "import sys\nfor n in range(40): print('line', n, file=sys.stderr)\nsys.exit(3)"
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            service().run_step([sys.executable, "-c", script], stdout=subprocess.DEVNULL)
        error = caught.exception
        self.assertEqual(error.returncode, 3)
        message = str(error)
        self.assertIn("exited 3", message)
        self.assertIn("line 39", message)
        self.assertNotIn("line 14\n", message + "\n", "only the last lines are kept")

    def test_a_passing_step_returns_its_output(self):
        result = service().run_step([sys.executable, "-c", "print('{\"ok\": 1}')"], stdout=subprocess.PIPE)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), '{"ok": 1}')

    def test_an_unchecked_step_reports_its_code(self):
        result = service().run_step([sys.executable, "-c", "raise SystemExit(78)"], check=False)
        self.assertEqual(result.returncode, 78)


class HealthCheckTest(unittest.TestCase):
    """The deploy's per-image health checks name every failing part instead of stopping at the first."""

    def test_health_reports_each_failure_and_passes_only_when_all_pass(self):
        worker = service()
        def broken():
            raise FileNotFoundError("/opt/sprite/blender/blender")
        report = worker.health([("ok", lambda: True), ("missing", lambda: False), ("blender", broken)])
        self.assertFalse(report["ok"])
        self.assertEqual(report["failures"][0], "missing")
        self.assertTrue(report["failures"][1].startswith("blender: FileNotFoundError"))
        self.assertEqual(worker.health([("ok", lambda: None)]), {"ok": True, "failures": []})

    def test_every_health_function_is_one_the_deploy_smoke_calls(self):
        import smoke_read
        worker = service()
        for name in smoke_read.HEALTH:
            self.assertTrue(hasattr(worker, name), name)


class InstallImportTest(unittest.TestCase):
    """The worker's own modules are baked into /opt/sprite, which is not on a Modal function's import path. A
    function that imports one without first putting INSTALL on sys.path works in every local test and fails
    every call on Modal: read_portrait did that and every portrait check died from 2026-11-21 to 11-24."""

    def test_every_function_puts_install_on_the_path_before_importing_a_worker_module(self):
        local = {path.stem for path in WORKER.glob("*.py")}
        tree = ast.parse((WORKER / "modal_sprite_worker.py").read_text(encoding="utf-8"))
        problems = []
        for function in (node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)):
            inserts, imports = [], []
            for node in ast.walk(function):
                if isinstance(node, ast.Call) and ast.unparse(node.func) == "sys.path.insert" \
                        and "INSTALL" in ast.unparse(node):
                    inserts.append(node.lineno)
                names = ([alias.name for alias in node.names] if isinstance(node, ast.Import)
                         else [node.module] if isinstance(node, ast.ImportFrom) and node.module else [])
                imports += [(node.lineno, name) for name in names if name.split(".")[0] in local]
            problems += [f"{function.name} imports {name} at line {line}"
                         for line, name in imports if not any(insert < line for insert in inserts)]
        self.assertEqual(problems, [])


if __name__ == "__main__":
    unittest.main()
