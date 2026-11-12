import base64
from hashlib import sha256
import json
from pathlib import Path
import sys
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dispatch_stage import advance


class Ledger(dict):
    def put(self, key, value, *, skip_if_exists=False):
        if skip_if_exists and key in self:
            return False
        self[key] = value
        return True


class StageDispatchTest(unittest.TestCase):
    def setUp(self):
        sheet = b"fitted sheet"
        master = json.dumps({"fit": {"sourceSha256": "1"*64, "sheetSha256": sha256(sheet).hexdigest()}}).encode()
        self.request = dict(stage="A", assetId="a"*32, attempt=1, sourceSha256="1"*64,
                            masterSha256=sha256(master).hexdigest(), descriptor=base64.b64encode(master).decode(),
                            sheet=base64.b64encode(sheet).decode())
        self.ledger, self.function, self.lookup = Ledger(), Mock(), Mock()
        self.function.spawn.return_value.object_id = "fc-stageA"

    def tick(self):
        return advance(self.request, self.ledger, self.function, self.lookup)

    def test_restart_recovers_call_after_server_loses_acknowledgement(self):
        self.assertEqual(self.tick(), {"status": "pending", "callId": "fc-stageA"})
        archive = b"verified animation"
        self.lookup.return_value.get.return_value = {"archive":archive, "receipt":{
            "master":self.request["masterSha256"], "portrait":self.request["sourceSha256"],
            "style":"A", "archive":sha256(archive).hexdigest(), "movement":"2"*64}}
        self.assertEqual(self.tick(), {"status":"complete", "callId":"fc-stageA", "movement":"2"*64})
        self.function.spawn.assert_called_once()

    def test_ambiguous_spawn_is_never_resubmitted_without_provider_evidence(self):
        self.function.spawn.side_effect = TimeoutError("lost response")
        with self.assertRaises(TimeoutError):
            self.tick()
        self.assertEqual(self.tick(), {"status":"unknown"})
        self.function.spawn.assert_called_once()

    def test_different_sheet_cannot_reserve_or_submit_work(self):
        self.request["sheet"] = base64.b64encode(b"different art").decode()
        with self.assertRaisesRegex(ValueError, "invalid-sheet"):
            self.tick()
        self.assertFalse(self.ledger)
        self.function.spawn.assert_not_called()

    def test_live_render_and_assembly_acknowledge_before_work_if_spawn_reply_is_lost(self):
        import modal
        with patch.dict("os.environ", SPRITE_PAINTED_COSTUMES="1"), patch.object(modal, "is_local", return_value=False):
            import modal_sprite_worker as service
        self.request["completed"] = {s: "fc-source" + s for s in "ABC"}
        master = self.request["masterSha256"]
        self.request["movement"] = "9" * 64

        def lookup(call_id):
            handle = Mock()
            if call_id in self.request["completed"].values():
                handle.get.return_value = {"archive":b"staged", "receipt": {"style":call_id[-1], "master":master, "movement":"9"*64,
                                                       "portrait":self.request["sourceSha256"]}}
            else:
                handle.get.side_effect = TimeoutError()
            return handle

        self.lookup.side_effect = lookup
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "entry.txt").write_text(str(root / "entry.py"))
            for stage in ("A", "B", "C", "finish"):
                self.request.update(stage=stage, attempt=2)
                call_id = "fc-live" + stage
                key = f"{self.request['assetId']}/{master}/{stage}/2"
                worker = service.finish_styles if stage == "finish" else service.render_style

                def check_before_render(*args, **kwargs):
                    self.assertEqual(self.ledger[key + "/started"], call_id)
                    raise InterruptedError("stop local rehearsal after worker acknowledgement")

                def lose_reply(*args):
                    with self.assertRaises(InterruptedError):
                        worker.local(*args)
                    raise TimeoutError("provider accepted operation but submitter lost reply")

                self.function.spawn.reset_mock()
                self.function.spawn.side_effect = lose_reply
                with (self.subTest(stage=stage), patch.object(service, "INSTALL", root),
                      patch.object(modal.Dict, "from_name", return_value=self.ledger),
                      patch.object(modal.FunctionCall, "from_id", side_effect=lookup),
                      patch.object(modal, "current_function_call_id", return_value=call_id),
                      patch.object(service.subprocess, "run", side_effect=check_before_render),
                      patch.object(service, "deliver", side_effect=check_before_render)):
                    with self.assertRaises(TimeoutError):
                        self.tick()
                    self.assertEqual(self.ledger[key], "submitting")
                    with patch.object(modal, "current_function_call_id", return_value="fc-other"):
                        with self.assertRaisesRegex(ValueError, "already-started"):
                            service.acknowledge_movement(self.request["assetId"], master, stage, 2)
                    self.assertEqual(self.tick(), {"status":"pending", "callId":call_id})
                    self.function.spawn.assert_called_once()
                    self.assertEqual(self.ledger[key], call_id)

    def test_assembly_recovers_only_the_expired_style_for_this_fitting(self):
        import modal
        from modal.exception import OutputExpiredError
        with patch.dict("os.environ", SPRITE_PAINTED_COSTUMES="1"), patch.object(modal, "is_local", return_value=False):
            import modal_sprite_worker as service
        self.request.update(stage="finish", completed={s:"fc-input"+s for s in "ABC"},
                            callId="fc-assembly", movement="9"*64)
        master = self.request["masterSha256"]
        receipt = dict(style="A", master=master, movement="9"*64, portrait=self.request["sourceSha256"])
        args = (self.request["assetId"], base64.b64decode(self.request["descriptor"]), master,
                self.request["completed"], 1, "9"*64)
        input_call = Mock()
        input_call.get.side_effect = [{"receipt":receipt,"archive":b"staged"}, OutputExpiredError("expired")]
        with (patch.object(service, "acknowledge_movement"), patch.object(service, "deliver") as deliver,
              patch.object(modal.FunctionCall, "from_id", return_value=input_call) as lookup):
            result = service.finish_styles.local(*args)
            self.assertEqual([c.args for c in lookup.call_args_list], [("fc-inputA",),("fc-inputB",)])
            self.lookup.return_value.get.return_value = result
            self.assertEqual(self.tick(), {"status":"lost-style","callId":"fc-assembly","lostStyle":"fc-inputB"})
            result["master"] = "0"*64
            with self.assertRaisesRegex(ValueError, "invalid-lost-style-binding"):
                self.tick()
            input_call.get.side_effect = [{"receipt":{**receipt,"portrait":"0"*64},"archive":b"staged"}]
            with self.assertRaisesRegex(ValueError, "invalid-style-binding"):
                service.finish_styles.local(*args)
            deliver.assert_not_called()

    def test_paint_claim_recovers_the_same_costume_and_rejects_other_jobs(self):
        raw, sheet = b"account portrait", b"painted costume"
        source = sha256(raw).hexdigest()
        before = json.dumps({"fit":{"sourceSha256":source}}).encode()
        after = b"sealed painted fit"
        master = sha256(before).hexdigest()
        self.request.update(stage="paint", descriptor=base64.b64encode(before).decode(), masterSha256=master,
                            sourceSha256=source, portrait=base64.b64encode(raw).decode())
        self.function.spawn.return_value.object_id = "fc-paint"
        self.assertEqual(self.tick(), {"status":"pending","callId":"fc-paint"})
        asset = self.request["assetId"]
        self.function.spawn.assert_called_once_with(asset, before, master, raw, source)
        del self.request["portrait"], self.request["descriptor"]
        result = dict(assetId=asset, screened=master, descriptor=after, sheet=sheet, receipt=dict(
            style="painted-kit",declined=None,sourceSha256=source,fittedMasterSha256=sha256(after).hexdigest(),
            sheetSha256=sha256(sheet).hexdigest()))
        self.lookup.return_value.get.return_value = result
        reply = self.tick()
        self.assertEqual(base64.b64decode(reply["sheet"]), sheet)
        self.assertEqual(base64.b64decode(reply["descriptor"]), after)
        result["assetId"] = "f"*32
        self.assertEqual(self.tick(), {"status":"invalid-art","callId":"fc-paint"})
        result["assetId"] = asset
        result["sheet"] = b"corrupted"
        self.assertEqual(self.tick(), {"status":"invalid-art","callId":"fc-paint"})
        self.request["attempt"] = 2
        with self.assertRaisesRegex(ValueError,"invalid-attempt"):
            self.tick()
        self.function.spawn.assert_called_once()

    def test_lost_paint_submission_rejoins_only_the_matching_worker_claim(self):
        raw = b"fresh player portrait"
        source = sha256(raw).hexdigest()
        before = json.dumps({"fit":{"sourceSha256":source}}).encode()
        master = sha256(before).hexdigest()
        self.request.update(stage="paint", descriptor=base64.b64encode(before).decode(), masterSha256=master,
                            sourceSha256=source, portrait=base64.b64encode(raw).decode())
        self.function.spawn.side_effect = TimeoutError("submission acknowledgement lost")
        with self.assertRaises(TimeoutError):
            self.tick()
        claim = {"master":master, "portrait":"other", "callId":"fc-paint"}
        def recover():
            return advance(self.request, self.ledger, self.function, self.lookup, paint_claim=lambda _: claim)
        self.assertEqual(recover(), {"status":"unknown"})
        self.lookup.assert_not_called()
        claim["portrait"] = source
        self.lookup.return_value.get.side_effect = TimeoutError()
        self.assertEqual(recover(), {"status":"pending", "callId":"fc-paint"})
        claim.clear()
        self.assertEqual(self.tick(), {"status":"pending", "callId":"fc-paint"})
        self.function.spawn.assert_called_once()
