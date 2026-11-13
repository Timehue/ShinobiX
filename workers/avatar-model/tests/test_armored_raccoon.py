import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from armored_raccoon import confirms_armor, face_and_muzzle


def box(label, coordinates, score):
    return {"label": label, "box": coordinates, "score": score}


# Detector boxes read from a real 256px armored raccoon portrait: the head with
# its ears and the inner face come back as two nested "raccoon face" boxes.
HEAD = box("an animal head a raccoon face", [68.4, 15.7, 194.4, 120.0], .4142)
INNER = box("an animal head a raccoon face", [80.2, 34.6, 182.7, 117.4], .3957)
SNOUT = box("a snout", [111.0, 87.1, 148.5, 113.4], .5977)


class FaceAndMuzzleTest(unittest.TestCase):
    def read(self, *rows):
        return {"size": [256, 256], "animalRegions": list(rows)}

    def test_admits_an_inner_face_nested_inside_the_head(self):
        self.assertEqual(face_and_muzzle(self.read(HEAD, INNER, SNOUT)), (HEAD["box"], SNOUT["box"]))

    def test_declines_a_second_face_beside_the_first(self):
        beside = box("a raccoon face", [150.0, 20.0, 250.0, 110.0], .40)
        self.assertIsNone(face_and_muzzle(self.read(HEAD, beside, SNOUT)))

    def test_declines_a_face_without_a_muzzle_inside_it(self):
        self.assertIsNone(face_and_muzzle(self.read(HEAD, INNER)))


# Armor read from the same portrait: the helmet comes back under a merged label
# and metal armor reads lower than the armored chest.
ARMOR = [
    box("a pair", [101.5, 67.4, 165.5, 91.9], .7694),
    box("a raccoon face", [67.1, 13.8, 195.5, 123.1], .8489),
    box("a raccoon nose", [122.4, 95.3, 138.8, 108.9], .8202),
    box("a furry muzzle", [108.9, 86.4, 149.5, 115.0], .6838),
    box("an armored chest", [0.0, 0.1, 256.0, 252.7], .5455),
    box("a samurai helmet a helmet", [64.9, 13.3, 197.2, 122.4], .393),
    box("metal armor", [0.0, 62.9, 256.0, 249.9], .3725),
    box("metal armor a helmet", [0.0, 0.1, 256.0, 253.5], .337),
]


class ConfirmsArmorTest(unittest.TestCase):
    def confirms(self, rows):
        return confirms_armor(HEAD["box"], SNOUT["box"], rows)

    def test_admits_the_real_armored_raccoon_read(self):
        self.assertTrue(self.confirms(ARMOR))

    def test_declines_without_a_helmet(self):
        self.assertFalse(self.confirms([row for row in ARMOR if "samurai helmet" not in row["label"]]))

    def test_declines_weak_combined_armor(self):
        weak = [dict(row, score=.40) if row["label"] == "an armored chest" else row for row in ARMOR]
        self.assertFalse(self.confirms(weak))

    def test_declines_without_metal_armor(self):
        self.assertFalse(self.confirms([row for row in ARMOR if "metal armor" not in row["label"]]))


if __name__ == "__main__":
    unittest.main()
