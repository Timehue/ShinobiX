"""Turn 2x2 generated animation sheets into 30 fps pose-to-pose clips."""

from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

from PIL import Image


def ffmpeg_path() -> str:
    discovered = shutil.which("ffmpeg")
    if discovered:
        return discovered
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def run(command: list[str]) -> None:
    print(" ".join(f'"{part}"' if " " in part else part for part in command), flush=True)
    completed = subprocess.run(command, check=False)
    if completed.returncode:
        raise RuntimeError(f"Command failed with exit code {completed.returncode}")


def split_sheet(sheet: Path, frame_dir: Path) -> list[Path]:
    frame_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(sheet) as image:
        image = image.convert("RGB")
        half_width = image.width // 2
        half_height = image.height // 2
        boxes = [
            (0, 0, half_width, half_height),
            (image.width - half_width, 0, image.width, half_height),
            (0, image.height - half_height, half_width, image.height),
            (image.width - half_width, image.height - half_height, image.width, image.height),
        ]
        frames = []
        for index, box in enumerate(boxes):
            destination = frame_dir / f"{index:02d}.png"
            image.crop(box).save(destination)
            frames.append(destination)
    return frames


def animate(ffmpeg: str, frame_dir: Path, destination: Path, seconds: float) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    graph = (
        "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,"
        "crop=1920:1080,"
        "minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:"
        "vsbmc=1:mb_size=8:search_param=64,"
        "tblend=all_mode=average:all_opacity=0.12,"
        "eq=contrast=1.045:saturation=1.055:gamma=1.005,"
        "unsharp=5:5:0.20:5:5:0.0,"
        "drawbox=x=0:y=0:w=iw:h=58:color=black:t=fill,"
        "drawbox=x=0:y=1022:w=iw:h=58:color=black:t=fill,format=yuv420p"
    )
    run([
        ffmpeg,
        "-loglevel",
        "error",
        "-y",
        "-framerate",
        "1",
        "-start_number",
        "0",
        "-i",
        str(frame_dir / "%02d.png"),
        "-vf",
        graph,
        "-t",
        f"{seconds:.3f}",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "15",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        str(destination),
    ])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sheet", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--seconds", type=float, default=3.0)
    parser.add_argument("--frames-dir", type=Path)
    args = parser.parse_args()

    sheet = args.sheet.resolve(strict=True)
    output = args.output.resolve()
    frame_dir = (args.frames_dir or output.with_suffix("")).resolve()
    split_sheet(sheet, frame_dir)
    animate(ffmpeg_path(), frame_dir, output, args.seconds)
    print(f"Wrote {output}", flush=True)


if __name__ == "__main__":
    main()
