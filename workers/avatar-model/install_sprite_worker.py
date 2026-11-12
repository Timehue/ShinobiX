"""Install a verified private sprite worker from the two release archives."""
import argparse
from hashlib import file_digest
import json
from pathlib import Path, PurePosixPath
import shutil
from tempfile import TemporaryDirectory
from zipfile import ZipFile


def install(intake, movement, destination, release):
    """Publish only after both archives, including shared files, agree with the release."""
    destination = destination.resolve()
    if destination.exists():
        raise FileExistsError(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=destination.parent) as scratch:
        tree = Path(scratch) / 'installation'
        tree.mkdir()
        for archive_path, key, index_name in ((intake, 'intake', 'intake.json'),
                                              (movement, 'movement', 'motion-worker.json')):
            with archive_path.open('rb') as stream:
                if file_digest(stream, 'sha256').hexdigest() != release[key]:
                    raise ValueError(f'Unexpected {key} release')
                stream.seek(0)
                with ZipFile(stream) as archive:
                    index = json.loads(archive.read(index_name))
                    files = index['files']
                    if sorted(archive.namelist()) != sorted([*files, index_name]):
                        raise ValueError(f'Invalid {key} contents')
                    for name, digest in files.items():
                        relative = PurePosixPath(name)
                        if (relative.is_absolute() or '..' in relative.parts or
                                relative.as_posix() != name or ':' in name or '\\' in name):
                            raise ValueError('Invalid package path')
                        target = tree.joinpath(*relative.parts)
                        if not target.exists():
                            target.parent.mkdir(parents=True, exist_ok=True)
                            with archive.open(name) as source, target.open('xb') as out:
                                shutil.copyfileobj(source, out, length=1024*1024)
                        with target.open('rb') as installed:
                            if file_digest(installed, 'sha256').hexdigest() != digest:
                                raise ValueError(f'Worker file mismatch: {name}')
                    if key == 'movement':
                        entry = index['entry']
                        if entry not in files:
                            raise ValueError('Missing movement entry point')
        tree.rename(destination)
    return destination / entry


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ('intake', 'movement', 'new_directory'):
        parser.add_argument(arg, type=Path)
    args = parser.parse_args()
    release = json.loads(Path(__file__).with_name('sprite-worker-release.json').read_bytes())
    print(install(args.intake, args.movement, args.new_directory, release))
