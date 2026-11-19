"""Check that costume retries use the same head-direction instructions."""
import base64
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import paint_portrait


class CostumePromptTest(unittest.TestCase):
    def test_new_and_existing_paint_attempts_keep_their_prompt_revision(self):
        png = BytesIO()
        Image.new("RGBA", (1536, 960)).save(png, "PNG")
        art = png.getvalue()
        result = {"data": [{"b64_json": base64.b64encode(art).decode()}]}
        source = "1" * 64
        asset = "2" * 32

        def request(_portrait, _source, _template, correction, _previous, *, sector_guide, head_turnaround,
                    torso_fit=False, reference_identity=False):
            return {"guide": sector_guide, "prompt": paint_portrait.PROMPT + (
                paint_portrait.HEAD_TURNAROUND if head_turnaround else ""), "correction": correction}

        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            template = root / "template.json"
            template.write_bytes(b"template")
            for label, enabled in (("new", True), ("legacy", False)):
                with self.subTest(label=label), patch.object(paint_portrait, "edit_request", side_effect=request) as build:
                    folder = root / label
                    if not enabled:
                        first = folder / "edit-1"
                        first.mkdir(parents=True)
                        body = request(root/"portrait", source, template, None, None,
                                       sector_guide=paint_portrait.SECTOR_GUIDE, head_turnaround=False)
                        raw = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
                        operation = sha256(asset.encode() + b"\x001\x00" + raw).hexdigest()
                        (first / "painting.png").write_bytes(art)
                        (first / "completed.json").write_text(json.dumps({
                            "operation": operation, "painting": sha256(art).hexdigest(),
                            "binding": {"job": asset, "source": source, "template": sha256(b"template").hexdigest(),
                                        "sectorGuide": paint_portrait.SECTOR_GUIDE},
                        }))
                    submit = Mock(return_value=("fixture", result))
                    painter = paint_portrait.costume_painter(folder, asset, Mock(return_value=True), submit)
                    painter(root/"portrait", source, template, 1, None)
                    painter(root/"portrait", source, template, 2, "Repair detached sleeve")
                    painter(root/"portrait", source, template, 2, "Repair detached sleeve")
                    self.assertEqual([call.kwargs["head_turnaround"] for call in build.call_args_list], [enabled] * 3)
                    self.assertEqual(submit.call_count, 2 if enabled else 1)
                    first_binding = json.loads((folder/"edit-1/completed.json").read_bytes())["binding"]
                    self.assertEqual(first_binding.get("headTurnaround", False), enabled)


class RepairTest(unittest.TestCase):
    """A costume gets one painting and two repairs, each shown the sheet the rig rejected."""

    def setUp(self):
        self.sheets = []
        for shade in (10, 20, 30):
            png = BytesIO()
            Image.new("RGBA", (1536, 960), (shade, 0, 0, 255)).save(png, "PNG")
            self.sheets.append(png.getvalue())

    def painter(self, folder, submit, asset="5" * 32):
        return paint_portrait.costume_painter(folder, asset, Mock(return_value=True), submit)

    @staticmethod
    def request(_portrait, _source, _template, correction, previous, *, sector_guide, head_turnaround,
                torso_fit=False, reference_identity=False, attempt=2):
        return {"correction": correction, "previous": sha256(previous).hexdigest() if previous else None,
                "torsoFit": torso_fit, "attempt": attempt}

    def test_new_jobs_ask_for_the_torso_fit_and_repair_twice_from_the_latest_sheet(self):
        results = [{"data": [{"b64_json": base64.b64encode(sheet).decode()}]} for sheet in self.sheets]
        submit = Mock(side_effect=[("fixture", result) for result in results])
        with TemporaryDirectory() as temporary, patch.object(paint_portrait, "edit_request", side_effect=self.request) as build:
            root = Path(temporary)
            template = root / "template.json"
            template.write_bytes(b"template")
            paint = self.painter(root / "job", submit)
            paint(root / "portrait", "1" * 64, template, 1, None)
            paint(root / "portrait", "1" * 64, template, 2, "first rejection")
            paint(root / "portrait", "1" * 64, template, 3, "second rejection")
            self.assertEqual(submit.call_count, 3)
            calls = [call.kwargs for call in build.call_args_list]
            self.assertTrue(all(kwargs["torso_fit"] for kwargs in calls))
            self.assertNotIn("attempt", calls[1])
            self.assertEqual(calls[2]["attempt"], 3)
            # The third request carries the second painting, not the first.
            self.assertEqual(build.call_args_list[1].args[4], self.sheets[0])
            self.assertEqual(build.call_args_list[2].args[4], self.sheets[1])
            binding = json.loads((root / "job/edit-3/completed.json").read_bytes())["binding"]
            self.assertTrue(binding["torsoFit"])
            with self.assertRaises(ValueError):
                paint(root / "portrait", "1" * 64, template, 4, "too many")

    def test_a_third_attempt_needs_the_second_painting(self):
        with TemporaryDirectory() as temporary, patch.object(paint_portrait, "edit_request", side_effect=self.request):
            root = Path(temporary)
            template = root / "template.json"
            template.write_bytes(b"template")
            submit = Mock(return_value=("fixture", {"data": [{"b64_json": base64.b64encode(self.sheets[0]).decode()}]}))
            paint = self.painter(root / "job", submit)
            paint(root / "portrait", "1" * 64, template, 1, None)
            with self.assertRaises(ValueError):
                paint(root / "portrait", "1" * 64, template, 3, "skipped the second")
            self.assertEqual(submit.call_count, 1)


class PaletteTest(unittest.TestCase):
    def setUp(self):
        png = BytesIO()
        Image.new("RGBA", (1536, 960)).save(png, "PNG")
        self.art = png.getvalue()
        self.result = {"data": [{"b64_json": base64.b64encode(self.art).decode()}]}

    @staticmethod
    def request(_portrait, _source, _template, correction, _previous, *, sector_guide, head_turnaround,
                palette_prompt=False, torso_fit=False, reference_identity=False):
        return {"guide": sector_guide, "correction": correction, "palette": palette_prompt}

    def test_new_jobs_name_the_palette_and_correct_the_painting(self):
        corrected = b"corrected-png"
        palette = Mock(return_value=corrected)
        with TemporaryDirectory() as temporary, patch.object(paint_portrait, "edit_request", side_effect=self.request) as build:
            root = Path(temporary)
            template = root / "template.json"
            template.write_bytes(b"template")
            painter = paint_portrait.costume_painter(root / "job", "3" * 32, Mock(return_value=True),
                                                     Mock(return_value=("fixture", self.result)), palette=palette)
            path, digest = painter(root / "portrait", "1" * 64, template, 1, None)
            self.assertTrue(build.call_args.kwargs["palette_prompt"])
            palette.assert_called_once_with(self.art, root / "portrait")
            self.assertEqual(path.read_bytes(), corrected)
            self.assertEqual(digest, sha256(corrected).hexdigest())
            binding = json.loads((root / "job/edit-1/completed.json").read_bytes())["binding"]
            self.assertTrue(binding["portraitPalette"])

    def test_a_job_first_billed_without_the_palette_repairs_with_the_same_prompt(self):
        with TemporaryDirectory() as temporary, patch.object(paint_portrait, "edit_request", side_effect=self.request) as build:
            root = Path(temporary)
            template = root / "template.json"
            template.write_bytes(b"template")
            asset, source = "4" * 32, "1" * 64
            first = root / "job/edit-1"
            first.mkdir(parents=True)
            (first / "painting.png").write_bytes(self.art)
            (first / "completed.json").write_text(json.dumps({
                "operation": "earlier", "painting": sha256(self.art).hexdigest(),
                "binding": {"job": asset, "source": source, "template": sha256(b"template").hexdigest(),
                            "sectorGuide": paint_portrait.SECTOR_GUIDE, "headTurnaround": True}}))
            painter = paint_portrait.costume_painter(root / "job", asset, Mock(return_value=True),
                                                     Mock(return_value=("fixture", self.result)), palette=Mock(side_effect=lambda p, _u: p))
            painter(root / "portrait", source, template, 2, "Repair detached sleeve")
            self.assertNotIn("palette_prompt", build.call_args.kwargs)

    def test_only_an_animal_character_is_told_where_its_tail_goes(self):
        def request(_portrait, _source, _template, correction, _previous, *, sector_guide, head_turnaround,
                    torso_fit=False, tail_fit=False, **animal):
            return {"tail": tail_fit, "animal": sorted(animal)}

        with TemporaryDirectory() as temporary, patch.object(paint_portrait, "edit_request", side_effect=request) as build:
            root = Path(temporary)
            template = root / "template.json"
            template.write_bytes(b"template")
            for label, flags in (("human", {}), ("raccoon", {"armored_raccoon": True}), ("animal", {"upright_animal": True})):
                with self.subTest(label=label):
                    painter = paint_portrait.costume_painter(root / label, "6" * 32, Mock(return_value=True),
                                                             Mock(return_value=("fixture", self.result)), **flags)
                    painter(root / "portrait", "1" * 64, template, 1, None)
                    self.assertEqual(build.call_args.kwargs.get("tail_fit", False), bool(flags))
                    binding = json.loads((root / label / "edit-1/completed.json").read_bytes())["binding"]
                    self.assertEqual(binding.get("tailFit", False), bool(flags))

    def test_an_animal_job_first_billed_without_the_tail_line_repairs_with_the_same_prompt(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            template = root / "template.json"
            template.write_bytes(b"template")
            asset, source = "7" * 32, "1" * 64
            first = root / "job/edit-1"
            first.mkdir(parents=True)
            (first / "painting.png").write_bytes(self.art)
            (first / "completed.json").write_text(json.dumps({
                "operation": "earlier", "painting": sha256(self.art).hexdigest(),
                "binding": {"job": asset, "source": source, "template": sha256(b"template").hexdigest(),
                            "sectorGuide": paint_portrait.SECTOR_GUIDE, "headTurnaround": True,
                            "uprightAnimal": True, "torsoFit": True}}))
            painter = paint_portrait.costume_painter(root / "job", asset, Mock(return_value=True),
                                                     Mock(return_value=("fixture", self.result)), upright_animal=True)
            with patch.object(paint_portrait, "edit_request", side_effect=lambda *a, **k: {"k": sorted(k)}) as build:
                painter(root / "portrait", source, template, 2, "Repair detached sleeve")
            self.assertNotIn("tail_fit", build.call_args.kwargs)
            self.assertTrue(build.call_args.kwargs["upright_animal"])

    def test_new_jobs_say_the_style_reference_is_an_unrelated_person(self):
        with TemporaryDirectory() as temporary, \
                patch.object(paint_portrait, "edit_request", side_effect=lambda *a, **k: {"k": sorted(k)}) as build:
            root = Path(temporary)
            template = root / "template.json"
            template.write_bytes(b"template")
            painter = paint_portrait.costume_painter(root / "job", "8" * 32, Mock(return_value=True),
                                                     Mock(return_value=("fixture", self.result)), armored_raccoon=True)
            painter(root / "portrait", "1" * 64, template, 1, None)
            painter(root / "portrait", "1" * 64, template, 2, "Likeness check: wrong species")
            self.assertEqual([call.kwargs.get("reference_identity") for call in build.call_args_list], [True, True])
            binding = json.loads((root / "job/edit-1/completed.json").read_bytes())["binding"]
            self.assertTrue(binding["referenceIdentity"])

    def test_a_job_first_billed_without_the_reference_line_repairs_with_the_same_prompt(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            template = root / "template.json"
            template.write_bytes(b"template")
            asset, source = "9" * 32, "1" * 64
            first = root / "job/edit-1"
            first.mkdir(parents=True)
            (first / "painting.png").write_bytes(self.art)
            (first / "completed.json").write_text(json.dumps({
                "operation": "earlier", "painting": sha256(self.art).hexdigest(),
                "binding": {"job": asset, "source": source, "template": sha256(b"template").hexdigest(),
                            "sectorGuide": paint_portrait.SECTOR_GUIDE, "headTurnaround": True,
                            "armoredRaccoon": True, "torsoFit": True, "tailFit": True}}))
            painter = paint_portrait.costume_painter(root / "job", asset, Mock(return_value=True),
                                                     Mock(return_value=("fixture", self.result)), armored_raccoon=True)
            with patch.object(paint_portrait, "edit_request", side_effect=lambda *a, **k: {"k": sorted(k)}) as build:
                painter(root / "portrait", source, template, 2, "Repair detached sleeve")
            self.assertNotIn("reference_identity", build.call_args.kwargs)

    def test_the_reference_line_follows_the_style_reference_into_the_real_prompt(self):
        import types
        portrait = BytesIO()
        Image.new("RGB", (64, 64), (20, 40, 200)).save(portrait, "PNG")
        prepared = types.SimpleNamespace(png=portrait.getvalue(), source_sha256="1" * 64)
        module = types.ModuleType("avatar_worker.portrait")
        module.prepare_portrait = lambda raw: prepared
        with TemporaryDirectory() as temporary, \
                patch.dict(sys.modules, {"avatar_worker": types.ModuleType("avatar_worker"),
                                         "avatar_worker.portrait": module}):
            root = Path(temporary)
            upload = root / "portrait"
            upload.write_bytes(b"raw")
            guide = BytesIO()
            Image.new("RGBA", (64, 40), (90, 90, 90, 255)).save(guide, "PNG")
            template = root / "male-coat-template.json"
            template.with_suffix(".png").write_bytes(guide.getvalue())
            template.write_text(json.dumps({"guideSha256": sha256(guide.getvalue()).hexdigest(),
                                            "views": {"s": {"body": {"guideRect": [0, 0, 32, 40]}}}}))
            prompts = {flag: paint_portrait.edit_request(upload, "1" * 64, template, None, reference_identity=flag)["prompt"]
                       for flag in (False, True)}
            # Without the style reference there is no image 3 to warn about.
            bare = paint_portrait.edit_request(upload, "1" * 64, template, None, sector_guide=None,
                                               reference_identity=True)["prompt"]
        self.assertNotIn(paint_portrait.REFERENCE_IDENTITY, prompts[False])
        self.assertTrue(prompts[True].endswith(paint_portrait.SECTOR_MATERIALS + paint_portrait.REFERENCE_IDENTITY))
        self.assertNotIn(paint_portrait.REFERENCE_IDENTITY, bare)
        self.assertIn("Image 3 shows an unrelated person", paint_portrait.REFERENCE_IDENTITY)

    def test_a_failed_correction_keeps_the_paid_painting(self):
        with TemporaryDirectory() as temporary:
            upload = Path(temporary) / "missing-portrait"
            self.assertEqual(paint_portrait.portrait_palette(self.art, upload), self.art)


if __name__ == "__main__":
    unittest.main()
