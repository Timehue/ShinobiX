"""Encode fitted motion as small, independently verifiable sprite pages."""
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from gzip import compress
from hashlib import file_digest, sha256
from io import BytesIO
import json
from math import ceil
from pathlib import Path
import re
import subprocess
from tempfile import TemporaryDirectory
from zipfile import ZipFile

import numpy as np
from PIL import Image

from .motion_delivery import encoded, stage_motion


def encode_page(source, folder, ffmpeg, name, clips):
    if not re.fullmatch(r"[a-z0-9-]+[.]webp", name):
        raise ValueError("Invalid fitted page name")
    first = clips[0]
    width, height = first["cell"]
    columns = first["cols"]
    count = max(clip.get("firstCell", 0) + clip["count"] for clip in clips)
    if not (1 <= width <= 256 and 1 <= height <= 256 and 1 <= columns <= count <= 1024):
        raise ValueError("Invalid fitted page dimensions")
    for clip in clips:
        if any(clip[field] != first[field] for field in ("cell", "cols", "sha256")):
            raise ValueError("Inconsistent fitted page metadata")
    with ZipFile(source) as archive:
        if archive.getinfo(name).file_size > 8 * 1024**2:
            raise ValueError("Oversized fitted page")
        data = archive.read(name)
    if sha256(data).hexdigest() != first["sha256"]:
        raise ValueError("Fitted page checksum mismatch")
    with Image.open(BytesIO(data)) as image:
        if image.format != "WEBP" or image.size != (columns * width, ceil(count/columns) * height):
            raise ValueError("Fitted atlas dimensions differ from the declared page")
        atlas = np.asarray(image.convert("RGBA"))
    padded_width = (width+1)//2*2
    padded_height = (height+1)//2*2
    output = folder / (Path(name).stem + ".264")
    args = [ffmpeg, "-hide_banner", "-loglevel", "error", "-n", "-f", "rawvideo", "-pix_fmt", "rgb24",
            "-s", f"{padded_width}x{2*padded_height}", "-r", "60", "-i", "-", "-an", "-c:v", "libx264",
            "-threads", "1", "-pix_fmt", "yuv420p", "-preset", "slow", "-crf", "24", "-g", "15", "-bf", "0",
            "-profile:v", "baseline", "-x264-params", "aud=1", "-f", "h264", str(output)]
    frame = np.zeros((2*padded_height, padded_width, 3), np.uint8)
    with subprocess.Popen(args, stdin=subprocess.PIPE) as child:
        with child.stdin as stream:
            for index in range(count):
                left = index % columns * width
                top = index // columns * height
                cell = atlas[top:top+height, left:left+width]
                alpha = cell[:, :, 3:]
                frame[:height, :width] = (cell[:, :, :3].astype(np.uint16)*alpha+127)//255
                frame[padded_height:padded_height+height, :width] = alpha
                stream.write(frame.tobytes())
        if child.wait() != 0:
            raise ValueError(f"Could not encode fitted page {name}")
    return name, dict(file=output.name, frames=count, cell=[width,height], bytes=output.stat().st_size,
                      sha256=sha256(output.read_bytes()).hexdigest())


def stage_fitted_player(source, asset_id, portrait, destination, ffmpeg):
    """Publish the root only after all source poses, checksums and delivery limits pass."""
    with ZipFile(source) as archive:
        if archive.getinfo("roster-study.json").file_size > 16 * 1024**2:
            raise ValueError("Oversized movement metadata")
        fitted = json.loads(archive.read("roster-study.json"))
    if fitted.get("portrait") != portrait:
        raise ValueError("Fitted portrait checksum mismatch")
    groups = defaultdict(list)
    movement = {field: fitted[field] for field in ("directions", "heightFraction")}
    with source.open("rb") as stream:
        movement["sourceArchiveSha256"] = file_digest(stream, "sha256").hexdigest()
    for field in ("banks", "styleBBanks", "styleCBanks"):
        movement[field] = []
        for bank in fitted[field]:
            compact = {}
            for name, clip in bank.items():
                groups[clip["file"]].append(clip)
                compact[name] = {k:v for k,v in clip.items() if k not in ("cell","cols","sha256","maxSupportDriftPx")}
                compact[name]["origins"] = [[round(x, 3), round(y, 3)] for x,y in clip["origins"]]
            movement[field].append(compact)
    with TemporaryDirectory(dir=source.parent) as staging:
        folder = Path(staging)
        def encode_group(item):
            return encode_page(source, folder, ffmpeg, *item)
        with ThreadPoolExecutor(max_workers=2) as pool:
            movement["pages"] = dict(pool.map(encode_group, groups.items()))
        (folder/"movement.json.gz").write_bytes(compress(encoded(movement), mtime=0))
        return stage_motion(source, folder, asset_id, portrait, destination)
