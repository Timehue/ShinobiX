"""Export the public NPC/starter object graph; publish only an explicitly reviewed plan."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import re
import sys

WORKER = Path(__file__).resolve().parents[1] / "workers/avatar-model"
sys.path.insert(0, str(WORKER))
from browser_motion import PACKAGE_BYTES, browser_motion_objects, worker_delivery_objects
from publish_sprite import put_verified_public_object

BUNDLED_MODEL_COUNT = 63


def digest(data):
    return sha256(data).hexdigest()


def add_cinderhold(client, roster, objects, characters):
    catalog_path = client.parent / "shared/cinderhold-world-models.json"
    catalog = json.loads(catalog_path.read_bytes())
    index = json.loads(roster.read_bytes())
    references = {item["id"]: item for item in index["models"]}
    if (index["scaleOfMapWidth"] != .068 or len(catalog) != 30 or len(index["models"]) != 30
            or set(references) != {item["id"] for item in catalog}
            or len({item["assetId"] for item in catalog}) != 30):
        raise ValueError("Incomplete Cinderhold roster bindings")
    base = roster.resolve().parent
    for item in catalog:
        slug, asset, revision = item["id"], item["assetId"], item["version"]
        if not re.fullmatch(r"[a-z0-9-]+", slug) or not re.fullmatch(r"[a-f0-9]{32}", asset):
            raise ValueError("Invalid Cinderhold model namespace")
        reference = references[slug]
        model = reference["gameModel"]
        portrait = item["portraitSha256"]
        if (item["avatar"] != f"/npc-portraits/{slug}.avif"
                or (asset, revision, portrait) != (model["assetId"], model["version"], reference["portraitSha256"])):
            raise ValueError("Cinderhold package differs from its roster binding: " + slug)
        folder = base / slug / "npc-result/sector-models/players" / asset
        if folder.resolve() != (base / reference["objects"]).resolve() or not folder.resolve().is_relative_to(base):
            raise ValueError("Unexpected Cinderhold package path")
        payload = browser_motion_objects(folder, revision, portrait)
        worker_delivery_objects({"model": model, "objects": payload}, asset, portrait)
        characters.append({"slug": "cinderhold-" + slug, "assetId": asset, "version": revision,
                           "portraitSha256": portrait, "objects": len(payload), "bytes": model["bytes"]})
        for name, data in payload.items():
            key = f"sector-models/players/{asset}/{name}"
            if key in objects:
                raise ValueError("Repeated Cinderhold object key")
            objects[key] = {"data": data, "mime": "application/json" if name.endswith(".json")
                            else "application/octet-stream", "manifest": name == revision + ".json"}


def build_release(client, content, expected_count=BUNDLED_MODEL_COUNT, cinderhold_roster=None):
    client, content = Path(client).resolve(), Path(content).resolve()
    pins = sorted((client / "src/data/sector-models").glob("*.json"))
    if len(pins) != expected_count:
        raise ValueError(f"Expected {expected_count} pinned appearances; found {len(pins)}")
    if expected_count == BUNDLED_MODEL_COUNT and not {"starter-one", "starter-two", "hollow-hound"} <= {p.stem for p in pins}:
        raise ValueError("Missing starter or encounter appearance")
    objects, characters = {}, []
    for path in pins:
        slug, pin = path.stem, json.loads(path.read_bytes())
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) or slug == "players":
            raise ValueError("Invalid NPC namespace")
        portrait_name = pin["portrait"]
        if (not re.fullmatch(r"(?:src/assets|public)/[\w./-]+\.webp", portrait_name)
                or ".." in Path(portrait_name).parts):
            raise ValueError("Invalid bundled portrait path")
        portrait = (client / portrait_name).resolve()
        folder = (content / slug).resolve()
        if not portrait.is_relative_to(client) or not folder.is_relative_to(content):
            raise ValueError("Model input leaves its source directory")
        if digest(portrait.read_bytes()) != pin["portraitSha256"]:
            raise ValueError("Bundled portrait changed: " + slug)
        version = pin["manifestSha256"]
        payload = browser_motion_objects(folder, version, pin["portraitSha256"])
        header = json.loads(payload[version + ".json"])
        if set(header) != {"format", "mapWidth", "heightFraction", "portraitSha256", "directions", "styles"}:
            raise ValueError("Unexpected public model metadata")
        if slug == "hollow-hound":
            art = json.loads((client / "src/data/hollow-hound-encounter.json").read_bytes())
            if set(art) != {"idle", "still"} or len(set(art.values())) != 2:
                raise ValueError("Incomplete hound encounter delivery")
            for name in art.values():
                if not re.fullmatch(r"[a-f0-9]{64}\.webp", name):
                    raise ValueError("Invalid encounter object")
                data = (folder / name).read_bytes()
                if len(data) > PACKAGE_BYTES or digest(data) + ".webp" != name:
                    raise ValueError("Encounter object checksum mismatch")
                payload[name] = data
        if sum(map(len, payload.values())) > PACKAGE_BYTES:
            raise ValueError("Complete character exceeds the browser package budget")
        characters.append({"slug": slug, "version": version, "portraitSha256": pin["portraitSha256"],
                           "objects": len(payload), "bytes": sum(map(len, payload.values()))})
        for name, data in payload.items():
            key = f"sector-models/{slug}/{name}"
            mime = "application/json" if name.endswith(".json") else "image/webp" if name.endswith(".webp") else "application/octet-stream"
            objects[key] = {"data": data, "mime": mime, "manifest": name == version + ".json"}
    if cinderhold_roster is not None:
        add_cinderhold(client, Path(cinderhold_roster), objects, characters)
    report = {"format": "sector-model-release-v1", "characters": characters, "objects": [
        {"key": key, "sha256": digest(value["data"]), "bytes": len(value["data"]),
         "mime": value["mime"], "manifest": value["manifest"]} for key, value in sorted(objects.items())]}
    report_bytes = (json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n").encode()
    return {"report": report, "reportBytes": report_bytes, "sha256": digest(report_bytes), "objects": objects}


def export_release(plan, output):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    report = (output / "release.json").resolve()
    if not report.is_relative_to(output):
        raise ValueError("Release report leaves its output directory")
    if report.exists() and report.read_bytes() != plan["reportBytes"]:
        raise ValueError("Output contains a different release plan; choose a new output directory")
    for key, entry in plan["objects"].items():
        target = (output / key).resolve()
        if not target.is_relative_to(output):
            raise ValueError("Export path leaves its output directory")
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.read_bytes() != entry["data"]:
                raise ValueError("Existing immutable export changed")
        else:
            with target.open("xb") as stream:
                stream.write(entry["data"])
    report.write_bytes(plan["reportBytes"])


def publish_release(plan, client, bucket):
    def write(key):
        entry = plan["objects"][key]
        put_verified_public_object(client, bucket, key, entry["data"], entry["mime"])
    # Verify every dependency before exposing any newly selected root revision.
    with ThreadPoolExecutor(max_workers=4) as pool:
        for _ in pool.map(write, [key for key, value in plan["objects"].items() if not value["manifest"]]):
            pass
    for key, value in plan["objects"].items():
        if value["manifest"]:
            write(key)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=Path, default=Path(__file__).resolve().parents[1] / "shinobij.client")
    parser.add_argument("--content", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--cinderhold-roster", type=Path)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--reviewed-plan", help="SHA-256 of the exact locally reviewed release.json")
    args = parser.parse_args(argv)
    plan = build_release(args.client, args.content, cinderhold_roster=args.cinderhold_roster)
    if args.output:
        export_release(plan, args.output)
    if args.publish:
        if args.reviewed_plan != plan["sha256"]:
            raise ValueError("Publication requires the exact reviewed release plan digest")
        from publish_sprite import public_destination
        client, bucket = public_destination()
        publish_release(plan, client, bucket)
    print(json.dumps({"mode": "published" if args.publish else "local-only", "planSha256": plan["sha256"],
                      "characters": len(plan["report"]["characters"]), "objects": len(plan["objects"]),
                      "bytes": sum(len(value["data"]) for value in plan["objects"].values())}))


if __name__ == "__main__":
    main()
