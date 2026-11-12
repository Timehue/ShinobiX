import base64
from hashlib import sha256
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dispatch_read import advance
from test_dispatch_stage import Ledger


class PortraitReadTest(unittest.TestCase):
    def setUp(self):
        self.source = b"private account portrait"
        self.digest = sha256(self.source).hexdigest()
        self.job = dict(operation="a2f0df43-9f2c-4a9f-9a43-0b31d078c2be", sourceSha256=self.digest,
                        portrait=base64.b64encode(self.source).decode(), frameHash="c"*64)
        self.ledger, self.worker, self.lookup = Ledger(), Mock(), Mock()
        self.worker.spawn.return_value.object_id = "fc-local"

    def tick(self):
        return advance(self.job, self.ledger, self.worker, self.lookup, (RuntimeError,))

    def test_restore_pending_then_return_sealed_files(self):
        self.lookup.return_value.get.side_effect = TimeoutError()
        self.assertEqual(self.tick(), {"status": "pending"})
        self.assertEqual(self.tick(), {"status": "pending"})
        self.lookup.return_value.get.side_effect = None
        sheet, descriptor = b"sheet", json.dumps({"fit": {"sourceSha256": self.digest}}).encode()
        self.lookup.return_value.get.return_value = dict(pipelineVersion="d"*64, sheet=sheet, descriptor=descriptor,
            paintedCostumes=True, paintedTemplate="masked-collar-template.json",
            receipt=dict(sourceSha256=self.digest, declined=None, fittedMasterSha256=sha256(descriptor).hexdigest(),
                         sheetSha256=sha256(sheet).hexdigest()))
        answer = self.tick()
        self.assertEqual(answer["status"], "accepted")
        self.assertEqual(answer["paintedTemplate"], "masked-collar-template.json")
        self.assertEqual(base64.b64decode(answer["sheet"]), sheet)
        self.worker.spawn.assert_called_once_with(self.source, self.digest, "c"*64, self.job["operation"])
        self.lookup.return_value.get.return_value["sheet"] = b"wrong sheet"
        with self.assertRaisesRegex(ValueError, "unexpected-read-art"):
            self.tick()

    def test_ambiguous_submission_does_not_spawn_twice(self):
        self.worker.spawn.side_effect = ConnectionError()
        with self.assertRaises(ConnectionError):
            self.tick()
        self.assertEqual(self.tick(), {"status":"pending"})
        self.worker.spawn.assert_called_once()

    def test_rejoins_running_reader_when_its_spawn_reply_is_lost(self):
        import modal
        with patch.object(modal, "is_local", return_value=False), patch.dict("os.environ", SPRITE_PAINTED_COSTUMES="1"):
            import modal_sprite_worker as service
        key = f"portrait/{self.job['operation']}/{self.digest}/{self.job['frameHash']}"
        call = "fc-readStarted"
        with TemporaryDirectory() as scratch:
            root = Path(scratch)
            (root / "entry.txt").write_text(str(root / "entry.py"))
            (root / "sprite-worker-release.json").write_text(json.dumps({"intake": "d"*64}))
            def read(*args, **kwargs):
                self.assertEqual(self.ledger[key + "/started"], call)
                return {"receipt":{"sourceSha256":self.digest, "declined":"uncertain"}}
            def lose_reply(*args):
                self.lookup.return_value.get.return_value = service.read_portrait.local(*args)
                raise ConnectionError("submit response lost")
            self.worker.spawn.side_effect = lose_reply
            with (patch.object(service, "INSTALL", root), patch.object(service, "read_private_upload", side_effect=read) as reader,
                  patch.object(modal.Dict, "from_name", return_value=self.ledger),
                  patch.object(modal, "current_function_call_id", return_value=call)):
                with self.assertRaises(ConnectionError):
                    self.tick()
                self.assertEqual(self.ledger[key], "submitting")
                with patch.object(modal, "current_function_call_id", return_value="fc-other"):
                    with self.assertRaisesRegex(ValueError, "already-started"):
                        service.read_portrait.local(self.source, self.digest, self.job["frameHash"], self.job["operation"])
                with self.assertRaisesRegex(ValueError, "unreserved"):
                    service.read_portrait.local(self.source, self.digest, "b"*64, self.job["operation"])
                self.assertEqual(self.tick(), {"status":"declined"})
                self.assertEqual(self.ledger[key], call)
                self.lookup.assert_called_once_with(call)
                self.worker.spawn.assert_called_once()
                reader.assert_called_once()

    def test_refusal_or_failure_returns_no_art(self):
        self.lookup.return_value.get.return_value = {"receipt":{"sourceSha256":self.digest, "declined":"uncertain"}}
        self.assertEqual(self.tick(), {"status":"declined"})
        self.lookup.return_value.get.side_effect = RuntimeError()
        self.assertEqual(self.tick(), {"status":"failed"})

    def test_wrong_upload_cannot_spawn(self):
        self.job["portrait"] = base64.b64encode(b"another avatar").decode()
        with self.assertRaisesRegex(ValueError, "invalid-portrait"):
            self.tick()
        self.worker.spawn.assert_not_called()
