"""Render and audit one complete run style from a private, sealed player fitting."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import sys


class MovementRevisionMismatch(ValueError):
    pass


def painted_battle_sprite(path):
    """A combat sprite painted for this model (paint_battle_sprite.py), if it is one sound WebP."""
    from browser_motion import BATTLE_SPRITE_BYTES
    from PIL import Image

    try:
        with path.open("rb") as stream:
            data = stream.read(BATTLE_SPRITE_BYTES + 1)
        if not 0 < len(data) <= BATTLE_SPRITE_BYTES:
            return None
        with Image.open(path) as image:
            if image.format != "WEBP" or max(image.size) > 512:
                return None
            image.verify()
        return data
    except Exception:  # noqa: BLE001
        return None


def paint(entry, master, digest, style, blender, work, expected_movement=None, battle_sprite_path=None):
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
    battle_sprite = None
    if style == "A":
        battle_sprite = painted_battle_sprite(battle_sprite_path) if battle_sprite_path else None
        if battle_sprite is None:
            # No painted fighter for this model: pose the world model instead.
            from battle_pose import render_battle_pose
            battle_sprite = render_battle_pose(fit, sheet, template, work)
        (work / "battle.webp").write_bytes(battle_sprite)
    source = ["--fitted-master", master, "--master-sha256", digest]
    cache = work / "lower"
    checks = bake_style(source, fit["sourceSha256"], sheet, template, style, work / "style.zip",
                        blender, lambda msg: print(msg, flush=True), cache,
                        grouped_walk=use_for_job(cache))
    receipt = dict(style=style, master=digest, portrait=fit["sourceSha256"], movement=revision,
                   archive=checks["releases"]["archiveSha256"], checks=checks)
    if battle_sprite is not None:
        receipt["battleSpriteSha256"] = sha256(battle_sprite).hexdigest()
    (work / "style.json").write_text(json.dumps(receipt, allow_nan=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("entry", "master", "blender", "work"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--master-sha256", required=True)
    parser.add_argument("--style", choices=("A", "B", "C"), required=True)
    parser.add_argument("--expected-movement", help="Movement revision recorded by a previous style of this job")
    parser.add_argument("--battle-sprite", type=Path, help="Painted combat sprite for style A, in place of the posed model")
    args = parser.parse_args()
    try:
        paint(args.entry, args.master, args.master_sha256, args.style, args.blender, args.work, args.expected_movement,
              args.battle_sprite)
    except MovementRevisionMismatch as error:
        print(error, file=sys.stderr)
        sys.exit(78)
