"""Finish the V22 elemental-war motion pass at master resolution."""

from __future__ import annotations

import argparse
from pathlib import Path

from render_trailer_v5 import FPS, ffmpeg_path, run


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()

    root = args.root.resolve()
    ffmpeg = ffmpeg_path()
    output = root / "output" / "trailer" / "framepack-v22"
    source = output / "114-village-elemental-war-v22-svd.mp4"
    destination = output / "114-village-elemental-war-v22-final.mp4"
    if not source.exists():
        raise FileNotFoundError(source)

    graph = (
        "setpts=PTS-STARTPTS,"
        "minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,"
        "fps=30,tpad=stop_mode=clone:stop_duration=0.10,"
        "trim=start_frame=0:end_frame=60,setpts=PTS-STARTPTS,"
        "scale=1920:1080:flags=lanczos,"
        "deflicker=size=3:mode=am,hqdn3d=0.18:0.14:0.60:0.45,"
        "eq=contrast=1.045:saturation=1.065:gamma=1.016:brightness=0.004,"
        "cas=strength=0.52,unsharp=5:5:0.20:5:5:0.0,"
        "drawbox=x=0:y=0:w=iw:h=36:color=black:t=fill,"
        "drawbox=x=0:y=1044:w=iw:h=36:color=black:t=fill,format=yuv420p"
    )
    run(
        [
            ffmpeg,
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-vf",
            graph,
            "-frames:v",
            "60",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "14",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(FPS),
            str(destination),
        ],
        quiet=True,
    )
    print(f"Wrote {destination}", flush=True)


if __name__ == "__main__":
    main()
