"""Run one admitted sprite job on a private local volume, or recover its finished result."""
import argparse
from hashlib import file_digest
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory

from browser_motion import browser_motion_objects
from finish_sprite import finish


def check_encoder():
    """Verify the actual browser codec before spending time on a cold bake."""
    encoder = os.environ.get('SHINOBIX_FFMPEG') or shutil.which('ffmpeg')
    if not encoder:
        from imageio_ffmpeg import get_ffmpeg_exe
        encoder = get_ffmpeg_exe()
    # Use the same raw input and encoder as the published movement pages.
    subprocess.run([encoder,'-nostdin','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','2x2',
                    '-i','pipe:0','-frames:v','1','-c:v','libx264','-pix_fmt','yuv420p','-f','h264','pipe:1'],
                   input=bytes(12), stdout=subprocess.DEVNULL, check=True, timeout=20)
    return str(encoder)


def recover_delivery(entry, result, destination, atomic_write):
    """Restore damaged browser files from this job's audited movement without repainting it."""
    model = result['gameModel']
    asset_id, version = model['assetId'], model['version']
    if not re.fullmatch('[0-9a-f]{32}', asset_id) or not re.fullmatch('[0-9a-f]{64}', version):
        raise ValueError('Invalid completed equipment reference')
    portrait = result['sourceSha256']
    public = destination / 'sector-models' / 'players' / asset_id
    try:
        browser_motion_objects(public, version, portrait)
    except (FileNotFoundError, ValueError):
        with TemporaryDirectory(dir=destination.parent) as scratch:
            staging = Path(scratch)
            encoded = finish(entry, destination / 'fitted-master.json', result['fittedMasterSha256'],
                             destination / 'steady-gaits.zip', result['archiveSha256'], asset_id, staging,
                             ffmpeg=os.environ.get('SHINOBIX_FFMPEG') or shutil.which('ffmpeg'),
                             expected_version=version)
            if encoded['version'] != version:
                raise ValueError('Recover this delivery with its original encoder')
            objects = browser_motion_objects(staging / 'players' / asset_id, version, portrait)
            public.mkdir(exist_ok=True, parents=True)
            # The graph reader yields the verified manifest last. Good files stay in place on retries.
            for name, data in objects.items():
                target = public / name
                try:
                    with target.open('rb') as stream:
                        if stream.read(len(data) + 1) == data:
                            continue
                except FileNotFoundError:
                    pass
                atomic_write(target, data)
            browser_motion_objects(public, version, portrait)
    return model


def run(entry, master, expected, job, blender):
    # The operator supplies the installed worker entry; the upload only supplies artwork.
    sys.path.insert(0, str(entry.resolve(strict=True).parent))
    from make_masked_avatar import build, read_fitted_master, TEMPLATES
    from local_studio_profile import atomic_write, exclusive_profile, file_root
    from package_motion_worker import movement_revision

    job = file_root(job)
    destination = job / 'result'
    with exclusive_profile(job):
        fit, _, _ = read_fitted_master(master, TEMPLATES, expected)
        if fit.get("requiresPainting"):
            raise ValueError("closeup-painting-required")
        request = job / 'request.json'
        identity = dict(master=expected, portrait=fit['sourceSha256'])
        binding = json.loads(request.read_bytes()) if request.exists() else None
        if binding is not None and any(binding.get(key) != value for key,value in identity.items()):
            raise ValueError('Job belongs to different artwork')
        if binding is None and destination.exists():
            raise ValueError('Completed result has no job binding')
        if not destination.exists():
            encoder = check_encoder()
            revision = movement_revision(blender)
            if binding is None:
                atomic_write(request, json.dumps(dict(identity,movement=revision)).encode())
            elif binding.get('movement') != revision:
                raise ValueError('This job needs its original worker release')
            previous_encoder = os.environ.get('SHINOBIX_FFMPEG')
            os.environ['SHINOBIX_FFMPEG'] = encoder
            try:
                build(None, destination, blender, None, lambda msg: print(msg, file=sys.stderr, flush=True),
                      fitted_master=(master, expected), checkpoints=job/'checkpoints')
            finally:
                if previous_encoder is None:
                    del os.environ['SHINOBIX_FFMPEG']
                else:
                    os.environ['SHINOBIX_FFMPEG'] = previous_encoder
        result = json.loads((destination/'result.json').read_bytes())
        if result.get('fittedMasterSha256') != expected or result.get('sourceSha256') != identity['portrait']:
            raise ValueError('Completed result belongs to different artwork')
        read_fitted_master(destination, TEMPLATES, expected)
        with (destination/'steady-gaits.zip').open('rb') as archive:
            if file_digest(archive, 'sha256').hexdigest() != result.get('archiveSha256'):
                raise ValueError('Completed sprite archive is damaged')
        return recover_delivery(entry, result, destination, atomic_write)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('entry', type=Path, help='Private worker entry returned by the installer')
    parser.add_argument('master', type=Path, help='Sealed artwork directory from the portrait reader')
    parser.add_argument('job', type=Path, help='Server-assigned private directory for the same job on every attempt')
    parser.add_argument('--master-sha256', required=True)
    parser.add_argument('--blender', type=Path, required=True)
    args = parser.parse_args()
    with os.fdopen(os.dup(sys.stdout.fileno()), 'w', encoding='utf-8') as response:
        sys.stdout.flush()
        os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
        model = run(args.entry, args.master.resolve(), args.master_sha256, args.job, args.blender.resolve())
        print(json.dumps(model), file=response)
