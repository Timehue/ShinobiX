from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile, ZipInfo

WORKER = Path(__file__).resolve().parents[1]
spec = spec_from_file_location("stocky_package_bundles", WORKER/"stocky"/"package_bundles.py")
package_bundles = module_from_spec(spec)
spec.loader.exec_module(package_bundles)


def entry_bytes(path, info):
    """The local header and compressed data of one entry, exactly as stored."""
    with open(path, "rb") as raw:
        raw.seek(info.header_offset)
        header = raw.read(30)
        fields = package_bundles.LOCAL.unpack(header)
        return header + raw.read(fields[9] + fields[10] + info.compress_size)


class StockyBundleArchiveTest(unittest.TestCase):
    def base(self, folder):
        path = folder/"base.zip"
        with ZipFile(path, "w") as archive:
            for name, data, method in (("keep/deflated.py", b"print('kept')\n" * 400, ZIP_DEFLATED),
                                       ("keep/stored.png", bytes(range(256)) * 8, ZIP_STORED),
                                       ("index.json", b'{"files": {}}', ZIP_DEFLATED),
                                       ("keep/last.txt", b"last\r\n", ZIP_DEFLATED)):
                info = ZipInfo(name, (2026, 11, 21, 23, 41, 48))
                info.create_system, info.external_attr = 3, 0o100644 << 16
                archive.writestr(info, data, compress_type=method)
        return path

    def test_rewrite_is_deterministic_and_copies_unchanged_entries_byte_for_byte(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            source = self.base(folder)
            updates = {"index.json": b'{"files": {"new": 1}}', "added/stocky.json": b"{}\n", "added/z.png": b"\x89PNG"}
            for run in ("a", "b"):
                package_bundles.rewrite_zip(source, folder/f"{run}.zip", updates)
            self.assertEqual((folder/"a.zip").read_bytes(), (folder/"b.zip").read_bytes())
            with ZipFile(source) as before, ZipFile(folder/"a.zip") as after:
                self.assertIsNone(after.testzip())
                self.assertEqual([i.filename for i in after.infolist()],
                                 [i.filename for i in before.infolist()] + ["added/stocky.json", "added/z.png"])
                for info in before.infolist():
                    if info.filename == "index.json":
                        continue
                    self.assertEqual(entry_bytes(source, info), entry_bytes(folder/"a.zip", after.getinfo(info.filename)))
                    self.assertEqual(after.read(info.filename), before.read(info.filename))
                for name, data in updates.items():
                    self.assertEqual(after.read(name), data)
                    self.assertEqual(after.getinfo(name).compress_type, ZIP_STORED)
                replaced = after.getinfo("index.json")
                self.assertEqual(replaced.date_time, before.getinfo("index.json").date_time)
                self.assertEqual(replaced.external_attr, before.getinfo("index.json").external_attr)

    def test_rewrite_refuses_to_overwrite_and_unsupported_entries(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            source = self.base(folder)
            (folder/"taken.zip").write_bytes(b"")
            with self.assertRaises(FileExistsError):
                package_bundles.rewrite_zip(source, folder/"taken.zip", {})
            commented = folder/"commented.zip"
            with ZipFile(commented, "w") as archive:
                archive.writestr(ZipInfo("a.txt"), b"a")
                archive.comment = b"note"
            with self.assertRaises(ValueError):
                package_bundles.rewrite_zip(commented, folder/"out.zip", {})


if __name__ == "__main__":
    unittest.main()
