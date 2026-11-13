import colorsys
import io
import sys
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import costume_palette as cp

ELECTRIC_BLUE, NAVY = (38, 32, 215), (40, 48, 92)
FUR_GREY, MUTED_BLUE = (112, 104, 98), (50, 54, 70)  # duller and darker than NAVY


def png(size, regions, mode="RGBA"):
    """regions: (box, color) painted over a transparent (or black) canvas."""
    image = Image.new(mode, size, (0, 0, 0, 0) if mode == "RGBA" else (0, 0, 0))
    for box, color in regions:
        image.paste(color + ((255,) if mode == "RGBA" else ()), box)
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def pixel(data, xy):
    with Image.open(io.BytesIO(data)) as image:
        return image.convert("RGBA").getpixel(xy)[:3]


def hsv(rgb):
    return colorsys.rgb_to_hsv(*(c / 255 for c in rgb))


PORTRAIT = png((256, 256), [((0, 0, 256, 256), ELECTRIC_BLUE), ((100, 20, 160, 80), FUR_GREY)], mode="RGB")
SHEET = png((1536, 960), [((100, 100, 400, 700), NAVY), ((150, 30, 350, 100), FUR_GREY)])


class CostumePaletteTest(unittest.TestCase):
    def test_restores_a_muted_coat_toward_the_portrait_blue(self):
        out = cp.restore(SHEET, PORTRAIT)
        before, after = hsv(pixel(SHEET, (250, 400))), hsv(pixel(out, (250, 400)))
        self.assertGreater(after[1], before[1] * 1.5)
        self.assertGreater(after[2], before[2])
        self.assertAlmostEqual(after[0], before[0], places=2)  # same hue

    def test_leaves_grey_fur_and_transparency_alone(self):
        out = cp.restore(SHEET, PORTRAIT)
        self.assertEqual(pixel(out, (250, 60)), FUR_GREY)
        with Image.open(io.BytesIO(out)) as image:
            self.assertEqual(image.getpixel((5, 5))[3], 0)
            self.assertEqual((image.mode, image.size), ("RGBA", (1536, 960)))

    def test_never_mutes_and_skips_a_painting_that_already_matches(self):
        muted = png((256, 256), [((0, 0, 256, 256), MUTED_BLUE)], mode="RGB")
        self.assertEqual(cp.restore(SHEET, muted), SHEET)
        vivid_sheet = png((1536, 960), [((100, 100, 400, 700), ELECTRIC_BLUE)])
        self.assertEqual(cp.restore(vivid_sheet, PORTRAIT), vivid_sheet)

    def test_prompt_names_the_portrait_colors(self):
        line = cp.prompt_line(PORTRAIT)
        self.assertIn("#2620d7", line)
        self.assertEqual(cp.prompt_line(png((64, 64), [((0, 0, 64, 64), FUR_GREY)], mode="RGB")), "")

    def test_rejects_anything_but_an_rgba_png(self):
        with self.assertRaises(ValueError):
            cp.restore(png((64, 64), [], mode="RGB"), PORTRAIT)


if __name__ == "__main__":
    unittest.main()
