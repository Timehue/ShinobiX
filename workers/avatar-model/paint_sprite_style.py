"""Render and audit one complete run style from a private, sealed player fitting."""
import argparse
import json
from pathlib import Path
import sys


class MovementRevisionMismatch(ValueError):
    pass


def paint(entry, master, digest, style, blender, work, expected_movement=None):
    if style not in ("A", "B", "C"):
        raise ValueError("invalid-run-style")
    sys.path.insert(0, str(entry.resolve(strict=True).parent))
    from make_masked_avatar import bake_style, read_fitted_master, TEMPLATES
    from package_motion_worker import movement_revision
    from shared_walk_batches import use_for_job

    fit, sheet, template = read_fitted_master(master, TEMPLATES, digest)
    if fit.get("requiresPainting"):
        raise ValueError("closeup-painting-required")
    revision = movement_revision(blender)
    if expected_movement is not None and revision != expected_movement:
        raise MovementRevisionMismatch("movement-worker-revision-mismatch")
    source = ["--fitted-master", master, "--master-sha256", digest]
    cache = work / "lower"
    checks = bake_style(source, fit["sourceSha256"], sheet, template, style, work / "style.zip",
                        blender, lambda msg: print(msg, flush=True), cache,
                        grouped_walk=use_for_job(cache))
    receipt = dict(style=style, master=digest, portrait=fit["sourceSha256"], movement=revision,
                   archive=checks["releases"]["archiveSha256"], checks=checks)
    (work / "style.json").write_text(json.dumps(receipt, allow_nan=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("entry", "master", "blender", "work"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--master-sha256", required=True)
    parser.add_argument("--style", choices=("A", "B", "C"), required=True)
    parser.add_argument("--expected-movement", help="Movement revision recorded by a previous style of this job")
    args = parser.parse_args()
    try:
        paint(args.entry, args.master, args.master_sha256, args.style, args.blender, args.work, args.expected_movement)
    except MovementRevisionMismatch as error:
        print(error, file=sys.stderr)
        sys.exit(78)
