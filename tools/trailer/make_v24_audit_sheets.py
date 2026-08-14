"""Create labeled midpoint sheets for every shot in the V23 trailer manifest."""

from __future__ import annotations

import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from render_trailer_v5 import ffmpeg_path


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "tmp" / "trailer" / "render-v24" / "concat-v24.txt"
OUTPUT = ROOT / "tmp" / "trailer" / "v24-audit"
TILE_W = 480
TILE_H = 292
IMAGE_H = 270
COLS = 4
ROWS = 5


def read_manifest() -> list[Path]:
    paths: list[Path] = []
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        if not line.startswith("file '"):
            continue
        paths.append(Path(line[6:-1]))
    if len(paths) != 60:
        raise RuntimeError(f"Expected 60 shots, found {len(paths)}")
    return paths


def extract_midpoint(source: Path, destination: Path) -> None:
    command = [
        ffmpeg_path(),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        "0.8",
        "-i",
        str(source),
        "-frames:v",
        "1",
        "-vf",
        f"scale={TILE_W}:{IMAGE_H}:force_original_aspect_ratio=decrease,"
        f"pad={TILE_W}:{IMAGE_H}:(ow-iw)/2:(oh-ih)/2:black",
        str(destination),
    ]
    subprocess.run(command, check=True)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    shots = read_manifest()
    font = ImageFont.load_default(size=16)
    frame_dir = OUTPUT / "frames"
    frame_dir.mkdir(parents=True, exist_ok=True)
    frames: list[Image.Image] = []
    for index, shot in enumerate(shots):
        frame = frame_dir / f"{index:03d}.png"
        extract_midpoint(shot, frame)
        image = Image.open(frame).convert("RGB")
        tile = Image.new("RGB", (TILE_W, TILE_H), "#090a0e")
        tile.paste(image, (0, 0))
        draw = ImageDraw.Draw(tile)
        label = f"{index:03d}  {shot.stem}"
        draw.text((8, IMAGE_H + 3), label[:61], fill="#f5e4b4", font=font)
        frames.append(tile)

    per_page = COLS * ROWS
    for page_index in range((len(frames) + per_page - 1) // per_page):
        sheet = Image.new("RGB", (COLS * TILE_W, ROWS * TILE_H), "black")
        for local_index, tile in enumerate(frames[page_index * per_page:(page_index + 1) * per_page]):
            x = (local_index % COLS) * TILE_W
            y = (local_index // COLS) * TILE_H
            sheet.paste(tile, (x, y))
        destination = OUTPUT / f"v24-shots-{page_index * per_page:03d}-{min((page_index + 1) * per_page - 1, len(frames) - 1):03d}.jpg"
        sheet.save(destination, quality=93, subsampling=0)
        print(destination)


if __name__ == "__main__":
    main()
