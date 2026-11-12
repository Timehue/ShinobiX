"""Exercise the deployed function body locally with interrupted provider execution."""
from contextlib import ExitStack
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import modal


class PaintExecutionTest(unittest.TestCase):
    def test_duplicate_execution_cannot_issue_another_edit_after_a_billed_interruption(self):
        with patch.dict("os.environ", SPRITE_PAINTED_COSTUMES="1"), patch.object(modal, "is_local", return_value=False):
            import modal_sprite_worker as service

        portrait = b"private portrait"
        source = sha256(portrait).hexdigest()
        metadata = json.dumps({"version":1, "templateSha256":"a"*64, "fit":{
            "sourceSha256":source, "template":"male-coat-template.json", "declined":None}}).encode()
        master = sha256(metadata).hexdigest()
        asset = "1"*32
        receipt = {"operation":"costume-1", "requestId":"local-rehearsal", "model":"test",
                   "size":"1536x960", "quality":"high", "usage":{"total_tokens":100}}
        records = {}

        class Claims:
            def put(self, key, value, *, skip_if_exists=False):
                if skip_if_exists and key in records:
                    return False
                records[key] = dict(value)
                return True

        def interrupt(command, *, check):
            self.assertTrue(check)
            self.assertEqual(records[asset], {"master":master, "portrait":source, "callId":"fc-first"})
            work = Path(command[3])
            self.assertEqual((work/"portrait").read_bytes(), portrait)
            self.assertEqual((work/"screened.json").read_bytes(), metadata)
            journal = work/"edits/edit-1/provider.json"
            journal.parent.mkdir(parents=True)
            journal.write_text(json.dumps(receipt))
            raise subprocess.CalledProcessError(1, "local paint process interrupted after edit")

        with TemporaryDirectory() as temp, ExitStack() as stack:
            installation = Path(temp)
            (installation/"entry.txt").write_text(str(installation/"entry.py"))
            stack.enter_context(patch.object(service, "INSTALL", installation))
            stack.enter_context(patch.object(modal.Dict, "from_name", return_value=Claims()))
            stack.enter_context(patch.object(modal, "current_function_call_id", side_effect=["fc-first","fc-second"]))
            painter = stack.enter_context(patch.object(subprocess, "run", side_effect=interrupt))
            with self.assertRaises(subprocess.CalledProcessError):
                service.paint_costume.local(asset, metadata, master, portrait, source)
            with self.assertRaisesRegex(ValueError, "already-claimed"):
                service.paint_costume.local(asset, metadata, master, portrait, source)
            painter.assert_called_once()
        self.assertEqual(records[asset], {"master":master,"portrait":source,"callId":"fc-first","edits":[receipt]})
