"""Stage bundled sector artwork or the game-facing pages of a completed player job."""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[1]
CLIENT = ROOT / "shinobij.client"
sys.path.insert(0, str(ROOT / "workers/avatar-model"))
from avatar_worker.game_package import DIRECTIONS, GAITS, install, read_page, stage_player
from avatar_worker.motion_delivery import stage_motion
from browser_motion import browser_motion_objects, worker_delivery_objects


def bundled_portrait(slug, portrait):
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
        raise ValueError("Expected a lowercase model name")
    portrait = portrait.resolve()
    if not any(portrait.is_relative_to(root) for root in (CLIENT / "src/assets", CLIENT / "public")):
        raise ValueError("Expected a bundled portrait inside the client")
    return portrait


def pin_revision(slug, portrait, portrait_hash, revision):
    install(CLIENT / "src/data/sector-models" / (slug + ".json"),
            json.dumps(dict(portrait=portrait.relative_to(CLIENT).as_posix(), portraitSha256=portrait_hash,
                            manifestSha256=revision), separators=(",", ":")).encode())


def stage_checked_objects(source, destination, revision, portrait):
    objects = browser_motion_objects(source, revision, portrait)
    for name, data in objects.items():
        install(destination / name, data)
    return len(objects)


def collect_completed_call(call_id, asset_id, portrait, content, *, publish_r2=False):
    """Retrieve the admitted job's private finishing call after a dispatcher restart."""
    import modal

    if not re.fullmatch(r"fc-[A-Za-z0-9]+", call_id) or not re.fullmatch(r"[a-f0-9]{32}", asset_id):
        raise ValueError("Invalid admitted call or asset ID")
    call = modal.FunctionCall.from_id(call_id)
    result = call.get(timeout=0)
    if publish_r2:
        from publish_sprite import public_destination, publish_worker_result
        return publish_worker_result(result, asset_id, portrait, *public_destination())
    objects = worker_delivery_objects(result, asset_id, portrait)
    folder = object_root(content) / "players" / asset_id
    for name, data in objects.items():
        install(folder / name, data)
    return {key: result["model"][key] for key in ("assetId", "version", "objects", "bytes")}


def publish_fitted(source, slug, portrait, content, *, reviewed_master=None):
    portrait = bundled_portrait(slug, portrait)
    portrait_hash = sha256(portrait.read_bytes()).hexdigest()
    source = object_root(source)
    result = json.loads((source / "result.json").read_bytes())
    if result.get("sourceSha256") != portrait_hash or result.get("declined") or result.get("status") != "local-preview":
        raise ValueError("Expected a completed fit for this portrait")
    if reviewed_master is not None:
        if not re.fullmatch(r"[a-f0-9]{64}", reviewed_master) or result.get("fittedMasterSha256") != reviewed_master:
            raise ValueError("The completed job used a different fitting from the reviewed artwork")
        if sha256((source / "fitted-master.json").read_bytes()).hexdigest() != reviewed_master:
            raise ValueError("The completed job's fitted artwork is damaged")
    asset = result["gameModel"]["assetId"]
    revision = result["gameModel"]["version"]
    if not re.fullmatch(r"[a-f0-9]{32}", asset) or not re.fullmatch(r"[a-f0-9]{64}", revision):
        raise ValueError("Invalid fitted revision")
    origin = source / "sector-models" / "players" / asset

    count = stage_checked_objects(origin, object_root(content) / slug, revision, portrait_hash)
    pin_revision(slug, portrait, portrait_hash, revision)
    print(f"{slug}: verified and staged {count} public objects")


def publish_fitted_player(args):
    portrait = sha256(args.portrait.read_bytes()).hexdigest()
    content = object_root(args.content)
    content.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=content.parent) as temporary:
        staging = Path(temporary)
        if args.encode_with:
            from avatar_worker.motion_encoder import stage_fitted_player
            result = stage_fitted_player(args.source.resolve(), args.slug, portrait, staging, args.encode_with)
        else:
            result = stage_motion(args.source, args.motion_cache, args.slug, portrait, staging)
        relative = Path("players") / args.slug
        stage_checked_objects(staging / relative, content / relative, result["version"], portrait)
        return result


def object_root(path):
    # Windows worktrees plus the upload, asset and object hashes exceed MAX_PATH.
    path = Path(path).resolve()
    value = str(path)
    if os.name != "nt" or value.startswith("\\\\?\\"):
        return path
    if value.startswith("\\\\"):
        return Path("\\\\?\\UNC\\" + value[2:])
    return Path("\\\\?\\" + value)


def publish(source, slug, portrait, content):
    source = source.resolve()
    portrait = bundled_portrait(slug, portrait)
    model = json.loads((source / "roster-study.json").read_bytes())
    if model["portrait"] != sha256(portrait.read_bytes()).hexdigest():
        raise ValueError("The fitted artwork belongs to a different portrait")
    if (model["heightFraction"] != .068 or model["sprintStyle"] != "C" or
            model["directions"] != DIRECTIONS or len(model["banks"]) != len(DIRECTIONS)):
        raise ValueError("Unexpected scale, style or direction order")
    pages = {}
    views = []
    for bank in model["banks"]:
        view = {}
        for gait in GAITS:
            clip = bank[gait]
            path = (source / clip["file"]).resolve()
            if not path.is_relative_to(source):
                raise ValueError("Atlas outside the fitted model folder")
            view[gait] = read_page(clip, gait, path.read_bytes(), f"/sector-models/{slug}", pages)
        views.append(view)
    for filename, data in pages.items():
        install(content / slug / filename, data)
    manifest = dict(mapWidth=1080, portrait=portrait.relative_to(CLIENT).as_posix(),
                    portraitSha256=model["portrait"], banks=views)
    encoded = json.dumps(manifest, separators=(",", ":")).encode()
    revision = sha256(encoded).hexdigest()
    install(content / slug / (revision + ".json"), encoded)
    pin_revision(slug, portrait, model["portrait"], revision)
    print(f"{slug}: {len(views)} directions, {sum(map(len, pages.values())):,} image bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Fitted art directory, completed worker directory, or player ZIP")
    parser.add_argument("slug")
    parser.add_argument("portrait", type=Path, help="Original portrait bundled in this client")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--player", action="store_true", help="Stage a completed player ZIP with its asset id and source portrait")
    mode.add_argument("--fitted-npc", action="store_true", help="Stage an already encoded worker job for its bundled NPC portrait")
    parser.add_argument("--reviewed-master", help="Require the exact SHA-256 of the reviewed fitted artwork before changing an NPC's revision")
    mode.add_argument("--completed-call", action="store_true", help="Retrieve a private Modal finish call by ID for the admitted player")
    parser.add_argument("--motion-cache", type=Path, help="Stage the worker's complete encoded movement for a player ZIP")
    parser.add_argument("--encode-with", type=Path, help="Encode complete movement from the fitted player ZIP using this FFmpeg executable")
    parser.add_argument("--content", type=Path, default=CLIENT.parent / ".ci-evidence/sector-models",
                        help="Content staging directory for the sector-models prefix on the public art host")
    parser.add_argument("--publish-r2", action="store_true",
                        help="Send a completed worker call to the configured public sprite bucket")
    args = parser.parse_args()
    if args.reviewed_master is not None and not args.fitted_npc:
        parser.error("--reviewed-master requires --fitted-npc")
    if args.publish_r2 and not args.completed_call:
        parser.error("--publish-r2 requires --completed-call")
    if args.encode_with or args.motion_cache:
        if not args.player or (args.encode_with and args.motion_cache):
            parser.error("Use --player with exactly one of --encode-with and --motion-cache")
        print(json.dumps(publish_fitted_player(args)))
    elif args.completed_call:
        from modal.exception import FunctionTimeoutError, OutputExpiredError
        try:
            result = collect_completed_call(str(args.source), args.slug, sha256(args.portrait.read_bytes()).hexdigest(),
                                            args.content, publish_r2=args.publish_r2)
        except OutputExpiredError:
            print(json.dumps({"state": "output-expired"}))
            sys.exit(1)
        except FunctionTimeoutError:
            print(json.dumps({"state": "worker-timed-out"}))
            sys.exit(1)
        except TimeoutError:
            print(json.dumps({"state": "awaiting-result"}))
            sys.exit(75)
        print(json.dumps(result))
    elif args.fitted_npc:
        publish_fitted(args.source, args.slug, args.portrait, args.content.resolve(), reviewed_master=args.reviewed_master)
    elif args.player:
        print(json.dumps(stage_player(args.source, args.slug, sha256(args.portrait.read_bytes()).hexdigest(), args.content.resolve())))
    else:
        publish(args.source, args.slug, args.portrait, args.content.resolve())
