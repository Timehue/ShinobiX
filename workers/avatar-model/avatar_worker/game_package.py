"""Validate and stage game-facing sprites from a completed portrait job."""
from hashlib import sha256
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
from tempfile import NamedTemporaryFile
from zipfile import ZipFile

DIRECTIONS = ["s", "se", "e", "ne", "n", "nw", "w", "sw"]
GAITS = {"idle": (1, 0), "walk": (64, 31), "run": (36, 120)}


def install(path, data):
    if path.exists() and path.read_bytes() == data:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        try:
            handle.write(data)
        except BaseException:
            handle.close()
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_page(clip, gait, data, folder, pages):
    from PIL import Image

    count, speed = GAITS[gait]
    digest = sha256(data).hexdigest()
    origins, cols = clip["origins"], clip["cols"]
    width, height = clip["cell"]
    if (clip["sha256"] != digest or clip["count"] != count or clip["firstCell"] != 0
            or clip["speed"] != speed or not 0 < clip["period"] < 10
            or len(origins) != count or type(cols) is not int or not 1 <= cols <= count
            or any(type(v) is not int or not 1 <= v <= 256 for v in (width, height))
            or any(len(pair) != 2 or not all(map(math.isfinite, pair)) for pair in origins)):
        raise ValueError(f"Invalid {gait} atlas metadata")
    filename = digest + ".webp"
    with Image.open(BytesIO(data)) as image:
        if (image.format != "WEBP" or image.size != (cols * width, math.ceil(count / cols) * height)
                or "A" not in image.getbands() or getattr(image, "is_animated", False)):
            raise ValueError(f"Invalid {gait} atlas geometry")
        if filename not in pages:
            image.load()
            pages[filename] = data
    result = {key: clip[key] for key in ("cell", "cols", "origins", "period", "speed")}
    result["url"] = f"{folder}/{filename}" if folder else filename
    return result


def stage_player(source, asset_id, portrait_sha256, content):
    """Stage game-facing sheets from a completed worker job. The save references the returned pin."""
    if not re.fullmatch(r"[0-9a-f]{32}", asset_id):
        raise ValueError("Expected a server-issued 32-character hex asset id")
    pages, views = {}, []
    folder = f"players/{asset_id}"
    with ZipFile(source) as archive:
        names = archive.namelist()
        if len(set(names)) != len(names) or archive.getinfo("roster-study.json").file_size > 16 * 1024**2:
            raise ValueError("Invalid worker archive")
        model = json.loads(archive.read("roster-study.json"))
        if (model["portrait"] != portrait_sha256 or
                model["heightFraction"] != .068 or model["directions"] != DIRECTIONS or
                model["sprintStyle"] != "A"):
            raise ValueError("Unexpected worker portrait, scale or movement")
        styles = [model[k] for k in ("banks", "styleBBanks", "styleCBanks")]
        if any(len(banks) != 8 for banks in styles):
            raise ValueError("Missing movement direction")
        for direction in range(8):
            view = {}
            for style, banks in zip("ABC", styles):
                for gait in GAITS:
                    clip = banks[direction][gait]
                    filename = clip["file"]
                    if (not re.fullmatch(r"[a-z0-9-]+\.webp", filename)
                            or archive.getinfo(filename).file_size > 384 * 1024):
                        raise ValueError("Invalid player sheet")
                    page = read_page(clip, gait, archive.read(filename), "", pages)
                    key = gait if gait != "run" or style == "A" else "run" + style
                    if key in view and view[key] != page:
                        raise ValueError("Run style changed a shared standing or walking pose")
                    view[key] = page
            views.append(view)
    encoded = json.dumps(dict(mapWidth=1080, banks=views), separators=(",", ":")).encode()
    if len(encoded) + sum(map(len, pages.values())) > 8 * 1024**2:
        raise ValueError("Game-facing player sheets exceed the 8 MiB budget")
    revision = sha256(encoded).hexdigest()
    for filename, data in pages.items():
        install(content / folder / filename, data)
    install(content / folder / (revision + ".json"), encoded)
    return {"assetId": asset_id, "version": revision}
