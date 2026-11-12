"""Keep an uploaded character's audited motion through a delivery-worker restart."""
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import BadZipFile, ZipFile, ZIP_STORED
import zlib

def copy_and_hash(source, target):
    digest = hashlib.sha256()
    while block := source.read(1024 * 1024):
        target.write(block)
        digest.update(block)
    return digest.hexdigest()


def filename(style):
    if style is None:
        return 'audited-movement.zip'
    if style not in ('A','B','C'):
        raise ValueError('Unknown movement style')
    return f'audited-style-{style}.zip'


def save(checkpoints, identity, archive, checks, *, style=None):
    folder = Path(checkpoints)
    destination = folder / filename(style)
    folder.mkdir(exist_ok=True, parents=True)
    with TemporaryDirectory(dir=folder) as temporary:
        pending = Path(temporary) / 'movement.zip'
        with ZipFile(pending, 'x', compression=ZIP_STORED) as bundle:
            with archive.open('rb') as src, bundle.open('motion.zip', 'w') as dest:
                checksum = copy_and_hash(src, dest)
            if style is not None and checksum != checks[style]['releases']['archiveSha256']:
                raise ValueError('Movement changed after its release checks')
            receipt = dict(version=1, identity=identity, sha256=checksum, checks=checks)
            bundle.writestr('receipt.json', json.dumps(receipt, allow_nan=False))
        pending.replace(destination)


def restore(checkpoints, identity, archive, *, style=None):
    checkpoint = Path(checkpoints) / filename(style)
    with TemporaryDirectory(dir=archive.parent) as temporary:
        pending = Path(temporary) / 'motion.zip'
        try:
            with ZipFile(checkpoint) as bundle:
                receipt = json.loads(bundle.read('receipt.json'))
                if receipt['version'] != 1 or receipt['identity'] != identity:
                    return None
                checks = receipt['checks']
                if not isinstance(checks, dict) or set(checks) != (set('ABC') if style is None else {style}):
                    return None
                if any(not isinstance(c, dict) or set(c) != {'turns', 'releases'} for c in checks.values()):
                    return None
                if style is not None and receipt['sha256'] != checks[style]['releases']['archiveSha256']:
                    return None
                with bundle.open('motion.zip') as src, pending.open('xb') as dest:
                    if copy_and_hash(src, dest) != receipt['sha256']:
                        return None
        except (FileNotFoundError, BadZipFile, EOFError, KeyError, TypeError, ValueError, zlib.error):
            return None
        pending.replace(archive)
    return checks
