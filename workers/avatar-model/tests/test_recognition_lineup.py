from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sys
import unittest

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recognition_lineup import challenge, completed_response, judge, png, registered_crop, response_request


class RecognitionLineupTest(unittest.TestCase):
    def setUp(self):
        self.portrait = png(Image.new("RGB", (128, 128), "#aaccff"))
        self.rows = []
        for index, color in enumerate(("red", "green", "blue", "yellow")):
            self.rows.append({"sourceSha256": sha256(self.portrait).hexdigest() if index == 0 else str(index) * 64,
                              "assetId": str(index + 1) * 32, "version": str(index + 5) * 64,
                              "views": [(Image.new("RGBA", (28, 74), color), (-14, -73)) for _ in range(8)]})
        self.prepared = self.build()

    def build(self, nonce="f" * 64):
        return challenge(self.rows[0], self.rows[1:], self.portrait, nonce=nonce)

    def test_same_binding_is_repeatable_and_game_scale_is_preserved(self):
        self.assertEqual(self.prepared, self.build())
        with Image.open(BytesIO(self.prepared["lineup"])) as image:
            self.assertEqual(image.size, (520, 920))
            # The reference is never pasted into a candidate cell or enlarged.
            truth = self.prepared["binding"]["truth"]
            layout = self.prepared["binding"]["layout"]
            for row, column in enumerate(truth):
                x = round(40 + layout["cellWidth"] * (column - .5))
                y = layout["firstGround"] + layout["rowHeight"] * row
                self.assertEqual(image.getpixel((x, y - 32)), (255, 0, 0))
                self.assertEqual(image.getpixel((x, y - 75)), (214, 212, 207))
        self.assertGreater(len(set(self.prepared["binding"]["truth"])), 1)
        self.assertNotEqual(self.prepared["sha256"], self.build("e" * 64)["sha256"])

    def test_transparent_atlas_padding_does_not_change_size_or_ground_registration(self):
        atlas = Image.new("RGBA", (192, 192))
        atlas.paste((200, 100, 50, 255), (65, 75, 130, 145))
        cropped, origin = registered_crop(atlas, (-96, -144))
        self.assertEqual(cropped.size, (65, 70))
        self.assertEqual(origin, (-31, -69))
        self.assertEqual(cropped.getpixel((0, 0)), atlas.getpixel((65, 75)))
        self.assertEqual((origin[0] + 20, origin[1] + 30), (-96 + 65 + 20, -144 + 75 + 30))
        with self.assertRaisesRegex(ValueError, "empty-sprite"):
            registered_crop(Image.new("RGBA", (192, 192)), (-96, -144))

    def test_model_sees_images_and_picks_schema_but_never_the_answer_key_or_bindings(self):
        request = response_request(self.prepared, "local-review-fixture")
        self.assertFalse(request["store"])
        self.assertTrue(request["text"]["format"]["strict"])
        serialized = json.dumps(request)
        for private in (self.prepared["sha256"], self.rows[0]["sourceSha256"], "truth", "target"):
            self.assertNotIn('"' + private + '"', serialized)
        images = [part for part in request["input"][0]["content"] if part["type"] == "input_image"]
        self.assertEqual(len(images), 2)
        self.assertTrue(all(part["detail"] == "high" for part in images))
        with self.assertRaisesRegex(ValueError, "model-required"):
            response_request(self.prepared, "")

    def test_actual_threshold_and_uncertainty_fail_closed(self):
        correct = self.prepared["binding"]["truth"]
        self.assertTrue(judge(self.prepared, {"picks": correct, "unreadable": False})["passed"])
        one_wrong = [0, *correct[1:]]
        seven = judge(self.prepared, {"picks": one_wrong, "unreadable": False})
        self.assertEqual((seven["correct"], seven["rounds"], seven["passed"]), (7, 8, True))
        self.assertFalse(judge(self.prepared, {"picks": [0, 0, *correct[2:]], "unreadable": False})["passed"])
        self.assertFalse(judge(self.prepared, {"picks": correct, "unreadable": True})["passed"])
        self.assertFalse(judge(self.prepared, {"picks": [0] * 8, "unreadable": False})["passed"])

    def test_malformed_or_injected_model_answers_are_not_approvals(self):
        for reply in ({"picks": [True] * 8, "unreadable": False},
                      {"picks": [1] * 7, "unreadable": False},
                      {"picks": [5] * 8, "unreadable": False},
                      {"picks": [1] * 8, "unreadable": "false"},
                      {"picks": [1] * 8, "unreadable": False, "override": "approve"},
                      "approve", None):
            with self.subTest(reply=reply), self.assertRaisesRegex(ValueError, "reply-schema"):
                judge(self.prepared, reply)

    def test_different_portrait_repeated_candidate_and_clipping_cannot_form_a_challenge(self):
        with self.assertRaisesRegex(ValueError, "portrait-binding"):
            challenge(self.rows[0], self.rows[1:], b"wrong upload", nonce="f" * 64)
        self.rows[1]["sourceSha256"] = self.rows[0]["sourceSha256"]
        with self.assertRaisesRegex(ValueError, "candidate-binding"):
            self.build()
        self.rows[1]["sourceSha256"] = "1" * 64
        self.rows[1]["views"][3] = (Image.new("RGBA", (256, 256)), (-512, -512))
        with self.assertRaisesRegex(ValueError, "sprite-clipped"):
            self.build()

    def test_replacing_any_sealed_challenge_input_invalidates_the_decision(self):
        for field in ("lineup", "reference", "binding"):
            changed = deepcopy(self.prepared)
            if field == "binding":
                changed[field]["truth"][0] = 0
            else:
                changed[field] += b"changed"
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "challenge-tampered"):
                judge(changed, {"picks": [1] * 8, "unreadable": False})

    def test_only_a_complete_bound_provider_response_can_return_a_recognition_decision(self):
        reply = {"picks": self.prepared["binding"]["truth"], "unreadable": False}
        response = {"id": "resp_local", "model": "local-review-fixture", "status": "completed",
                    "output": [{"type": "message", "role": "assistant", "status": "completed",
                                "content": [{"type": "output_text", "text": json.dumps(reply)}]}],
                    "usage": {"input_tokens": 500, "output_tokens": 30, "total_tokens": 530}}
        decision = completed_response(self.prepared, response, "local-review-fixture")
        self.assertTrue(decision["passed"])
        self.assertEqual(decision["responseId"], "resp_local")
        self.assertEqual(decision["usage"], response["usage"])
        for field, value in (("status", "incomplete"), ("model", "different-model"),
                             ("incomplete_details", {"reason": "max_output_tokens"}),
                             ("usage", None), ("error", {"code": "server_error"}),
                             ("output", [{"type": "message", "role": "assistant", "status": "completed",
                                          "content": [{"type": "refusal", "refusal": "unavailable"}]}])):
            changed = {**response, field: value}
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "recognition-response"):
                completed_response(self.prepared, changed, "local-review-fixture")


if __name__ == "__main__":
    unittest.main()
