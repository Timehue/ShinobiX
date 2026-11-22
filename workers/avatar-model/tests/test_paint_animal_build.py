"""A bare animal is painted bare and keeps its legs; a dressed animal (the armored raccoon, a tiger in a coat)
paints exactly as before and keeps its legs; a human paints exactly as before and its legs are slimmed."""
from contextlib import ExitStack
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import types
import unittest
from unittest.mock import Mock, patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import animal_build
import modal
import paint_portrait


def answer(text, model=animal_build.MODEL):
    return {"status": "completed", "model": model, "error": None, "incomplete_details": None,
            "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}]}


class AnimalBuildQuestionTest(unittest.TestCase):
    def test_the_answer_names_the_build(self):
        self.assertEqual(animal_build.verdict(answer('{"wears":"nothing","dressed":false}')), "bare")
        self.assertEqual(animal_build.verdict(answer('{"wears":"blue coat and armor","dressed":true}')), "dressed")

    def test_anything_but_one_complete_answer_raises(self):
        for response in (answer('{"wears":"x","dressed":"no"}'), answer('{"dressed":false}'),
                         answer('{"wears":"","dressed":false}'), answer('{"wears":"x","dressed":false}', model="other"),
                         {**answer('{"wears":"x","dressed":false}'), "status": "incomplete"}, None):
            with self.subTest(response=response), self.assertRaises(ValueError):
                animal_build.verdict(response)

    def test_the_build_is_asked_once_per_job_and_a_failure_paints_dressed(self):
        with TemporaryDirectory() as temporary:
            work = Path(temporary)
            asker = Mock(return_value="bare")
            self.assertEqual(animal_build.decide(work, b"png", asker), "bare")
            self.assertEqual(animal_build.decide(work, b"png", asker), "bare")  # A second round asks nothing.
            asker.assert_called_once()
        for failure in (ValueError("animal-build-provider-500"), "unsure"):
            with TemporaryDirectory() as temporary, self.subTest(failure=failure):
                work = Path(temporary)
                broken = Mock(side_effect=failure) if isinstance(failure, Exception) else Mock(return_value=failure)
                self.assertEqual(animal_build.decide(work, b"png", broken), "dressed")
                # Kept, so a repair replays the prompt its first painting was billed with.
                later = Mock(return_value="bare")
                self.assertEqual(animal_build.decide(work, b"png", later), "dressed")
                later.assert_not_called()


class BarePromptTest(unittest.TestCase):
    def prompt(self, **flags):
        portrait = BytesIO()
        Image.new("RGB", (64, 64), (20, 160, 60)).save(portrait, "PNG")
        prepared = types.SimpleNamespace(png=portrait.getvalue(), source_sha256="1" * 64)
        module = types.ModuleType("avatar_worker.portrait")
        module.prepare_portrait = lambda raw: prepared
        with TemporaryDirectory() as temporary, \
                patch.dict(sys.modules, {"avatar_worker": types.ModuleType("avatar_worker"),
                                         "avatar_worker.portrait": module}):
            root = Path(temporary)
            (root / "portrait").write_bytes(b"raw")
            guide = BytesIO()
            Image.new("RGBA", (64, 40), (90, 90, 90, 255)).save(guide, "PNG")
            template = root / "male-coat-template.json"
            template.with_suffix(".png").write_bytes(guide.getvalue())
            template.write_text(json.dumps({"guideSha256": sha256(guide.getvalue()).hexdigest(),
                                            "views": {"s": {"body": {"guideRect": [0, 0, 32, 40]}}}}))
            return paint_portrait.edit_request(root / "portrait", "1" * 64, template, None, **flags)["prompt"]

    def test_only_a_bare_animal_is_told_to_paint_its_own_body_and_feet(self):
        bare = self.prompt(upright_animal=True, tail_fit=True, bare_animal=True)
        dressed = self.prompt(upright_animal=True, tail_fit=True)
        human = self.prompt()
        self.assertIn(paint_portrait.BARE_ANIMAL, bare)
        self.assertNotIn(paint_portrait.BARE_ANIMAL, dressed)
        self.assertNotIn(paint_portrait.BARE_ANIMAL, human)
        self.assertEqual(bare.replace(paint_portrait.BARE_ANIMAL, ""), dressed)
        for words in ("in place of a boot", "never a skirt or a coat hem", "Add no boots"):
            self.assertIn(words, paint_portrait.BARE_ANIMAL)

    def test_the_bare_line_is_bound_to_the_painting_it_was_billed_with(self):
        art = BytesIO()
        Image.new("RGBA", (1536, 960), (0, 0, 0, 0)).save(art, "PNG")
        result = {"data": [{"b64_json": __import__("base64").b64encode(art.getvalue()).decode()}], "usage": None}
        with TemporaryDirectory() as temporary, \
                patch.object(paint_portrait, "edit_request", side_effect=lambda *a, **k: {"k": sorted(k)}) as build:
            root = Path(temporary)
            template = root / "template.json"
            template.write_bytes(b"template")
            for label, flags in (("bare", {"upright_animal": True, "bare_animal": True}),
                                 ("dressed", {"upright_animal": True}), ("human", {})):
                with self.subTest(label=label):
                    painter = paint_portrait.costume_painter(root / label, "6" * 32, Mock(return_value=True),
                                                             Mock(return_value=("fixture", result)), **flags)
                    painter(root / "portrait", "1" * 64, template, 1, None)
                    self.assertEqual(build.call_args.kwargs.get("bare_animal", False), label == "bare")
                    binding = json.loads((root / label / "edit-1/completed.json").read_bytes())["binding"]
                    self.assertEqual(binding.get("bareAnimal", False), label == "bare")


class PaintStepTest(unittest.TestCase):
    """paint_admitted_costume asks the build question only for an upright animal, and only a bare one is painted bare."""

    def painter_flags(self, style, build):
        import paint_admitted_costume
        portrait = b"private portrait"
        source = sha256(portrait).hexdigest()
        fit = {"sourceSha256": source, "template": "male-coat-template.json", "declined": None, "requiresPainting": True}
        if style:
            fit["style"] = style
        descriptor = json.dumps({"version": 1, "templateSha256": sha256(b"rig").hexdigest(), "fit": fit}).encode()
        seen = {}
        kit = types.ModuleType("register_painted_kit")
        kit.PaintingGeometryError = type("PaintingGeometryError", (ValueError,), {})
        kit.paint_screened_upload = lambda *a, **k: None
        prepared = types.ModuleType("avatar_worker.portrait")
        prepared.prepare_portrait = lambda raw: types.SimpleNamespace(png=b"png")
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "rig.json").write_bytes(b"rig")
            (root / "male-coat-template.json").write_bytes(b"rig")
            paths = types.ModuleType("motion_worker_paths")
            paths.TEMPLATES = root
            work = root / "work"
            work.mkdir()
            (work / "portrait").write_bytes(portrait)
            (work / "screened.json").write_bytes(descriptor)
            entry = root / "entry.py"
            entry.write_text("")
            with patch.dict(sys.modules, {"register_painted_kit": kit, "motion_worker_paths": paths,
                                          "avatar_worker": types.ModuleType("avatar_worker"),
                                          "avatar_worker.portrait": prepared}), \
                    patch.object(paint_portrait, "costume_painter",
                                 side_effect=lambda *a, **k: seen.update(k) or (lambda *x: None)):
                paint_admitted_costume.paint(entry, work, "5" * 32, sha256(descriptor).hexdigest(), source, None,
                                             Mock(), build=build)
        return seen

    def test_only_a_bare_upright_animal_is_painted_bare(self):
        for label, style, answer_, bare in (("bare dinosaur", "upright-animal", "bare", True),
                                            ("tiger in a coat", "upright-animal", "dressed", False),
                                            ("armored raccoon", "armored-raccoon", "bare", False),
                                            ("two-legged person", "upright-character", "bare", False),
                                            ("close-up human", None, "bare", False)):
            with self.subTest(label=label):
                asker = Mock(return_value=answer_)
                flags = self.painter_flags(style, asker)
                self.assertEqual(flags.get("bare_animal", False), bare)
                self.assertEqual(flags["upright_animal"], style == "upright-animal")
                self.assertEqual(asker.called, style == "upright-animal")  # Nobody else is asked anything.

    def test_a_failed_question_paints_the_animal_as_before(self):
        flags = self.painter_flags("upright-animal", Mock(side_effect=ValueError("animal-build-provider-500")))
        self.assertNotIn("bare_animal", flags)


class LegBuildTest(unittest.TestCase):
    """The costume call records an animal; each style render reads it for its exact fitted master."""

    def service(self):
        with patch.dict("os.environ", SPRITE_PAINTED_COSTUMES="1"), patch.object(modal, "is_local", return_value=False):
            import modal_sprite_worker as service
        return service

    def paint(self, fit):
        service = self.service()
        portrait = b"private portrait"
        source = sha256(portrait).hexdigest()
        metadata = json.dumps({"version": 1, "templateSha256": "a" * 64, "fit": {
            "sourceSha256": source, "template": "male-coat-template.json", "declined": None, **fit}}).encode()
        asset, painted = "5" * 32, "c" * 64
        stores = {}

        class Store:
            def __init__(self, name):
                self.rows = stores.setdefault(name, {})

            def put(self, key, value, *, skip_if_exists=False):
                if skip_if_exists and key in self.rows:
                    return False
                self.rows[key] = value
                return True

            def get(self, key, default=None):
                return self.rows.get(key, default)

        def run(command, *, check, timeout=None):
            work = Path(command[3])
            if Path(command[1]).name == "paint_admitted_costume.py":
                out = work / "painted"
                out.mkdir()
                (out / "read.json").write_text(json.dumps({"fittedMasterSha256": painted}))
                (out / "fitted-master.json").write_bytes(b"descriptor")
                (out / "candidate.png").write_bytes(b"sheet")

        with TemporaryDirectory() as temp, ExitStack() as stack:
            installation = Path(temp)
            (installation / "entry.txt").write_text(str(installation / "entry.py"))
            stack.enter_context(patch.object(service, "INSTALL", installation))
            stack.enter_context(patch.object(modal.Dict, "from_name", side_effect=lambda name, **_: Store(name)))
            stack.enter_context(patch.object(modal, "current_function_call_id", return_value="fc-first"))
            stack.enter_context(patch.object(service, "paint_battle_sprite", return_value=[]))
            stack.enter_context(patch.object(subprocess, "run", side_effect=run))
            service.paint_costume.local(asset, metadata, sha256(metadata).hexdigest(), portrait, source)
            return (service.painted_legs(asset, painted), service.painted_legs(asset, "d" * 64),
                    stores.get(service.LEG_BUILDS, {}))

    def test_every_animal_keeps_its_painted_legs_and_nothing_else_does(self):
        for label, fit, kept in (("bare or dressed animal", {"requiresPainting": True, "style": "upright-animal"}, True),
                                 ("armored raccoon", {"requiresPainting": True, "style": "armored-raccoon"}, True),
                                 ("two-legged person", {"requiresPainting": True, "style": "upright-character"}, False),
                                 ("photo-fitted human", {}, False)):
            with self.subTest(label=label):
                same_master, other_master, rows = self.paint(fit)
                self.assertEqual(same_master, kept)
                self.assertFalse(other_master)  # A different fitted master of the same asset renders as usual.
                self.assertEqual(bool(rows), kept)

    def test_an_unreadable_store_fails_the_render_instead_of_mixing_leg_widths(self):
        service = self.service()
        broken = Mock(side_effect=RuntimeError("store down"))
        with patch.object(modal.Dict, "from_name", broken), patch.object(service.time, "sleep"):
            with self.assertRaisesRegex(ValueError, "leg-build-unavailable"):
                service.painted_legs("5" * 32, "c" * 64)
        for entry in (None, "text", {"master": "c" * 64}, {"master": "c" * 64, "legs": "slim"}):
            store = type("Store", (), {"get": lambda self, key, default=None, entry=entry: entry})()
            with self.subTest(entry=entry), patch.object(modal.Dict, "from_name", return_value=store):
                self.assertFalse(service.painted_legs("5" * 32, "c" * 64))

    def test_the_style_render_sets_the_leg_width_for_its_processes(self):
        import os
        import paint_sprite_style
        seen = []

        def stop(*_args, **_kwargs):
            seen.append(os.environ.get("SHINOBIX_LEG_SLIM"))
            raise RuntimeError("stop before rendering")

        fake = types.ModuleType("make_masked_avatar")
        fake.read_fitted_master, fake.bake_style, fake.TEMPLATES = stop, stop, None
        revision = types.ModuleType("package_motion_worker")
        revision.movement_revision = lambda blender: "r"
        walk = types.ModuleType("shared_walk_batches")
        walk.use_for_job = lambda cache: False
        with TemporaryDirectory() as temporary, \
                patch.dict(sys.modules, {"make_masked_avatar": fake, "package_motion_worker": revision,
                                         "shared_walk_batches": walk}), \
                patch.dict(os.environ, {"SHINOBIX_LEG_SLIM": "stale"}):
            entry = Path(temporary) / "entry.py"
            entry.write_text("")
            for painted_legs, expected in ((True, "1"), (False, None)):
                with self.subTest(painted_legs=painted_legs), self.assertRaisesRegex(RuntimeError, "stop"):
                    paint_sprite_style.paint(entry, Path("m"), "c" * 64, "A", Path("b"), Path(temporary),
                                             painted_legs=painted_legs)
        self.assertEqual(seen, ["1", None])


if __name__ == "__main__":
    unittest.main()
