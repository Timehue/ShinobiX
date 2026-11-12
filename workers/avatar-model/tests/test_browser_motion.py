from gzip import compress
from hashlib import sha256
import json
from io import BytesIO
from pathlib import Path
import shutil
import sys
from tempfile import TemporaryDirectory
from threading import Barrier
import unittest
from unittest.mock import patch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from browser_motion import ATLAS_BYTES, DIRECTIONS, INDEX_BYTES, PAGE_BYTES, browser_motion_objects, worker_delivery_objects
from finish_sprite import add_battle_sprite
from render_admitted_sprite import recover_delivery
from publish_sprite import publish_worker_result


class BrowserDeliveryTest(unittest.TestCase):
    def package(self, directory, *, video_size=1, cell=(1, 1), index_padding=0):
        def write(data, extension):
            name = sha256(data).hexdigest() + extension
            (directory / name).write_bytes(data)
            return name

        page = write(bytes(video_size), ".264")
        pose = dict(file="shared", count=1, origins=[[0, 0]], period=1)
        clips = {name: pose for name in ("idle", "walk", "run", "start-walk", "start-run", "pivot")}
        for source, target in (("walk", "idle"), ("run", "idle"), ("walk", "run"), ("run", "walk")):
            clips[source + "-" + target] = dict(pose, source=source, target=target)
        bank = dict(clips=clips, pages={"shared": dict(file=page, frames=1, cols=1, cell=cell)})
        # The uncompressed DEFLATE level makes the index length deterministic.
        index = write(compress(json.dumps(bank).encode() + b" " * index_padding, compresslevel=0), ".gz")
        model = dict(format="sector-motion-v2", portraitSha256="a" * 64, mapWidth=1080,
                     heightFraction=.068, directions=DIRECTIONS, styles={s: [index] * 8 for s in "ABC"})
        manifest = write(json.dumps(model).encode(), ".json")
        return manifest[:-5], (index, page, manifest)

    def test_battle_sprite_is_bound_to_the_revision_and_preserves_the_recognized_frame(self):
        with TemporaryDirectory() as temp:
            directory = Path(temp)
            version, _ = self.package(directory)
            portrait = "a" * 64
            objects = browser_motion_objects(directory, version, portrait)
            model = dict(assetId="1" * 32, version=version, objects=len(objects), bytes=sum(map(len, objects.values())))
            pose = Image.new("RGBA", (20, 30))
            pose.paste((110, 45, 220, 255), (2, 0, 18, 30))
            with patch("recognition_lineup.posed_views", return_value=[(pose, (-10, -30))]) as extract:
                result = add_battle_sprite(directory, model, objects, portrait, "ffmpeg")
            extract.assert_called_once_with(dict(model=model, objects=objects), portrait, "ffmpeg", "idle", 0, ("sw",))
            self.assertNotEqual(result["version"], version)
            self.assertEqual(browser_motion_objects(directory, version, portrait), objects)
            package = browser_motion_objects(directory, result["version"], portrait)
            manifest = result["version"] + ".json"
            sprite = json.loads(package[manifest])["battleSprite"]
            self.assertEqual(list(package)[-2:], [sprite, manifest])
            self.assertEqual(result["objects"], len(package))
            self.assertEqual(result["bytes"], sum(map(len, package.values())))
            with Image.open(BytesIO(package[sprite])) as decoded:
                self.assertEqual(decoded.tobytes(), pose.tobytes())
            (directory / sprite).write_bytes(b"damaged")
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                browser_motion_objects(directory, result["version"], portrait)

    def test_public_readback_failure_and_retry(self):
        class Bucket:
            def __init__(self):
                self.objects = {}
                self.corrupt = True
                self.pages_read = set()
                self.concurrent_reads = Barrier(2)

            def put_object(self, *, Bucket, Key, Body, ContentType, CacheControl, IfNoneMatch):
                from botocore.exceptions import ClientError
                assert IfNoneMatch == "*"
                if Key in self.objects:
                    raise ClientError({"Error":{"Code":"PreconditionFailed"}}, "PutObject")
                if Key.endswith(".json") and len(self.pages_read) != 2:
                    raise AssertionError("Manifest visible before both dependencies were verified")
                self.objects[Key] = Body

            def get_object(self, *, Bucket, Key):
                if Key.endswith('/_revoked.json') and Key not in self.objects:
                    from botocore.exceptions import ClientError
                    raise ClientError({'Error':{'Code':'NoSuchKey'}},'GetObject')
                data = self.objects[Key]
                if not Key.endswith(".json"):
                    self.concurrent_reads.wait(timeout=5)
                if self.corrupt and Key.endswith(".264"):
                    data = b"!"
                elif not Key.endswith(".json"):
                    self.pages_read.add(Key)
                return {"Body": BytesIO(data), "ContentLength": len(data)}

        with TemporaryDirectory() as temp:
            directory = Path(temp)
            version, names = self.package(directory)
            objects = {name: (directory / name).read_bytes() for name in names}
            asset = "f" * 32
            model = dict(assetId=asset, version=version, objects=len(objects), bytes=sum(map(len, objects.values())))
            result = dict(model=model, objects=objects)
            bucket = Bucket()
            args = (result, asset, "a" * 64, bucket, "public-test")
            with self.assertRaisesRegex(ValueError, "read-back"):
                publish_worker_result(*args)
            self.assertFalse(any(name.endswith(".json") for name in bucket.objects))
            bucket.corrupt = False
            for _ in range(2):
                bucket.pages_read.clear()
                self.assertEqual(publish_worker_result(*args), model)
                self.assertEqual(bucket.objects, {f"sector-models/players/{asset}/{n}": objects[n] for n in names})

    def test_retrieved_result_is_bound_to_its_job_and_contains_only_public_objects(self):
        with TemporaryDirectory() as temp:
            directory = Path(temp)
            version, names = self.package(directory)
            payload = {name: (directory / name).read_bytes() for name in reversed(names)}
            model = dict(assetId="f"*32, version=version, bytes=sum(map(len, payload.values())), objects=3)
            result = dict(model=model, objects=payload)
            self.assertEqual(tuple(worker_delivery_objects(result, "f"*32, "a"*64)), names)
            private = {**payload, "../source.png": b"private"}
            for package, target, portrait in [
                (result, "e"*32, "a"*64), (result, "f"*32, "b"*64),
                (dict(model=dict(model, objects=4, bytes=model["bytes"]+7), objects=private), "f"*32, "a"*64),
                (dict(model=model, objects={**payload, names[1]:b"bad"}), "f"*32, "a"*64),
                (dict(model=dict(model, bytes=10), objects=payload), "f"*32, "a"*64),
            ]:
                with self.subTest(target=target, portrait=portrait), self.assertRaises(ValueError):
                    worker_delivery_objects(package, target, portrait)

    def test_shared_pages_fit_exact_limits_and_manifest_is_last(self):
        with TemporaryDirectory() as temp:
            directory = Path(temp)
            version, names = self.package(directory, video_size=PAGE_BYTES, cell=(1024, ATLAS_BYTES // 4096))
            self.assertEqual(tuple(browser_motion_objects(directory, version, "a" * 64)), names)
            (directory / names[1]).write_bytes(b"corrupt")
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                browser_motion_objects(directory, version, "a" * 64)

    def test_interrupted_repair_reuses_pages_and_publishes_only_the_expected_revision(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "reviewed"
            source.mkdir()
            version, names = self.package(source)
            ref = dict(assetId="1" * 32, version=version)
            result = dict(gameModel=ref, sourceSha256="a" * 64, fittedMasterSha256="b" * 64,
                          archiveSha256="c" * 64)
            destination = root / "result"
            public = destination / "sector-models/players" / ref["assetId"]
            public.mkdir(parents=True)
            writes = []

            def record_write(path, data):
                writes.append(path.name)
                path.write_bytes(data)

            def encode(*args, **kwargs):
                shutil.copytree(source, args[6] / "players" / ref["assetId"])
                return ref

            def interrupt(path, data):
                if writes:
                    raise OSError("worker stopped")
                record_write(path, data)

            with patch("render_admitted_sprite.finish", return_value=dict(version="0" * 64)):
                with self.assertRaisesRegex(ValueError, "original encoder"):
                    recover_delivery(None, result, destination, record_write)
                self.assertEqual(list(public.iterdir()), [])
            with patch("render_admitted_sprite.finish", side_effect=encode) as finalizer:
                with self.assertRaisesRegex(OSError, "worker stopped"):
                    recover_delivery(None, result, destination, interrupt)
                self.assertFalse((public / names[-1]).exists())
                self.assertEqual(recover_delivery(None, result, destination, record_write), ref)
                self.assertEqual(recover_delivery(None, result, destination, record_write), ref)
                self.assertEqual(writes, list(names))
                self.assertEqual(finalizer.call_count, 2)

    def test_individual_limits_reject_packages_that_fit_total_download_budget(self):
        for options, message in [
            (dict(video_size=PAGE_BYTES + 1), "delivery budget"),
            (dict(index_padding=INDEX_BYTES), "delivery budget"),
            (dict(cell=(1024, ATLAS_BYTES // 4096 + 1)), "atlas memory"),
        ]:
            with self.subTest(options=options), TemporaryDirectory() as temp:
                directory = Path(temp)
                version, _ = self.package(directory, **options)
                with self.assertRaisesRegex(ValueError, message):
                    browser_motion_objects(directory, version, "a" * 64)
