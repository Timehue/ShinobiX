from gzip import compress, decompress
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch
from zipfile import ZipFile

from avatar_worker import motion_delivery as delivery
from avatar_worker.motion_delivery import without_encoder_banner


class EncoderBannerTest(TestCase):
    def test_only_a_standalone_encoder_identification_is_removed(self):
        uuid = bytes.fromhex("dc45e9bde6d948b7962cd820d923eeef")
        text = uuid + b"x264 - core 164 " + b"x" * 280 + b"\0"
        prefix = b"\0\0\1\x06\x05"
        length = b"\xff" + bytes([len(text) - 255])
        message = prefix + length + text
        banner = message + b"\x80"
        first_frame = b"\0\0\0\1\x09\x10"
        slice_data = b"\0\0\1\x65\x88"
        self.assertEqual(without_encoder_banner(first_frame + banner + slice_data), first_frame + slice_data)
        for other in (message + b"\x01\x01\x07\x80", banner.replace(uuid, b"z" * 16),
                      banner.replace(length, b"\xff\x02"), banner.replace(b"\x06\x05", b"\x06\x04")):
            encoded = first_frame + other + slice_data
            self.assertEqual(without_encoder_banner(encoded), encoded)

    def test_only_oversized_revisions_are_repacked_and_every_reference_is_rehashed(self):
        with TemporaryDirectory() as temporary:
            work = Path(temporary)
            portrait, asset = "a" * 64, "b" * 32
            text = bytes.fromhex("dc45e9bde6d948b7962cd820d923eeef") + b"x264 - core 164 " + b"x" * 200 + b"\0"
            picture = b"\0\0\1\x65\x88"
            raw = b"\0\0\1\x06\x05" + bytes([len(text)]) + text + b"\x80" + picture
            video = work / "body.264"
            video.write_bytes(raw)
            clip = dict(file="body.webp", cell=[1, 1], cols=1, sha256="c" * 64, origins=[[0, 0]], count=1)
            model = dict(portrait=portrait, directions=delivery.DIRECTIONS, heightFraction=.068, sprintStyle="A")
            cache = dict(directions=delivery.DIRECTIONS, pages={"body.webp": dict(file=video.name, cell=[1, 1],
                         frames=1, bytes=len(raw), sha256=sha256(raw).hexdigest())})
            for field in ("banks", "styleBBanks", "styleCBanks"):
                model[field] = [{"idle": clip}] * 8
                cache[field] = [{"idle": {k: clip[k] for k in ("file", "origins", "count")}}] * 8
            archive = work / "source.zip"
            with ZipFile(archive, "w") as writer:
                writer.writestr("roster-study.json", json.dumps(model))
            cache["sourceArchiveSha256"] = sha256(archive.read_bytes()).hexdigest()
            (work / "movement.json.gz").write_bytes(compress(json.dumps(cache).encode()))
            plain = delivery.stage_motion(archive, work, asset, portrait, work / "plain")
            with patch.object(delivery, "MAX_MOTION_BYTES", plain["bytes"] - 1):
                compact = delivery.stage_motion(archive, work, asset, portrait, work / "compact")
            self.assertLess(compact["bytes"], plain["bytes"])
            self.assertNotEqual(compact["version"], plain["version"])
            for folder, result, expected in [("plain", plain, raw), ("compact", compact, picture)]:
                root = work / folder / "players" / asset
                manifest = json.loads((root / (result["version"] + ".json")).read_bytes())
                for indexes in manifest["styles"].values():
                    for shard in set(indexes):
                        body = (root / shard).read_bytes()
                        self.assertEqual(sha256(body).hexdigest() + ".gz", shard)
                        page = json.loads(decompress(body))["pages"]["body.webp"]["file"]
                        self.assertEqual(page, sha256(expected).hexdigest() + ".264")
                        self.assertEqual((root / page).read_bytes(), expected)
            with patch.object(delivery, "MAX_MOTION_BYTES", compact["bytes"] - 1):
                with self.assertRaisesRegex(ValueError, "needs"):
                    delivery.stage_motion(archive, work, asset, portrait, work / "rejected")
            self.assertFalse((work / "rejected").exists())
