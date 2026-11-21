"""A refused arm or leg is redrawn from the same painting; nothing else about a sheet is ever changed."""
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import types
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import limb_repair

VIEWS = ("s", "se", "e", "ne", "n", "nw", "w", "sw")
PARTS = ("body", "arm0", "arm1", "leg0", "leg1")
CELL, ROW = 40, 50


def rig(directory):
    """Eight columns of five cells. Each guide piece is a bar in the middle of its cell; legs lean by view."""
    views = {}
    guide = Image.new("RGBA", (CELL * 8, ROW * 5))
    draw = ImageDraw.Draw(guide)
    for column, view in enumerate(VIEWS):
        views[view] = {}
        for row, part in enumerate(PARTS):
            x, y = column * CELL, row * ROW
            rect = [x + 8, y + 6, 24, 38]
            views[view][part] = {"slot": [x, y, x + CELL, y + ROW], "guideRect": rect}
            width = 14 if part == "body" else 8
            left = rect[0] + (rect[2] - width) // 2 + (2 if part.startswith("leg") and column < 4 else 0)
            draw.rectangle((left, rect[1], left + width - 1, rect[1] + rect[3] - 1), fill=(90, 90, 90, 255))
    template = Path(directory) / "rig.json"
    template.write_text(json.dumps({"views": views}))
    guide.save(template.with_suffix(".png"))
    return template, views, guide


def check(sheet, parts, template):
    """The rig check's outline test: each piece's alpha against its guide piece, at 0.70."""
    views = json.loads(Path(template).read_bytes())["views"]
    with Image.open(sheet) as opened:
        image = opened.convert("RGBA")
    with Image.open(Path(template).with_suffix(".png")) as opened:
        guide = opened.convert("RGBA")
    report = {"failures": [], "parts": []}
    for view, pieces in views.items():
        for part, spec in pieces.items():
            x, y, w, h = spec["guideRect"]
            a = np.asarray(image.crop((x, y, x + w, y + h)))[:, :, 3] > 32
            b = np.asarray(guide.crop((x, y, x + w, y + h)))[:, :, 3] > 32
            iou = float(np.sum(a & b) / max(1, np.sum(a | b)))
            report["parts"].append({"view": view, "part": part, "silhouetteIou": iou})
            if iou < .7:
                report["failures"].append(f"{view}/{part}:silhouette")
    print(json.dumps({"accepted": not report["failures"]}))
    return report


def blob(sheet, views, view, part):
    sheet.paste((0, 0, 0, 0), tuple(views[view][part]["slot"]))
    x, y, w, h = views[view][part]["guideRect"]
    ImageDraw.Draw(sheet).ellipse((x, y, x + w - 1, y + h - 1), fill=(120, 60, 30, 255))


class LimbRepairTest(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.template, self.views, self.guide = rig(self.directory.name)
        self.sheet = Path(self.directory.name) / "candidate.png"
        self.logged = []

    def tearDown(self):
        self.directory.cleanup()

    def repair(self):
        return limb_repair.repair(self.sheet, self.template, check, lambda piece, guide: piece,
                                  log=lambda line, **_: self.logged.append(line))

    def test_the_2026_11_21_leg_is_redrawn_from_the_same_painting(self):
        sheet = self.guide.copy()
        blob(sheet, self.views, "ne", "leg1")
        sheet.save(self.sheet)
        self.assertEqual(check(self.sheet, None, self.template)["failures"], ["ne/leg1:silhouette"])
        repairs = self.repair()
        self.assertEqual(len(repairs), 1)
        self.assertTrue(repairs[0].startswith("ne/leg1 from "))
        self.assertEqual(check(self.sheet, None, self.template)["failures"], [])
        self.assertEqual(self.logged, ["limb-repair " + repairs[0]])

    def test_the_closest_fitting_option_is_kept(self):
        sheet = self.guide.copy()
        blob(sheet, self.views, "ne", "leg1")
        sheet.save(self.sheet)
        self.repair()
        x, y, w, h = self.views["ne"]["leg1"]["guideRect"]
        repaired = np.asarray(Image.open(self.sheet).crop((x, y, x + w, y + h)))[:, :, 3] > 32
        wanted = np.asarray(self.guide.crop((x, y, x + w, y + h)))[:, :, 3] > 32
        self.assertTrue((repaired == wanted).all())  # ne/leg0 is an exact match; a flipped donor is not

    def test_an_arm_and_a_profile_leg_are_both_redrawn(self):
        sheet = self.guide.copy()
        blob(sheet, self.views, "sw", "arm1")
        blob(sheet, self.views, "e", "leg0")
        sheet.save(self.sheet)
        self.assertEqual(len(self.repair()), 2)
        self.assertEqual(check(self.sheet, None, self.template)["failures"], [])

    def test_an_accepted_sheet_is_never_rewritten(self):
        self.guide.save(self.sheet)
        before = self.sheet.read_bytes()
        self.assertEqual(self.repair(), [])
        self.assertEqual(self.sheet.read_bytes(), before)

    def test_a_refused_torso_goes_back_to_the_painter_untouched(self):
        sheet = self.guide.copy()
        blob(sheet, self.views, "ne", "leg1")
        blob(sheet, self.views, "n", "body")
        sheet.save(self.sheet)
        before = self.sheet.read_bytes()
        self.assertEqual(self.repair(), [])
        self.assertEqual(self.sheet.read_bytes(), before)

    def test_a_refused_limb_is_never_a_donor(self):
        sheet = self.guide.copy()
        for view in VIEWS:
            for leg in ("leg0", "leg1"):
                blob(sheet, self.views, view, leg)
        sheet.save(self.sheet)
        before = self.sheet.read_bytes()
        self.assertEqual(self.repair(), [])
        self.assertEqual(self.sheet.read_bytes(), before)


class InstalledRepairTest(unittest.TestCase):
    """paint_admitted_costume runs the repair between the rig's registration and its check."""

    def kit(self, calls):
        def register_sheet(source, template, output, **options):
            calls.append(("register", options))
            return {"s": 1.0}
        return types.SimpleNamespace(register_sheet=register_sheet, register_arm=lambda piece, guide: piece)

    def test_registration_is_followed_by_the_repair_once(self):
        import paint_admitted_costume
        calls = []
        kit = self.kit(calls)
        fake_fit = types.ModuleType("fit_candidate")
        fake_fit.fit = check
        with patch.dict(sys.modules, fit_candidate=fake_fit), \
                patch.object(limb_repair, "repair", side_effect=lambda *args: calls.append(("repair", args[0]))):
            paint_admitted_costume.with_limb_repair(kit, Path("templates"))
            paint_admitted_costume.with_limb_repair(kit, Path("templates"))
            self.assertEqual(kit.register_sheet("page", "rig.json", "candidate.png", final_attempt=True), {"s": 1.0})
        self.assertEqual(calls, [("register", {"final_attempt": True}), ("repair", "candidate.png")])

    def test_a_repair_that_breaks_leaves_the_decision_to_the_rig_check(self):
        import paint_admitted_costume
        calls = []
        kit = self.kit(calls)
        fake_fit = types.ModuleType("fit_candidate")
        fake_fit.fit = check
        with patch.dict(sys.modules, fit_candidate=fake_fit), \
                patch.object(limb_repair, "repair", side_effect=MemoryError()):
            paint_admitted_costume.with_limb_repair(kit, Path("templates"))
            self.assertEqual(kit.register_sheet("page", "rig.json", "candidate.png"), {"s": 1.0})


if __name__ == "__main__":
    unittest.main()
