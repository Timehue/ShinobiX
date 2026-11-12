from gzip import compress
from hashlib import sha256
from importlib.util import module_from_spec, spec_from_file_location
from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parents[3]
spec = spec_from_file_location("sector_model_release", ROOT / "scripts/sector-model-release.py")
release = module_from_spec(spec)
spec.loader.exec_module(release)


class RosterReleaseTest(unittest.TestCase):
    def package(self, root, slug="patrol"):
        client, content = root / "client", root / "content"
        pins, folder = client / "src/data/sector-models", content / slug
        pins.mkdir(parents=True); folder.mkdir(parents=True)
        portrait = client / "public/portrait.webp"
        portrait.parent.mkdir(); portrait.write_bytes(b"unit-test portrait")
        def write(data, suffix):
            name = sha256(data).hexdigest() + suffix
            (folder / name).write_bytes(data)
            return name
        page = write(b"unit-test pose packet", ".264")
        pose = {"file": "page", "count": 1, "origins": [[0, 0]], "period": 1}
        clips = {key: pose for key in ("idle", "walk", "run", "start-walk", "start-run", "pivot")}
        for source, target in (("walk", "idle"), ("run", "idle"), ("walk", "run"), ("run", "walk")):
            clips[source + "-" + target] = dict(pose, source=source, target=target)
        index = write(compress(json.dumps({"clips": clips, "pages": {"page": {
            "file": page, "frames": 1, "cols": 1, "cell": [2, 2]}}}).encode()), ".gz")
        portrait_hash = sha256(portrait.read_bytes()).hexdigest()
        version = write(json.dumps({"format": "sector-motion-v2", "mapWidth": 1080, "heightFraction": .068,
            "portraitSha256": portrait_hash, "directions": ["s", "se", "e", "ne", "n", "nw", "w", "sw"],
            "styles": {style: [index] * 8 for style in "ABC"}}).encode(), ".json")[:-5]
        (pins / (slug + ".json")).write_text(json.dumps({"portrait": "public/portrait.webp",
            "portraitSha256": portrait_hash, "manifestSha256": version}))
        if slug == "hollow-hound":
            art = {key: write(b"unit-test " + key.encode(), ".webp") for key in ("idle", "still")}
            (client / "src/data/hollow-hound-encounter.json").write_text(json.dumps(art))
        return client, content, folder, page

    def test_plan_is_deterministic_public_only_and_exports_idempotently(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp); client, content, _, _ = self.package(root)
            plan = release.build_release(client, content, 1)
            self.assertEqual(plan["sha256"], release.build_release(client, content, 1)["sha256"])
            self.assertEqual(len(plan["objects"]), 3)
            self.assertTrue(all(key.startswith("sector-models/patrol/") for key in plan["objects"]))
            release.export_release(plan, root / "export")
            release.export_release(plan, root / "export")
            self.assertEqual((root / "export/release.json").read_bytes(), plan["reportBytes"])

    def test_missing_or_changed_dependencies_and_portraits_fail_before_export(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp); client, content, folder, page = self.package(root)
            with self.assertRaises(ValueError): release.build_release(client, content, 53)
            (folder / page).write_bytes(b"changed")
            with self.assertRaises(ValueError): release.build_release(client, content, 1)
            (client / "public/portrait.webp").write_bytes(b"changed")
            with self.assertRaises(ValueError): release.build_release(client, content, 1)

    def test_hound_encounter_assets_are_not_lost_outside_the_motion_graph(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp); client, content, _, _ = self.package(root, "hollow-hound")
            plan = release.build_release(client, content, 1)
            self.assertEqual(len(plan["objects"]), 5)
            self.assertEqual(sum(key.endswith(".webp") for key in plan["objects"]), 2)

    def test_another_plan_cannot_mix_new_files_into_an_existing_export(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp); client, content, _, _ = self.package(root)
            plan = release.build_release(client, content, 1)
            output = root / "export"; output.mkdir()
            (output / "release.json").write_bytes(b"a different release")
            with self.assertRaises(ValueError): release.export_release(plan, output)
            self.assertFalse((output / "sector-models").exists())

    def test_publication_rejects_a_different_plan_before_credentials_or_network(self):
        with TemporaryDirectory() as tmp:
            client, content, _, _ = self.package(Path(tmp))
            plan = release.build_release(client, content, 1)
            with patch.object(release, "build_release", return_value=plan), patch("publish_sprite.public_destination") as destination:
                with self.assertRaises(ValueError):
                    release.main(["--content", str(content), "--publish", "--reviewed-plan", "0" * 64])
                destination.assert_not_called()

    def test_public_readback_failure_never_publishes_a_root_manifest(self):
        class Bucket:
            def __init__(self, corrupt=False): self.objects = {}; self.order = []; self.corrupt = corrupt
            def put_object(self, *, Bucket, Key, Body, ContentType, CacheControl, IfNoneMatch):
                assert "no-transform" in CacheControl
                assert IfNoneMatch == "*"
                if Key in self.objects:
                    raise ClientError({"Error":{"Code":"PreconditionFailed"}}, "PutObject")
                self.objects[Key] = Body; self.order.append(Key)
            def get_object(self, *, Bucket, Key):
                data = b"!" if self.corrupt else self.objects[Key]
                return {"Body": BytesIO(data), "ContentLength": len(data)}
        with TemporaryDirectory() as tmp:
            client, content, _, _ = self.package(Path(tmp)); plan = release.build_release(client, content, 1)
            failed = Bucket(corrupt=True)
            with self.assertRaises(ValueError): release.publish_release(plan, failed, "test")
            self.assertFalse(any(key.endswith(".json") for key in failed.order))
            good = Bucket(); release.publish_release(plan, good, "test")
            self.assertTrue(good.order[-1].endswith(".json"))
            self.assertEqual(good.objects, {key: value["data"] for key, value in plan["objects"].items()})
            writes = list(good.order)
            release.publish_release(plan, good, "test")
            self.assertEqual(good.order, writes, "A verified replay leaves existing objects untouched")
            conflict = Bucket()
            key = next(key for key in plan["objects"] if key.endswith(".264"))
            conflict.objects[key] = b"conflicting existing object"
            with self.assertRaisesRegex(ValueError, "read-back mismatch"):
                release.publish_release(plan, conflict, "test")
            self.assertEqual(conflict.objects[key], b"conflicting existing object")
            self.assertFalse(any(key.endswith(".json") for key in conflict.order))


if __name__ == "__main__":
    unittest.main()
