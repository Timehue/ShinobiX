import hashlib
import importlib.util
from io import BytesIO
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile
from PIL import Image


spec = importlib.util.spec_from_file_location("sector_model", Path(__file__).with_name("import-sector-model.py"))
sector_model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sector_model)


class PlayerSectorPackage(unittest.TestCase):
    def test_corrupt_sheet_cannot_replace_an_equipped_revision(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            digest = hashlib.sha256(b"portrait").hexdigest()
            model = dict(portrait=digest, heightFraction=.068, directions=sector_model.DIRECTIONS, sprintStyle="A")
            sheets = {}
            for style, field in enumerate(("banks", "styleBBanks", "styleCBanks")):
                view = {}
                for gait, (count, speed) in sector_model.GAITS.items():
                    label = str(style) if gait == "run" else ""
                    filename = gait + label + ".webp"
                    image = Image.new("RGBA", (count, 2), (60 + (style if gait == "run" else 0)*60, 90, 70, 128))
                    buf = BytesIO()
                    image.save(buf, format="WEBP", lossless=True)
                    sheets[filename] = buf.getvalue()
                    view[gait] = dict(file=filename, sha256=hashlib.sha256(sheets[filename]).hexdigest(),
                                      firstCell=0, count=count, speed=speed, period=1, cell=[1,2],
                                      cols=count, origins=[[0,0]]*count)
                model[field] = [view]*8
            archive = root / "worker.zip"
            def write_archive():
                with ZipFile(archive, "w") as bundle:
                    bundle.writestr("roster-study.json", json.dumps(model))
                    for name, data in sheets.items():
                        bundle.writestr(name, data)
            write_archive()
            content = root / "art"
            asset_id = "ab"*16
            ref = sector_model.stage_player(archive, asset_id, digest, content)
            folder = content / "players" / asset_id
            before = {p.name: p.read_bytes() for p in folder.iterdir()}
            self.assertIn(ref["version"]+".json", before)
            sheets["run2.webp"] = sheets["run0.webp"]
            write_archive()
            with self.assertRaisesRegex(ValueError, "metadata"):
                sector_model.stage_player(archive, asset_id, digest, content)
            self.assertEqual(before, {p.name: p.read_bytes() for p in folder.iterdir()})

    def test_finished_job_and_rejections(self):
        if not os.environ.get("SECTOR_MODEL_WORKER_ZIP"):
            self.skipTest("Set SECTOR_MODEL_WORKER_ZIP and SECTOR_MODEL_WORKER_PORTRAIT to an actual completed job")
        archive = Path(os.environ["SECTOR_MODEL_WORKER_ZIP"])
        portrait = Path(os.environ["SECTOR_MODEL_WORKER_PORTRAIT"])
        asset_id = "123456789abcdef0123456789abcdef0"
        with TemporaryDirectory() as tmp, ZipFile(archive) as source:
            root = Path(tmp)
            content = root / "content"
            digest = hashlib.sha256(portrait.read_bytes()).hexdigest()
            with self.assertRaises(ValueError):
                sector_model.stage_player(archive, asset_id, hashlib.sha256(b"different upload").hexdigest(), content)
            with self.assertRaises(ValueError):
                sector_model.stage_player(archive, "../escape", digest, content)
            self.assertFalse(content.exists())
            ref = sector_model.stage_player(archive, asset_id, digest, content)
            self.assertEqual(ref, sector_model.stage_player(archive, asset_id, digest, content))
            folder = content / "players" / ref["assetId"]
            data = (folder / (ref["version"] + ".json")).read_bytes()
            self.assertEqual(ref["version"], hashlib.sha256(data).hexdigest())
            public = json.loads(data)
            private = json.loads(source.read("roster-study.json"))
            self.assertEqual(set(public), {"mapWidth", "banks"})
            for index, bank in enumerate(public["banks"]):
                self.assertEqual(set(bank), {"idle", "walk", "run", "runB", "runC"})
                for key, clip in bank.items():
                    style = {"runB":"styleBBanks", "runC":"styleCBanks"}.get(key, "banks")
                    original = private[style][index][key[:3] if key.startswith("run") else key]
                    self.assertEqual(clip["url"], original["sha256"] + ".webp")
                    self.assertEqual((folder / clip["url"]).read_bytes(), source.read(original["file"]))
                    for field in ("origins", "cell", "period", "speed", "cols"):
                        self.assertEqual(clip[field], original[field])
            self.assertLessEqual(sum(f.stat().st_size for f in folder.iterdir()), 8 * 1024**2)


if __name__ == "__main__":
    unittest.main()
