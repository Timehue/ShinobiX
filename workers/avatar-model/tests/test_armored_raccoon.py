import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from armored_raccoon import face_and_muzzle


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


if __name__ == "__main__":
    unittest.main()
