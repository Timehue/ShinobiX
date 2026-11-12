from hashlib import sha256
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from paint_sprite_style import MovementRevisionMismatch, paint


class StyleRevisionTest(unittest.TestCase):
    def test_resume_checks_revision_before_starting_work(self):
        revision = sha256(b"installed movement").hexdigest()
        render = Mock()
        render.read_fitted_master.return_value = ({"sourceSha256": "a"*64}, "sheet", "template")
        render.bake_style.return_value = {"releases": {"archiveSha256": "b"*64}}
        modules = {"make_masked_avatar": render, "shared_walk_batches": Mock(),
                   "package_motion_worker": Mock(movement_revision=Mock(return_value=revision))}
        with TemporaryDirectory() as temp, patch.dict(sys.modules, modules), patch.object(sys, "path", list(sys.path)):
            work = Path(temp)
            entry = work/"entry.py"
            entry.touch()
            args = (entry, work/"master", "c"*64, "C", work/"blender", work)
            with self.assertRaises(MovementRevisionMismatch):
                paint(*args, expected_movement="d"*64)
            render.bake_style.assert_not_called()
            modules["shared_walk_batches"].use_for_job.assert_not_called()
            self.assertFalse((work/"style.json").exists())
            for expected in (None, revision):
                with self.subTest(expected=expected):
                    paint(*args, expected_movement=expected)
                    self.assertEqual(json.loads((work/"style.json").read_bytes())["movement"], revision)
            self.assertEqual(render.bake_style.call_count, 2)
