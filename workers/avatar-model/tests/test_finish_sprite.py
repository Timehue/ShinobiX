from hashlib import sha256
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from finish_sprite import finish


class FinishSpriteBindingTest(unittest.TestCase):
    def test_rejects_replaced_archive_or_a_different_fitting_of_the_same_portrait(self):
        with TemporaryDirectory() as directory:
            work = Path(directory)
            fit = {"declined": None, "sourceSha256": "a"*64, "sheetSha256": "b"*64}
            master = work / "master.json"
            master.write_text(json.dumps({"version": 1, "fit": fit, "templateSha256": "c"*64}))
            archive = work / "movement.zip"
            with ZipFile(archive, "x") as z:
                z.writestr("roster-study.json", json.dumps({
                    "portrait": fit["sourceSha256"], "template": "c"*64, "sheet": "d"*64,
                }))
            inputs = (work/"unused-entry", master, sha256(master.read_bytes()).hexdigest(), archive)
            for digest, error in [("0"*64, "movement-archive-mismatch"),
                                  (sha256(archive.read_bytes()).hexdigest(), "movement-master-mismatch")]:
                with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                    finish(*inputs, digest, "1"*32, work/"public")
            self.assertFalse((work/"public").exists())
