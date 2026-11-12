from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch
from zipfile import ZipFile

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recognition_lineup import challenge, png
from recognition_worker import PrivateRecognitionClaims, approved_decoys, execute_review, post_response, private_claims


class Claims(dict):
    def put(self, key, value, *, skip_if_exists=False):
        if skip_if_exists and key in self:
            return False
        self[key] = deepcopy(value)
        return True


class RecognitionExecutionTest(unittest.TestCase):
    def setUp(self):
        portrait = png(Image.new("RGB", (64, 64), "red"))
        rows = [{"assetId":str(i+1)*32, "sourceSha256":sha256(portrait).hexdigest() if i == 0 else str(i)*64,
                 "version":str(i+5)*64, "views":[(Image.new("RGBA", (28, 74), color),(-14,-73))]*8}
                for i, color in enumerate(("red", "green", "blue", "yellow"))]
        self.portrait, self.rows = portrait, rows
        self.op = {**{k:rows[0][k] for k in ("assetId","sourceSha256","version")}, "masterSha256":"a"*64,
                   "model":"local-vision-fixture", "poolSha256":"b"*64, "nonce":"c"*64}
        self.prepared = challenge(rows[0], rows[1:], portrait, nonce=self.op["nonce"])
        self.claims = Claims()
        self.prepare = Mock(return_value=self.prepared)
        self.body = {"status":"completed", "model":self.op["model"], "id":"resp_local",
                     "usage":{"input_tokens":100,"output_tokens":20,"total_tokens":120},
                     "output":[{"type":"message","role":"assistant","status":"completed",
                                "content":[{"type":"output_text","text":json.dumps({"picks":self.prepared["binding"]["truth"],"unreadable":False})}]}]}
        self.send = Mock(side_effect=self.respond)

    def respond(self, payload):
        key = self.op["assetId"]+"/"+self.op["masterSha256"]+"/"+self.op["nonce"]
        record = self.claims.get(key)
        self.assertEqual(record["state"], "submitting")
        self.assertEqual(record["operation"], self.op)
        self.assertEqual(record["request"], payload)
        self.assertEqual(record["prepared"], self.prepared)
        self.assertNotIn("truth", json.dumps(payload))
        return {"status":200,"requestId":"req_local","body":json.dumps(self.body).encode()}

    def run_review(self):
        return execute_review(self.op, self.prepare, self.claims, self.send)

    def test_repeat_execution_reuses_the_same_private_challenge_and_response(self):
        result = self.run_review()
        self.assertTrue(result["passed"])
        self.assertEqual(result["masterSha256"], self.op["masterSha256"])
        self.assertEqual(result, self.run_review())
        self.prepare.assert_called_once()
        self.send.assert_called_once()
        record = next(iter(self.claims.values()))
        self.assertEqual(record["response"]["requestId"], "req_local")
        self.assertEqual(record["receipt"]["usage"], self.body["usage"])

    def test_interrupted_or_ambiguous_http_submission_is_never_reissued(self):
        self.send.side_effect = TimeoutError("accepted request but acknowledgement lost")
        with self.assertRaises(TimeoutError):
            self.run_review()
        with self.assertRaisesRegex(ValueError, "submission-ambiguous"):
            self.run_review()
        self.send.assert_called_once()
        self.assertEqual(next(iter(self.claims.values()))["state"], "submitting")

    def test_restart_after_response_is_saved_finishes_without_another_request(self):
        original = self.claims.put
        def interrupt(key, value, **kwargs):
            result = original(key, value, **kwargs)
            if value.get("state") == "received":
                raise InterruptedError("process lost after durable response")
            return result
        with patch.object(self.claims, "put", side_effect=interrupt):
            with self.assertRaises(InterruptedError):
                self.run_review()
        self.assertTrue(self.run_review()["passed"])
        self.send.assert_called_once()

    def test_clear_mismatch_is_retained_as_failure_and_does_not_get_a_free_retry(self):
        self.body["output"][0]["content"][0]["text"] = json.dumps({"picks":[0]*8,"unreadable":False})
        result = self.run_review()
        self.assertFalse(result["passed"])
        self.assertEqual(result["correct"], 0)
        self.assertEqual(result, self.run_review())
        self.send.assert_called_once()

    def test_refusal_or_malformed_response_is_saved_but_never_authorizes_or_resubmits(self):
        self.body["status"] = "incomplete"
        for _ in range(2):
            with self.assertRaisesRegex(ValueError,"response-incomplete"):
                self.run_review()
        self.send.assert_called_once()
        self.assertIn("response", next(iter(self.claims.values())))

    def test_reusing_operation_with_another_model_does_not_make_a_second_call(self):
        self.run_review()
        self.op = {**self.op,"model":"different-vision-fixture"}
        with self.assertRaisesRegex(ValueError,"conflicting-operation"):
            self.run_review()
        self.send.assert_called_once()

    def test_https_adapter_uses_one_fixed_endpoint_and_bounded_response(self):
        response = Mock(status=200, headers={"x-request-id":"req_local"})
        response.read.return_value = b'{"status":"completed"}'
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        with patch("recognition_worker.urlopen", return_value=response) as opened:
            result = post_response({"model":"local-test"}, "not-a-real-key")
        self.assertEqual(result["requestId"], "req_local")
        opened.assert_called_once()
        request = opened.call_args.args[0]
        self.assertEqual(request.full_url,"https://api.openai.com/v1/responses")
        self.assertEqual(opened.call_args.kwargs,{"timeout":120})
        self.assertEqual(response.read.call_args.args,(128*1024+1,))

    def test_missing_approved_pool_and_changed_pool_fail_before_provider_submission(self):
        with TemporaryDirectory() as directory:
            path = Path(directory)/"pool.zip"
            for entries, error in (([],"approved-decoys-unavailable"),
                                    ([{"assetId":"1"*32,"sourceSha256":"2"*64,"version":"3"*64,
                                       "templates":["male-coat-template.json"],"approved":False,
                                       "ownerApprovedAt":"2026-11-10T00:00:00Z"}],"unapproved-entry")):
                with ZipFile(path,"w") as archive:
                    archive.writestr("pool.json",json.dumps({"version":1,"entries":entries}))
                digest = sha256(path.read_bytes()).hexdigest()
                with self.assertRaisesRegex(ValueError,error):
                    approved_decoys(path,digest,"male-coat-template.json",self.op,"unused-ffmpeg")
                with self.assertRaisesRegex(ValueError,"pool-binding"):
                    approved_decoys(path,"0"*64,"male-coat-template.json",self.op,"unused-ffmpeg")
        self.send.assert_not_called()

    def test_recognition_dependencies_match_the_existing_paint_pins(self):
        root = Path(__file__).resolve().parents[1]
        paint = {line for line in (root/"requirements-linux-paint.txt").read_text().splitlines() if line.startswith(("numpy==","pillow=="))}
        dispatch = {line for line in (root/"requirements-dispatch.txt").read_text().splitlines() if line.startswith("boto3==")}
        self.assertEqual(set((root/"requirements-recognition.txt").read_text().splitlines()), paint | dispatch)

    def test_private_r2_journal_claims_once_and_recovers_bytes_after_a_worker_restart(self):
        from botocore.exceptions import ClientError
        records = {}
        class Bucket:
            def put_object(self, **request):
                self_outer.assertEqual(request["Bucket"],"private-fixture")
                self_outer.assertTrue(request["Key"].startswith(("avatar-model/private/recognition/",
                                                               "avatar-model/private/recognition-billing/")))
                self_outer.assertEqual(request["CacheControl"],"private, no-store")
                if request.get("IfNoneMatch") == "*" and request["Key"] in records:
                    raise ClientError({"Error":{"Code":"PreconditionFailed"}},"PutObject")
                if "IfMatch" in request and request["IfMatch"] != '"'+sha256(records.get(request["Key"],b"")).hexdigest()+'"':
                    raise ClientError({"Error":{"Code":"PreconditionFailed"}},"PutObject")
                records[request["Key"]] = request["Body"]
            def get_object(self, **request):
                if request["Key"] not in records:
                    raise ClientError({"Error":{"Code":"NoSuchKey"}},"GetObject")
                raw = records[request["Key"]]
                return {"Body":BytesIO(raw),"ContentLength":len(raw),"ETag":'"'+sha256(raw).hexdigest()+'"'}
        self_outer = self
        bucket = Bucket()
        self.claims = PrivateRecognitionClaims(bucket,"private-fixture")
        result = self.run_review()
        self.claims = PrivateRecognitionClaims(bucket,"private-fixture")
        self.assertEqual(result,self.run_review())
        self.send.assert_called_once()
        key = self.op["assetId"]+"/"+self.op["masterSha256"]+"/"+self.op["nonce"]
        saved = self.claims.get(key)
        self.assertFalse(self.claims.put(key,saved,skip_if_exists=True))
        self.assertEqual(saved["prepared"]["lineup"],self.prepared["lineup"])
        with self.assertRaisesRegex(ValueError,"journal-key"):
            self.claims.get("../public")

        # An old worker must not restore images after account cleanup redacts them.
        stale = PrivateRecognitionClaims(bucket,"private-fixture")
        stale_record = stale.get(key)
        self.claims.redact(key)
        with self.assertRaisesRegex(ValueError,"journal-changed"):
            stale.put(key,stale_record)
        with self.assertRaisesRegex(ValueError,"recognition-deleted"):
            self.run_review()
        self.send.assert_called_once()
        tombstone = self.claims.get(key)
        self.assertEqual(set(tombstone),{"state","deletedAt"})
        billing = json.loads(self.claims._read(key,billing=True))
        self.assertEqual(billing["responseId"],"resp_local")
        self.assertEqual(billing["usage"],self.body["usage"])
        self.assertFalse({"body","prepared","request","reference","lineup","sourceSha256"} & billing.keys())

        # Race erasure against a real execution's response save, after its one paid request.
        self.op = {**self.op,"nonce":"e"*64}
        self.prepared = challenge(self.rows[0],self.rows[1:],self.portrait,nonce=self.op["nonce"])
        self.prepare = Mock(return_value=self.prepared)
        self.body["output"][0]["content"][0]["text"] = json.dumps({"picks":self.prepared["binding"]["truth"],"unreadable":False})
        key = self.op["assetId"]+"/"+self.op["masterSha256"]+"/"+self.op["nonce"]
        self.claims = PrivateRecognitionClaims(bucket,"private-fixture")
        def erase_before_response_save(payload):
            reply = self.respond(payload)
            PrivateRecognitionClaims(bucket,"private-fixture").redact(key)
            return reply
        self.send = Mock(side_effect=erase_before_response_save)
        with self.assertRaisesRegex(ValueError,"journal-changed"):
            self.run_review()
        with self.assertRaisesRegex(ValueError,"recognition-deleted"):
            self.run_review()
        self.send.assert_called_once()
        self.assertEqual(self.claims.get(key)["state"],"deleted")
        self.assertEqual(json.loads(self.claims._read(key,billing=True))["responseId"],"resp_local")

    def test_private_claim_readback_failure_cannot_reach_the_paid_request(self):
        self.claims = PrivateRecognitionClaims(Mock(),"private-fixture")
        with (patch.object(self.claims,"_read",side_effect=[None,b"damaged readback"]),
              self.assertRaisesRegex(ValueError,"journal-readback")):
            self.run_review()
        self.send.assert_not_called()

    def test_journal_cannot_use_the_public_sprite_bucket(self):
        with (patch.dict("os.environ",AVATAR_MODEL_R2_ACCOUNT_ID="a"*32,
                         AVATAR_MODEL_R2_PRIVATE_BUCKET="same-bucket",AVATAR_MODEL_R2_PUBLIC_BUCKET="same-bucket"),
              patch("boto3.client") as client,self.assertRaisesRegex(ValueError,"private-destination")):
            private_claims()
        client.assert_not_called()

    def test_sdk_accepts_the_atomic_conditional_claim_parameter(self):
        from botocore.session import Session
        members=Session().get_service_model("s3").operation_model("PutObject").input_shape.members
        self.assertIn("IfNoneMatch",members)
        self.assertIn("IfMatch",members)

    def test_approved_pool_selection_verifies_actual_object_graphs_and_filters_templates(self):
        # Synthetic unit-test entries only. This does not approve production artwork.
        from gzip import compress
        from browser_motion import DIRECTIONS
        with TemporaryDirectory() as directory:
            path = Path(directory)/"pool.zip"
            manifest = []
            with ZipFile(path,"w") as archive:
                for i in range(1,5):
                    objects = {}
                    def pack(data, extension):
                        name = sha256(data).hexdigest()+extension
                        objects[name] = data
                        return name
                    page = pack(b"synthetic encoded placeholder", ".264")
                    pose = {"file":"body","count":1,"origins":[[0,0]],"period":1}
                    clips = {key:pose for key in ("idle","walk","run","start-walk","start-run","pivot")}
                    for before, after in (("walk","idle"),("run","idle"),("walk","run"),("run","walk")):
                        clips[before+"-"+after] = {**pose,"source":before,"target":after}
                    bank = pack(compress(json.dumps({"clips":clips,"pages":{"body":{"file":page,"frames":1,"cols":1,"cell":[1,1]}}}).encode()),".gz")
                    source = str(i)*64
                    version = pack(json.dumps({"format":"sector-motion-v2","portraitSha256":source,"mapWidth":1080,
                                               "heightFraction":.068,"directions":DIRECTIONS,
                                               "styles":{style:[bank]*8 for style in "ABC"}}).encode(),".json")[:-5]
                    asset = str(i)*32
                    manifest.append({"assetId":asset,"version":version,"sourceSha256":source,"approved":True,
                                     "ownerApprovedAt":"2026-11-10T00:00:00Z",
                                     "templates":["human-fixture" if i<4 else "different-fixture"]})
                    for name,data in objects.items():
                        archive.writestr(asset+"/"+version+"/"+name,data)
                archive.writestr("pool.json",json.dumps({"version":1,"entries":manifest}))
            digest = sha256(path.read_bytes()).hexdigest()
            views = [(Image.new("RGBA",(28,74),"green"),(-14,-73))]*8
            with patch("recognition_lineup.idle_views",return_value=views) as decoder:
                selected = approved_decoys(path,digest,"human-fixture",self.op,"fake-ffmpeg")
                self.assertEqual(decoder.call_count,3)
                self.assertEqual({e["sourceSha256"] for e in selected},{str(i)*64 for i in range(1,4)})
                self.assertEqual(selected,approved_decoys(path,digest,"human-fixture",self.op,"fake-ffmpeg"))


if __name__ == "__main__":
    unittest.main()
