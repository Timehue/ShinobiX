import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from closeup_portrait import has_phrase
from upright_animal import MODEL, QUESTIONS, admits, request_body, verdict

UPRIGHT = {"species": "raccoon", "single_character": True, "illustrated": True, "animal": True, "upright_humanoid": True,
           "two_legs": True, "four_legged": False, "real_photo": False}


def response(answer, **changes):
    body = {"status": "completed", "model": MODEL, "error": None, "incomplete_details": None,
            "output": [{"type": "reasoning"}, {"type": "message", "role": "assistant", "status": "completed",
                                                "content": [{"type": "output_text", "text": json.dumps(answer)}]}]}
    return {**body, **changes}


class PhraseTest(unittest.TestCase):
    def test_matches_whole_labels_and_article_led_parts(self):
        self.assertTrue(has_phrase("a face", "a face"))
        self.assertTrue(has_phrase("a samurai helmet a helmet", "a samurai helmet"))
        self.assertTrue(has_phrase("a samurai helmet a helmet", "a helmet"))
        self.assertTrue(has_phrase("metal armor a helmet", "metal armor"))
        self.assertTrue(has_phrase("an animal head a raccoon face", "a raccoon face"))
        self.assertTrue(has_phrase("a hair bun hair a face", "a face"))

    def test_never_matches_inside_a_longer_phrase(self):
        self.assertFalse(has_phrase("a face mask", "a face"))
        self.assertFalse(has_phrase("a face mask a bun", "a face"))
        self.assertFalse(has_phrase("a face hair", "a face"))
        self.assertFalse(has_phrase("a raccoon face", "a face"))
        self.assertFalse(has_phrase("a pair of eyes", "a pair"))


class VerdictTest(unittest.TestCase):
    def test_admits_only_a_single_illustrated_upright_animal(self):
        self.assertTrue(admits(verdict(response(UPRIGHT))))
        for key, value in (("four_legged", True), ("real_photo", True), ("animal", False), ("two_legs", False),
                           ("upright_humanoid", False), ("single_character", False), ("illustrated", False)):
            with self.subTest(key=key):
                self.assertFalse(admits(verdict(response({**UPRIGHT, key: value}))))

    def test_incomplete_or_malformed_answers_raise_instead_of_admitting(self):
        for bad in (response(UPRIGHT, status="incomplete"), response(UPRIGHT, model="another-model"),
                    response(UPRIGHT, error={"message": "x"}), response({**UPRIGHT, "extra": True}),
                    response({**UPRIGHT, "animal": "yes"}), response(UPRIGHT, output=[]),
                    response({**UPRIGHT, "species": ""}), response({k: v for k, v in UPRIGHT.items() if k != "species"})):
            with self.assertRaises(ValueError):
                verdict(bad)

    def test_request_pins_the_model_and_a_strict_schema(self):
        body = request_body(b"png")
        self.assertEqual(body["model"], MODEL)
        self.assertFalse(body["store"])
        schema = body["text"]["format"]
        self.assertTrue(schema["strict"])
        self.assertEqual(schema["schema"]["required"], ["species", *QUESTIONS])
        self.assertEqual(body["input"][0]["content"][0]["detail"], "high")


if __name__ == "__main__":
    unittest.main()
