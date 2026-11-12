from pathlib import Path
from hashlib import sha256
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from avatar_worker import fitted_motion_checkpoint as checkpoint


class MotionCheckpointTests(unittest.TestCase):
    def test_styles_resume_separately_and_only_on_the_audited_release(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            identity = dict(portrait='one', master='two', movement='release-one')
            archive, output = root/'A.zip', root/'output.zip'
            archive.write_bytes(b'audited animation')
            checks = {'A': dict(turns={}, releases={'archiveSha256':sha256(archive.read_bytes()).hexdigest()})}
            checkpoint.save(root, identity, archive, checks, style='A')
            self.assertIsNone(checkpoint.restore(root, identity, output, style='B'))
            self.assertIsNone(checkpoint.restore(root, dict(identity,movement='release-two'), output, style='A'))
            self.assertIsNone(checkpoint.restore(root, identity, output))
            archive.write_bytes(b'changed after audit')
            with self.assertRaises(ValueError):
                checkpoint.save(root, identity, archive, checks, style='A')
            self.assertEqual(checkpoint.restore(root, identity, output, style='A'), checks)
            self.assertEqual(output.read_bytes(), b'audited animation')

    def test_identity_corruption_and_retry(self):
        output = Path(__file__).resolve().parents[1]/'outputs'
        output.mkdir(exist_ok=True)
        with TemporaryDirectory(dir=output) as temp:
            root = Path(temp)
            original, restored = root/'source.zip', root/'retry.zip'
            original.write_bytes(b'original fitted animation')
            private = root/'job'
            identity = dict(portrait='portrait-one', master='fit-one')
            checks = {style:dict(turns={'count':40}, releases={'count':48}) for style in 'ABC'}
            self.assertIsNone(checkpoint.restore(private, identity, restored))
            checkpoint.save(private, identity, original, checks)
            self.assertIsNone(checkpoint.restore(private, {**identity, 'master':'fit-two'}, restored))
            self.assertIsNone(checkpoint.restore(private, {**identity, 'portrait':'portrait-two'}, restored))
            self.assertFalse(restored.exists())
            self.assertEqual(checkpoint.restore(private, identity, restored), checks)
            self.assertEqual(restored.read_bytes(), original.read_bytes())
            saved = private/'audited-movement.zip'
            with ZipFile(saved) as bundle:
                receipt = bundle.read('receipt.json')
            # This ZIP has valid CRCs but its artwork differs from the audited bytes.
            with ZipFile(saved, 'w') as bundle:
                bundle.writestr('receipt.json', receipt)
                bundle.writestr('motion.zip', b'damaged artwork')
            self.assertIsNone(checkpoint.restore(private, identity, restored))
            saved.write_bytes(b'incomplete ZIP')
            self.assertIsNone(checkpoint.restore(private, identity, restored))
            self.assertEqual(restored.read_bytes(), original.read_bytes())
            checkpoint.save(private, identity, original, checks)
            self.assertEqual(checkpoint.restore(private, identity, restored), checks)
