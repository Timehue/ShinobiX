from hashlib import sha256
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from install_sprite_worker import install


def package(path, index, files):
    hashes = {name: sha256(data).hexdigest() for name, data in files.items()}
    metadata = {'files': hashes}
    if index == 'motion-worker.json':
        metadata['entry'] = 'worker/entry.py'
    with ZipFile(path, 'x') as out:
        for name, data in files.items():
            out.writestr(name, data)
        out.writestr(index, json.dumps(metadata))
    return sha256(path.read_bytes()).hexdigest()


class InstallationTest(unittest.TestCase):
    def test_installs_shared_files_and_protects_existing_installation(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            files = {'worker/entry.py': b'entry', 'worker/shared.py': b'shared'}
            intake, movement, dest = (root/name for name in ('i.zip','m.zip','installed'))
            release = {'intake': package(intake,'intake.json',{'worker/shared.py': b'shared'}),
                       'movement': package(movement,'motion-worker.json',files)}
            self.assertTrue(install(intake,movement,dest,release).samefile(dest/'worker/entry.py'))
            with self.assertRaises(FileExistsError):
                install(intake,movement,dest,release)
            self.assertEqual((dest/'worker/shared.py').read_bytes(), b'shared')

    def test_failure_never_exposes_partial_worker(self):
        for case in ('corrupt','collision','escape'):
            with self.subTest(case=case), TemporaryDirectory() as temp:
                root = Path(temp)
                intake, movement, dest = (root/name for name in ('i.zip','m.zip','installed'))
                files = {'worker/entry.py': b'entry'}
                if case == 'collision':
                    files['worker/shared.py'] = b'conflicting bytes'
                if case == 'escape':
                    files['../outside'] = b'invalid'
                release = {'intake': package(intake,'intake.json',{'worker/shared.py': b'shared'}),
                           'movement': package(movement,'motion-worker.json',files)}
                if case == 'corrupt':
                    with movement.open('ab') as stream:
                        stream.write(b'changed')
                with self.assertRaises(ValueError):
                    install(intake,movement,dest,release)
                self.assertEqual(set(root.iterdir()), {intake,movement})
