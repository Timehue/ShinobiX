import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from closeup_portrait import single_closeup


def box(label, coordinates, score=.75):
    return {"label": label, "box": coordinates, "score": score}


class CloseupScreenTest(unittest.TestCase):
    def setUp(self):
        self.face = box("a face", [320, 110, 560, 435])
        hair = box("hair", [4, 4, 670, 680], .34)
        self.read = {"size": [768, 1024],
                     "regions": [box("a person", [8, 11, 760, 1016], .43), hair],
                     "robeRegions": [self.face, hair], "hoodRegions": [self.face]}

    def test_admits_a_consistent_closeup_without_a_detected_jacket(self):
        self.assertTrue(single_closeup(self.read))

    def test_declines_a_second_face_or_person(self):
        for group, other in (("robeRegions", box("a face", [33, 134, 240, 390], .52)),
                             ("regions", box("a person", [2, 25, 250, 850], .39))):
            with self.subTest(group=group):
                self.read[group].append(other)
                self.assertFalse(single_closeup(self.read))
                self.read[group].pop()

    def test_declines_a_weak_face_read_and_a_face_only_crop(self):
        self.read["hoodRegions"] = [box("a face", self.face["box"], .55)]
        self.assertFalse(single_closeup(self.read))
        self.read["hoodRegions"] = [self.face]
        self.read["regions"][0] = box("a person", [10, 8, 750, 610], .43)
        self.assertFalse(single_closeup(self.read))


if __name__ == "__main__":
    unittest.main()
