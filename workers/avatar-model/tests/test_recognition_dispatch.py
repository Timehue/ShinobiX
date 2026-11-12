"""Exercise the real dispatch protocol and deployed function body without remote calls."""
import base64
from hashlib import sha256
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dispatch_stage import advance


class Ledger(dict):
    def put(self, key, value, *, skip_if_exists=False):
        if skip_if_exists and key in self:
            return False
        self[key] = value
        return True


class RecognitionDispatchTest(unittest.TestCase):
    def setUp(self):
        portrait = b"private source portrait"
        source = sha256(portrait).hexdigest()
        descriptor = json.dumps({"fit":{"sourceSha256":source,"template":"male-coat-template.json"}}).encode()
        self.request = dict(stage="recognize",assetId="a"*32,masterSha256=sha256(descriptor).hexdigest(),
                            sourceSha256=source,attempt=2,portrait=base64.b64encode(portrait).decode(),
                            descriptor=base64.b64encode(descriptor).decode(),finishedCall="fc-finished",
                            model={"assetId":"a"*32,"version":"b"*64,"objects":133,"bytes":2000000},
                            recognition={"model":"local-vision-fixture","poolSha256":"c"*64,"nonce":"d"*64})
        self.ledger = Ledger()
        self.function = Mock()
        self.function.spawn.return_value.object_id = "fc-review"
        self.lookup = Mock()

    def test_stage_binds_the_finished_call_portrait_and_review_operation(self):
        reply = advance(self.request,self.ledger,self.function,self.lookup)
        self.assertEqual(reply,{"status":"pending","callId":"fc-review"})
        args = self.function.spawn.call_args.args
        self.assertEqual(args[0],self.request["assetId"])
        self.assertEqual(sha256(args[1]).hexdigest(),self.request["masterSha256"])
        self.assertEqual(sha256(args[3]).hexdigest(),self.request["sourceSha256"])
        self.assertEqual(args[5:],("fc-finished",self.request["model"],self.request["recognition"],2))
        receipt = {"localFixture":True}
        self.lookup.return_value.get.return_value = receipt
        self.assertEqual(advance(self.request,self.ledger,self.function,self.lookup),
                         {"status":"complete","callId":"fc-review","recognitionReceipt":receipt})
        self.function.spawn.assert_called_once()

    def test_mismatched_source_never_claims_or_submits(self):
        self.request["portrait"] = base64.b64encode(b"wrong source").decode()
        with self.assertRaisesRegex(ValueError,"invalid-paint-portrait"):
            advance(self.request,self.ledger,self.function,self.lookup)
        self.assertFalse(self.ledger)
        self.function.spawn.assert_not_called()

    def test_worker_acknowledges_before_review_and_lost_spawn_rejoins_same_call(self):
        import modal
        with patch.dict("os.environ",SPRITE_PAINTED_COSTUMES="1"), patch.object(modal,"is_local",return_value=False):
            import modal_sprite_worker as service
        key = f"{self.request['assetId']}/{self.request['masterSha256']}/recognize/2"
        def interrupted_review(op, prepare, claims, send):
            self.assertEqual(self.ledger[key+"/started"],"fc-review")
            self.assertEqual(op["nonce"],self.request["recognition"]["nonce"])
            raise InterruptedError("interrupt after durable worker acknowledgement")
        def lose_ack(*args):
            with self.assertRaises(InterruptedError):
                service.recognize_sprite.local(*args)
            raise TimeoutError("spawn acknowledgement lost")
        self.function.spawn.side_effect = lose_ack
        env = {"SPRITE_RECOGNITION_POOL_SHA256":"c"*64,"SPRITE_RECOGNITION_MODEL":"local-vision-fixture"}
        with (patch.dict("os.environ",env),patch.object(modal.Dict,"from_name",return_value=self.ledger),
              patch.object(modal,"current_function_call_id",return_value="fc-review"),
              patch("recognition_worker.private_claims",return_value=Ledger()),
              patch("recognition_worker.execute_review",side_effect=interrupted_review),
              patch("recognition_worker.post_response") as provider):
            with self.assertRaises(TimeoutError):
                advance(self.request,self.ledger,self.function,self.lookup)
            self.lookup.return_value.get.side_effect = TimeoutError()
            reply = advance(self.request,self.ledger,self.function,self.lookup)
        self.assertEqual(reply,{"status":"pending","callId":"fc-review"})
        self.function.spawn.assert_called_once()
        provider.assert_not_called()


if __name__ == "__main__":
    unittest.main()
