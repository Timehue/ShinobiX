import base64
from hashlib import sha256
from importlib.util import find_spec
from pathlib import Path
from runpy import run_path
from subprocess import CalledProcessError, TimeoutExpired
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dispatch_read import advance as check_read
from dispatch_result import terminal_result_errors
from dispatch_stage import advance as check_stage, publish


@unittest.skipUnless(find_spec("modal"), "Requires the game-side dispatcher SDK")
class FinishedCallTest(unittest.TestCase):
    def test_background_art_functions_allow_outbound_blob_transport(self):
        import modal

        options = {}

        def register(**settings):
            def decorator(function):
                options[function.__name__] = settings
                return function
            return decorator

        with (patch.object(modal, "is_local", return_value=False),
              patch.object(modal, "App", return_value=Mock(function=register))):
            run_path(str(Path(__file__).resolve().parents[1] / "modal_sprite_worker.py"))

        for name in ("read_portrait", "render_style", "finish_sprite", "finish_styles"):
            with self.subTest(function=name):
                self.assertFalse(options[name].get("block_network", False))
                self.assertFalse(options[name].get("secrets"))

    def test_publication_recovers_from_storage_and_only_settles_a_confirmed_worker_failure(self):
        from modal.exception import ConnectionError as ModalConnectionError, InternalFailure
        asset = "a" * 32
        model = {"assetId": asset, "version": "1" * 64, "objects": 317, "bytes": 512}
        request = dict(assetId=asset, model=model, sourceSha256="b" * 64, callId="fc-finish")
        from botocore.exceptions import ClientError
        client=Mock()
        client.get_object.side_effect=ClientError({'Error':{'Code':'NoSuchKey'}},'GetObject')
        lookup, destination = Mock(), lambda: (client, "bucket")
        with patch("publish_sprite.verify_published_result", return_value=model) as verify:
            self.assertEqual(publish(request, lookup, destination)["model"], model)
            lookup.assert_not_called()
            verify.side_effect = ValueError("missing pages")
            lookup.return_value.get.side_effect = InternalFailure("worker terminated")
            self.assertEqual(publish(request, lookup, destination), {"status": "failed", "callId": "fc-finish"})
            lookup.side_effect = ModalConnectionError("transport interrupted")
            with self.assertRaises(ModalConnectionError):
                publish(request, lookup, destination)
            verify.side_effect = OSError("storage offline")
            with self.assertRaises(OSError):
                publish(request, lookup, destination)

    def test_both_dispatchers_distinguish_finished_worker_failures_from_a_poll_timeout(self):
        from modal.exception import ConnectionError as ModalConnectionError, FunctionTimeoutError, InternalFailure

        source = sha256(b"portrait").hexdigest()
        operation = "a2f0df43-9f2c-4a9f-9a43-0b31d078c2be"
        read = dict(operation=operation, sourceSha256=source, frameHash="a"*64,
                    portrait=base64.b64encode(b"portrait").decode())
        stage = dict(stage="A", assetId="1"*32, masterSha256="2"*64, attempt=1,
                     sourceSha256=source, callId="fc-known")
        ledger = {f"portrait/{operation}/{source}/{'a'*64}": "fc-known"}
        worker, lookup = Mock(), Mock()
        for advance, request in ((check_read, read), (check_stage, stage)):
            for error, status in ((TimeoutError(), "pending"), (CalledProcessError(1, "reader"), "failed"),
                                  (TimeoutExpired("reader", 30), "failed"), (FunctionTimeoutError(), "failed"),
                                  (InternalFailure("worker terminated"), "failed")):
                with self.subTest(stage=advance.__module__, error=type(error)):
                    lookup.return_value.get.side_effect = error
                    reply = advance(request, ledger, worker, lookup, terminal_result_errors())
                    self.assertEqual(reply["status"], status)
            lookup.return_value.get.side_effect = ModalConnectionError("transport interrupted")
            with self.assertRaises(ModalConnectionError):
                advance(request, ledger, worker, lookup, terminal_result_errors())
        worker.spawn.assert_not_called()
