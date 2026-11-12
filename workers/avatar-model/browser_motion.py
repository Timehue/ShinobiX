"""Read the immutable public objects of one fitted revision within browser playback limits."""
from gzip import decompress
from hashlib import sha256
import json
from math import isfinite
import re


PACKAGE_BYTES = 8 * 1024**2
INDEX_BYTES = 128 * 1024
PAGE_BYTES = 512 * 1024
BATTLE_SPRITE_BYTES = 256 * 1024
ATLAS_BYTES = 12 * 1024**2
DIRECTIONS = ["s", "se", "e", "ne", "n", "nw", "w", "sw"]


def check_facing(bank):
    clips, pages = bank["clips"], bank["pages"]
    required = {"idle", "walk", "run", "start-walk", "start-run", "pivot"}
    transitions = {("walk", "idle"), ("run", "idle"), ("run", "walk"), ("walk", "run")}
    available = {(clip.get("source") or clip.get("entryGait"), clip.get("target")) for clip in clips.values()}
    if not (required <= clips.keys() and transitions <= available and
            {clip["file"] for clip in clips.values()} == pages.keys()):
        raise ValueError("Incomplete fitted facing")
    for page in pages.values():
        width, height = page["cell"]
        cols, frames = page["cols"], page["frames"]
        if any(type(number) is not int or number < 1 for number in (width, height, cols, frames)):
            raise ValueError("Invalid fitted page dimensions")
        rows = (frames + cols - 1) // cols
        if width * cols * height * rows * 4 > ATLAS_BYTES:
            raise ValueError("Pose page exceeds browser atlas memory")
    for clip in clips.values():
        count, first = clip["count"], clip.get("firstCell", 0)
        if (type(count) is not int or count < 1 or type(first) is not int or first < 0 or
                first + count > pages[clip["file"]]["frames"] or len(clip["origins"]) != count or
                not isfinite(clip["period"]) or clip["period"] <= 0 or
                any(len(pair) != 2 or not all(map(isfinite, pair)) for pair in clip["origins"])):
            raise ValueError("Invalid fitted clip geometry or timing")
    return {page["file"] for page in pages.values()}


def browser_motion_objects(directory, revision, portrait):
    def read_file(name, limit):
        with (directory / name).open("rb") as stream:
            return stream.read(limit + 1)

    return checked_browser_objects(read_file, revision, portrait)


def worker_delivery_objects(result, asset_id, portrait):
    """Bind a retrieved worker result to the admitted player and return its public files in publish order."""
    model = result["model"]
    payload = result["objects"]
    if not re.fullmatch(r"[a-f0-9]{32}", asset_id) or model["assetId"] != asset_id:
        raise ValueError("Unexpected worker asset")
    if not isinstance(payload, dict) or model["objects"] != len(payload):
        raise ValueError("Incomplete worker delivery")

    def read_payload(name, limit):
        data = payload.get(name)
        if not isinstance(data, bytes):
            raise ValueError("Missing worker object: " + name)
        return data

    checked = checked_browser_objects(read_payload, model["version"], portrait)
    if checked.keys() != payload.keys() or sum(map(len, checked.values())) != model["bytes"]:
        raise ValueError("Unexpected worker delivery contents")
    return checked


def checked_browser_objects(read_bytes, revision, portrait):
    objects = {}
    total = 0

    def read(name, extension, limit):
        nonlocal total
        if not isinstance(name, str) or not re.fullmatch(r"[a-f0-9]{64}\." + extension, name):
            raise ValueError("Invalid fitted object name")
        data = read_bytes(name, min(limit, PACKAGE_BYTES - total))
        if len(data) > limit or total + len(data) > PACKAGE_BYTES:
            raise ValueError("Fitted object exceeds browser delivery budget: " + name)
        if sha256(data).hexdigest() != name[:64]:
            raise ValueError("Fitted object checksum mismatch: " + name)
        total += len(data)
        return data

    root = revision + ".json"
    header = read(root, "json", PACKAGE_BYTES)
    model = json.loads(header)
    if (model["format"] != "sector-motion-v2" or model["portraitSha256"] != portrait or
            model["mapWidth"] != 1080 or model["heightFraction"] != .068 or model["directions"] != DIRECTIONS or
            set(model["styles"]) != set("ABC") or any(len(bank) != 8 for bank in model["styles"].values())):
        raise ValueError("Incompatible fitted character")
    pages = set()
    for name in sorted({name for indexes in model["styles"].values() for name in indexes}):
        objects[name] = read(name, "gz", INDEX_BYTES)
        pages.update(check_facing(json.loads(decompress(objects[name]))))
    for name in sorted(pages):
        objects[name] = read(name, "264", PAGE_BYTES)
    if "battleSprite" in model:
        name = model["battleSprite"]
        objects[name] = read(name, "webp", BATTLE_SPRITE_BYTES)
    objects[root] = header  # Publish the revision after its pose pages are available.
    return objects
