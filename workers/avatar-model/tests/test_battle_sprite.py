"""The painted combat sprite: one paid edit, framed like a bundled fighter, or the job keeps the posed model."""
import base64
from io import BytesIO
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import types
import unittest
from unittest.mock import Mock, patch

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import battle_pose
import paint_battle_sprite as battle
import paint_sprite_style


def painting(*, size=(1024, 1024), figures=((380, 120, 640, 940),), background=(0, 0, 0, 0), marker=None):
    page = Image.new("RGBA", size, background)
    draw = ImageDraw.Draw(page)
    for box in figures:
        draw.ellipse(box, fill=(40, 60, 200, 255))
    if marker:
        draw.rectangle(marker, fill=(250, 220, 0, 255))
    output = BytesIO()
    page.save(output, "PNG")
    return output.getvalue()


class CutOutTest(unittest.TestCase):
    def test_a_painted_figure_is_framed_like_a_bundled_fighter(self):
        sprite = battle.cut_out(painting())
        self.assertEqual(sprite.size, (384, 384))
        left, top, right, bottom = sprite.getchannel("A").point(lambda value: 255 if value > 32 else 0).getbbox()
        self.assertEqual(bottom, battle.GROUND)
        self.assertLessEqual(bottom - top, battle.FIGURE)
        self.assertGreaterEqual(bottom - top, battle.FIGURE - 2)
        self.assertLessEqual(abs((left + right) / 2 - 192), 1.5)

    def test_loose_specks_are_dropped(self):
        sprite = battle.cut_out(painting(marker=(60, 60, 70, 70)))
        left = sprite.getchannel("A").point(lambda value: 255 if value > 32 else 0).getbbox()[0]
        self.assertGreater(left, 100)

    def test_unusable_paintings_are_refused(self):
        cases = {
            "battle-sprite-format": painting(size=(1536, 960)),
            "battle-sprite-empty": painting(figures=()),
            "battle-sprite-background": painting(background=(20, 20, 20, 255)),
            "battle-sprite-extra-figure": painting(figures=((120, 200, 380, 900), (600, 200, 860, 900))),
            "battle-sprite-cropped": painting(figures=((380, 0, 640, 940),)),
            "battle-sprite-small": painting(figures=((300, 500, 720, 900),)),
        }
        for reason, pixels in cases.items():
            with self.subTest(reason=reason), self.assertRaisesRegex(ValueError, reason):
                battle.cut_out(pixels)


class FinishTest(unittest.TestCase):
    def setUp(self):
        # The marker sits on the figure's right side, so a mirrored sprite is recognisable.
        self.pixels = painting(marker=(560, 480, 640, 560))

    @staticmethod
    def marker_side(webp):
        sprite = Image.open(BytesIO(webp)).convert("RGB")
        yellow = [x for x in range(sprite.width) for y in range(120, 300, 4)
                  if sprite.getpixel((x, y))[0] > 200 and sprite.getpixel((x, y))[2] < 90]
        return "right" if sum(yellow) / len(yellow) > 192 else "left"

    def test_a_left_facing_sprite_is_kept_as_painted(self):
        webp = battle.finish(battle.cut_out(self.pixels),Mock(return_value=True), Mock(return_value="left"))
        self.assertLessEqual(len(webp), battle.BATTLE_SPRITE_BYTES)
        self.assertEqual(Image.open(BytesIO(webp)).format, "WEBP")
        self.assertEqual(self.marker_side(webp), "right")

    def test_a_right_facing_sprite_is_mirrored_to_face_left(self):
        webp = battle.finish(battle.cut_out(self.pixels),Mock(return_value=True), Mock(return_value="right"))
        self.assertEqual(self.marker_side(webp), "left")

    def test_a_failed_facing_check_keeps_the_painting(self):
        webp = battle.finish(battle.cut_out(self.pixels),Mock(return_value=True), Mock(side_effect=OSError("offline")))
        self.assertEqual(self.marker_side(webp), "right")

    def test_a_flagged_sprite_is_never_used(self):
        face = Mock()
        with self.assertRaisesRegex(ValueError, "battle-sprite-moderation"):
            battle.finish(battle.cut_out(self.pixels),Mock(return_value=False), face)
        face.assert_not_called()

    def test_an_unavailable_moderation_check_refuses_the_sprite(self):
        with self.assertRaises(OSError):
            battle.finish(battle.cut_out(self.pixels),Mock(side_effect=OSError("offline")), Mock())


class RequestTest(unittest.TestCase):
    def test_the_request_shows_the_portrait_the_costume_and_the_bound_stance(self):
        request = battle.battle_request(b"portrait", b"sheet")
        self.assertEqual((request["model"], request["size"], request["background"], request["n"]),
                         (battle.paint_portrait.MODEL, "1024x1024", "transparent", 1))
        urls = [image["image_url"] for image in request["images"]]
        self.assertEqual(len(urls), 3)
        self.assertEqual(base64.b64decode(urls[0].split(",")[1]), b"portrait")
        self.assertEqual(base64.b64decode(urls[1].split(",")[1]), b"sheet")
        self.assertEqual(base64.b64decode(urls[2].split(",")[1]), battle.stance_reference())

    def test_a_changed_stance_reference_is_refused(self):
        with patch.object(battle, "STANCE_GUIDE", "0" * 64), self.assertRaisesRegex(ValueError, "style-binding"):
            battle.battle_request(b"portrait", b"sheet")


class PaintTest(unittest.TestCase):
    """The installed release supplies the portrait reader; a stand-in keeps this test offline."""

    def setUp(self):
        self.portrait = BytesIO()
        Image.new("RGB", (64, 64), (90, 90, 90)).save(self.portrait, "PNG")
        self.source = "a" * 64
        prepared = types.SimpleNamespace(source_sha256=self.source, png=self.portrait.getvalue())
        reader = types.ModuleType("avatar_worker.portrait")
        reader.prepare_portrait = lambda raw: prepared
        package = types.ModuleType("avatar_worker")
        package.portrait = reader
        modules = {"motion_worker_paths": types.ModuleType("motion_worker_paths"),
                   "avatar_worker": package, "avatar_worker.portrait": reader}
        installed = patch.dict(sys.modules, modules)
        installed.start()
        self.addCleanup(installed.stop)
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        (self.work / "portrait").write_bytes(self.portrait.getvalue())
        (self.work / "painted").mkdir()
        (self.work / "painted" / "candidate.png").write_bytes(b"sheet")
        self.entry = self.work / "entry.py"
        self.entry.write_text("")

    def paint(self, submit, moderate=None):
        return battle.paint(self.entry, self.work, "1" * 32, self.source, submit,
                            moderate or Mock(return_value=True), Mock(return_value="left"))

    @staticmethod
    def reply(pixels):
        return "request-1", {"usage": {"total_tokens": 7}, "data": [{"b64_json": base64.b64encode(pixels).decode()}]}

    def record(self, attempt):
        return json.loads((self.work / "battle" / f"edit-{attempt}" / "provider.json").read_bytes())

    def test_a_good_first_painting_is_one_edit_journaled_and_saved(self):
        submit = Mock(return_value=self.reply(painting()))
        sprite = self.paint(submit)
        self.assertEqual((self.work / "battle" / "sprite.webp").read_bytes(), sprite)
        record = self.record(1)
        self.assertEqual((record["requestId"], record["size"], record["usage"]), ("request-1", "1024x1024", {"total_tokens": 7}))
        body, operation = submit.call_args.args
        self.assertEqual(record["operation"], operation)
        self.assertEqual(len(json.loads(body)["images"]), 3)
        submit.assert_called_once()
        self.assertFalse((self.work / "battle" / "edit-2").exists())

    def test_a_second_run_never_sends_the_same_edit_again(self):
        submit = Mock(return_value=self.reply(painting()))
        self.paint(submit)
        with self.assertRaises(FileExistsError):
            self.paint(submit)
        submit.assert_called_once()

    def test_a_cropped_painting_is_repaired_once_with_the_reason_and_the_refused_art(self):
        cropped = painting(figures=((380, 0, 640, 940),))
        submit = Mock(side_effect=[self.reply(cropped), self.reply(painting())])
        sprite = self.paint(submit)
        self.assertEqual((self.work / "battle" / "sprite.webp").read_bytes(), sprite)
        self.assertEqual(submit.call_count, 2)
        first, repair = (json.loads(call.args[0]) for call in submit.call_args_list)
        self.assertEqual(len(first["images"]), 3)
        self.assertEqual(len(repair["images"]), 4)
        self.assertEqual(base64.b64decode(repair["images"][3]["image_url"].split(",")[1]), cropped)
        self.assertIn(battle.REPAIRS["battle-sprite-cropped"], repair["prompt"])
        self.assertNotEqual(self.record(1)["operation"], self.record(2)["operation"])

    def test_two_refused_paintings_stop_there_with_both_edits_journaled(self):
        opaque = painting(background=(9, 9, 9, 255))
        submit = Mock(return_value=self.reply(opaque))
        with self.assertRaisesRegex(ValueError, "battle-sprite-background"):
            self.paint(submit)
        self.assertEqual(submit.call_count, 2)
        self.assertEqual({self.record(1)["requestId"], self.record(2)["requestId"]}, {"request-1"})
        self.assertFalse((self.work / "battle" / "sprite.webp").exists())

    def test_a_flagged_sprite_is_not_painted_again(self):
        submit = Mock(return_value=self.reply(painting()))
        with self.assertRaisesRegex(ValueError, "battle-sprite-moderation"):
            self.paint(submit, moderate=Mock(return_value=False))
        submit.assert_called_once()

    def test_a_portrait_from_another_job_is_refused_before_any_edit(self):
        submit = Mock()
        with self.assertRaisesRegex(ValueError, "portrait-source-mismatch"):
            battle.paint(self.entry, self.work, "1" * 32, "b" * 64, submit, Mock(), Mock())
        submit.assert_not_called()


class FallbackFrameTest(unittest.TestCase):
    def test_the_posed_model_is_framed_like_the_painted_sprite(self):
        figure = Image.new("RGBA", (224, 394), (40, 60, 200, 255))
        sprite = Image.open(BytesIO(battle_pose.frame_fighter(figure))).convert("RGBA")
        self.assertEqual(sprite.size, (battle.CANVAS, battle.CANVAS))
        left, top, right, bottom = sprite.getchannel("A").point(lambda value: 255 if value > 32 else 0).getbbox()
        self.assertEqual((bottom, bottom - top), (battle.GROUND, battle.FIGURE))
        self.assertLessEqual(abs((left + right) / 2 - battle.CANVAS / 2), 1)


class StyleSpriteTest(unittest.TestCase):
    def test_only_a_sound_webp_replaces_the_posed_model(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            Image.new("RGBA", (384, 384), (10, 20, 30, 255)).save(root / "good.webp", "WEBP")
            Image.new("RGBA", (384, 384), (10, 20, 30, 255)).save(root / "wrong.webp", "PNG")
            Image.new("RGBA", (600, 600), (10, 20, 30, 255)).save(root / "large.webp", "WEBP")
            (root / "junk.webp").write_bytes(b"not an image")
            self.assertEqual(paint_sprite_style.painted_battle_sprite(root / "good.webp"), (root / "good.webp").read_bytes())
            for name in ("wrong.webp", "large.webp", "junk.webp", "missing.webp"):
                with self.subTest(name=name):
                    self.assertIsNone(paint_sprite_style.painted_battle_sprite(root / name))


if __name__ == "__main__":
    unittest.main()
