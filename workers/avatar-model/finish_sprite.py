"""Encode a privately audited movement archive for an admitted game's asset ID."""
import argparse
from contextlib import redirect_stdout
from hashlib import file_digest, sha256
import json
from pathlib import Path
import re
import sys
from zipfile import ZipFile

from browser_motion import browser_motion_objects


def combine_styles(entry, directory, master_digest, archive):
    sys.path.append(str(entry.resolve(strict=True).parent))
    from audit_upload_brake_pages import main as audit_braking
    from audit_upload_pivots import audit as audit_turns
    from run_style_package import combine

    revision = None
    receipts = {}
    for style in "ABC":
        receipt = json.loads((directory / (style + ".json")).read_bytes())
        with (directory / (style + ".zip")).open("rb") as handle:
            checksum = file_digest(handle, "sha256").hexdigest()
        if (receipt["style"] != style or receipt["master"] != master_digest or
                receipt["archive"] != checksum or receipt["checks"]["releases"]["archiveSha256"] != checksum):
            raise ValueError("movement-style-mismatch")
        if not re.fullmatch("[0-9a-f]{64}", receipt["movement"]):
            raise ValueError("invalid-movement-revision")
        if revision is not None and revision != receipt["movement"]:
            raise ValueError("mixed-movement-revisions")
        revision = receipt["movement"]
        receipts[style] = receipt
    # Verify the actual received frames before one revision can be equipped.
    # A partial transfer may still have an intact receipt from the rendering worker.
    for style, receipt in receipts.items():
        stage = directory / (style + ".zip")
        with redirect_stdout(sys.stderr):
            turns = audit_turns(stage)
            audit_braking(stage)
        braking = json.loads((directory / "release-atlas-check.json").read_bytes())
        if (turns["portrait"] != receipt["portrait"] or turns != receipt["checks"]["turns"] or
                braking != receipt["checks"]["releases"]):
            raise ValueError("movement-style-audit")
    combine(directory / "A.zip", directory / "B.zip", archive, directory / "C.zip")
    with archive.open("rb") as handle:
        return file_digest(handle, "sha256").hexdigest()


def finish(entry, descriptor, master_digest, archive, archive_digest, asset_id, destination, *, ffmpeg=None):
    raw = descriptor.read_bytes()
    if len(raw) > 64 * 1024 or sha256(raw).hexdigest() != master_digest:
        raise ValueError("fitted-master-descriptor")
    master = json.loads(raw)
    fit = master["fit"]
    if master["version"] != 1 or fit["declined"] is not None or fit.get("requiresPainting"):
        raise ValueError("movement-master-mismatch")
    return encode_bound_archive(entry, archive, archive_digest, asset_id, destination,
                                fit["sourceSha256"], fit["sheetSha256"], master["templateSha256"],
                                ffmpeg=ffmpeg)


def encode_bound_archive(entry, archive, archive_digest, asset_id, destination,
                         portrait_digest, sheet_digest, template_digest, *, ffmpeg=None):
    """Encode movement after its fitting has been independently authenticated."""
    if not re.fullmatch("[0-9a-f]{32}", asset_id):
        raise ValueError("invalid-game-asset")
    with archive.open("rb") as handle:
        if file_digest(handle, "sha256").hexdigest() != archive_digest:
            raise ValueError("movement-archive-mismatch")
    with ZipFile(archive) as bundle:
        member = bundle.getinfo("roster-study.json")
        if member.file_size > 16 * 1024**2:
            raise ValueError("oversized-movement-manifest")
        movement = json.loads(bundle.read(member))
    if (movement["portrait"], movement["sheet"], movement["template"]) != (
            portrait_digest, sheet_digest, template_digest):
        raise ValueError("movement-master-mismatch")
    # Only the preinstalled release chooses executable code or an encoder.
    sys.path.insert(0, str(entry.resolve(strict=True).parent))
    import motion_worker_paths  # registers the release's avatar_worker package
    from avatar_worker.motion_encoder import stage_fitted_player
    if ffmpeg is None:
        from imageio_ffmpeg import get_ffmpeg_exe
        ffmpeg = get_ffmpeg_exe()
    result = stage_fitted_player(archive, asset_id, portrait_digest, destination, ffmpeg)
    objects = browser_motion_objects(destination / "players" / asset_id, result["version"], portrait_digest)
    if len(objects) != result["objects"] or sum(map(len, objects.values())) != result["bytes"]:
        raise ValueError("incomplete-browser-delivery")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("entry", "descriptor", "archive", "destination"):
        parser.add_argument(name, type=Path)
    for name in ("master-sha256", "asset-id"):
        parser.add_argument("--" + name, required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--archive-sha256")
    source.add_argument("--from-styles", type=Path)
    args = parser.parse_args()
    digest = args.archive_sha256
    if args.from_styles:
        digest = combine_styles(args.entry, args.from_styles, args.master_sha256, args.archive)
    print(json.dumps(finish(args.entry, args.descriptor, args.master_sha256, args.archive,
                            digest, args.asset_id, args.destination)))
