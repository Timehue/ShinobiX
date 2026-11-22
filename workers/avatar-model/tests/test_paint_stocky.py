from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from PIL import Image

WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))
import animal_build
from closeup_portrait import screened_layout
from paint_admitted_costume import admitted_rig
import paint_portrait


class StockyTemplateTest(unittest.TestCase):
    def test_production_screen_requires_the_bundle_and_an_available_blind_lineup(self):
        roster = {"paintedTemplates":[animal_build.STOCKY_TEMPLATE]}
        sources = ["a"*64, "b"*64, "c"*64]
        check = animal_build.stocky_review_available
        self.assertTrue(check(roster, "d"*64, sources))
        self.assertFalse(check({}, "d"*64, sources))
        self.assertFalse(check(roster, sources[0], sources + sources + [""]))
        self.assertFalse(check(roster, "d"*64, []))

    def test_only_a_complete_affirmative_proportion_screen_routes_the_portrait(self):
        full = {**dict.fromkeys(animal_build.STOCKY_FIELDS, True), "head_share": .38, "leg_share": .24}
        def verdict(answers):
            response = dict(model=animal_build.MODEL, status="completed",
                            output=[dict(type="message", content=[dict(type="output_text", text=json.dumps(answers))])])
            return animal_build.verdict(response, proportions=True)
        self.assertTrue(verdict(full))
        for field in animal_build.STOCKY_FIELDS:
            self.assertFalse(verdict({**full,field:False}))
            with self.assertRaises(ValueError):
                verdict({**full,field:1})
        # The stated numbers must agree with the answers.
        self.assertTrue(verdict({**full,"head_share":.30,"leg_share":.35}))
        self.assertFalse(verdict({**full,"head_share":.29}))
        self.assertFalse(verdict({**full,"leg_share":.36}))
        for field in animal_build.STOCKY_MEASURES:
            for bad in (True, "0.3", -.01, 1.01):
                with self.assertRaises(ValueError):
                    verdict({**full,field:bad})
        with self.assertRaises(ValueError):
            verdict(dict.fromkeys(animal_build.STOCKY_FIELDS, True))
        with self.assertRaises(ValueError):
            verdict({"bare_animal": True})

    def test_stocky_needs_two_of_three_reads_and_a_bare_build(self):
        def run(reads, build="bare"):
            answers = iter(reads)
            return animal_build.stocky(b"png", lambda png: next(answers), lambda png: build)
        self.assertTrue(run([True, True, True]))
        self.assertTrue(run([True, False, True]))
        self.assertFalse(run([True, False, False]))
        self.assertFalse(run([False, False, False]))
        self.assertFalse(run([True, True, True], build="dressed"))
        def failing(png):
            raise TimeoutError
        with self.assertRaises(TimeoutError):
            animal_build.stocky(b"png", failing, lambda png: "bare")
        with self.assertRaises(TimeoutError):
            animal_build.stocky(b"png", lambda png: True, failing)
        with self.assertRaises(ValueError):
            run([True, True, True], build="unknown")
        calls = []
        animal_build.stocky(b"png", lambda png: calls.append("read") or True, lambda png: calls.append("build") or "bare")
        self.assertEqual(sorted(calls), ["build", "read", "read", "read"])

    def test_existing_routes_and_unavailable_stocky_guide_use_the_original_layout(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            def layout(file):
                return file.name.encode()
            with patch.object(paint_portrait, "layout_png", side_effect=layout):
                for style in ("upright-character", "portrait-bust-coat", "armored-raccoon", "upright-animal"):
                    question = Mock(return_value=True)
                    file, guide = screened_layout(folder, style, b"png", question)
                    self.assertEqual((file.name, guide), ("male-coat-template.json", b"male-coat-template.json"))
                    question.assert_not_called()
                (folder/animal_build.STOCKY_TEMPLATE).touch()
                for style in ("upright-character", "portrait-bust-coat", "armored-raccoon"):
                    question = Mock(return_value=True)
                    self.assertEqual(screened_layout(folder, style, b"png", question)[0].name, "male-coat-template.json")
                    question.assert_not_called()
                for question in (None, Mock(return_value=False), Mock(side_effect=TimeoutError)):
                    self.assertEqual(screened_layout(folder, "upright-animal", b"png", question)[0].name,
                                     "male-coat-template.json")
                self.assertEqual(screened_layout(folder, "upright-animal", b"png", Mock(return_value=True))[0].name,
                                 animal_build.STOCKY_TEMPLATE)

    def test_stocky_rig_requires_the_original_bare_biped_screen_binding(self):
        source = sha256(b"portrait").hexdigest()
        def admit(style, requires):
            fit = dict(sourceSha256=source, declined=None, template=animal_build.STOCKY_TEMPLATE,
                       requiresPainting=requires, style=style)
            data = json.dumps(dict(version=1, fit=fit, templateSha256="1"*64)).encode()
            return admitted_rig("a"*32, data, sha256(data).hexdigest(), b"portrait", source)
        self.assertEqual(admit("upright-animal", True), (animal_build.STOCKY_TEMPLATE,"1"*64))
        for style, requires in (("upright-animal", False), ("armored-raccoon", True), ("upright-character", True)):
            with self.assertRaises(ValueError):
                admit(style, requires)

    def test_guide_has_forty_separate_parts_and_matching_rig_coordinates(self):
        template = WORKER/"stocky"/animal_build.STOCKY_TEMPLATE
        spec = json.loads(template.read_bytes())
        guide = paint_portrait.layout_png(template)
        self.assertEqual(list(spec["views"]), ["s","se","e","ne","n","nw","w","sw"])
        self.assertTrue(.30 <= (700-spec["rigConfig"]["hip_y"])/700 <= .35)
        with Image.open(BytesIO(guide)) as image:
            self.assertEqual(list(image.size), spec["canvas"])
            for parts in spec["views"].values():
                self.assertEqual(set(parts), {"body","arm0","arm1","leg0","leg1"})
                for part in parts.values():
                    x,y,w,h = part["guideRect"]
                    l,t,r,b = part["slot"]
                    self.assertTrue(l < x < x+w < r and t < y < y+h < b)
                    alpha = image.crop((x,y,x+w,y+h)).getchannel("A")
                    self.assertGreater(alpha.getextrema()[1], 240)
                    x0,y0,x1,y1 = part["virtualBox"]
                    self.assertEqual([x1-x0,y1-y0], part["sourceSize"])
                    for jx,jy in part["joints"] or ():
                        self.assertGreater(alpha.getpixel((int((jx-x0)*w/(x1-x0)),int((jy-y0)*h/(y1-y0)))), 128)

    def test_repairs_replay_first_stocky_prompt_flag_and_old_jobs_keep_the_old_prompt(self):
        image = BytesIO()
        Image.new("RGBA", (1536,960)).save(image, "PNG")
        import base64
        response = {"data":[{"b64_json":base64.b64encode(image.getvalue()).decode()}]}
        with TemporaryDirectory() as tmp, patch.object(paint_portrait, "edit_request",
                side_effect=lambda *a, **flags: flags) as request:
            root = Path(tmp)
            template = root/"template.json"
            template.write_bytes(b"template")
            for first in (False, True):
                job = root/str(first)
                for attempt, requested in ((1,first),(2,not first)):
                    painter = paint_portrait.costume_painter(job, "a"*32, Mock(return_value=True),
                        Mock(return_value=("test",response)), upright_animal=True, bare_animal=True, stocky=requested)
                    painter(root/"portrait","1"*64,template,attempt,None if attempt == 1 else "repair leg")
                    self.assertEqual(request.call_args.kwargs.get("stocky",False), first)
                    self.assertEqual(request.call_args.kwargs.get("stocky_feet",False), first)
                    self.assertEqual(request.call_args.kwargs.get("tail_fit",False), not first)
                receipts = [json.loads((job/f"edit-{i}/completed.json").read_bytes())["binding"] for i in (1,2)]
                self.assertEqual(*receipts)
            # Replay a stocky edit sealed before the individual foot prompt existed.
            for attempt in (1,2):
                receipt = root/f"True/edit-{attempt}/completed.json"
                saved = json.loads(receipt.read_bytes())
                del saved["binding"]["stockyFeet"]
                receipt.write_text(json.dumps(saved))
            painter(root/"portrait","1"*64,template,3,"repair leg")
            self.assertTrue(request.call_args.kwargs["stocky"])
            self.assertNotIn("stocky_feet",request.call_args.kwargs)


if __name__ == "__main__":
    unittest.main()
