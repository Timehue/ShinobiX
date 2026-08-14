"""Finish the V20 earth-jutsu shots and smooth the featured V19 duel."""

from __future__ import annotations

import argparse
from pathlib import Path

from render_trailer_v5 import FPS, ffmpeg_path, run


def finish_earth(
    ffmpeg: str,
    source: Path,
    frames: int,
    destination: Path,
    stretch: float,
    camera_motion: bool = False,
) -> None:
    camera = (
        "zoompan=z='min(1.0+on*0.00028,1.018)':"
        "x='iw/2-(iw/zoom/2)+on*0.035':"
        "y='ih/2-(ih/zoom/2)-on*0.018':d=1:s=1920x1080:fps=30,"
        if camera_motion
        else ""
    )
    graph = (
        "setpts=PTS-STARTPTS,"
        "minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,"
        f"setpts=PTS*{stretch:.6f},fps={FPS},"
        "tpad=stop_mode=clone:stop_duration=0.20,"
        f"trim=start_frame=0:end_frame={frames},setpts=PTS-STARTPTS,"
        "scale=1920:1080:flags=lanczos,"
        + camera
        +
        "deflicker=size=3:mode=am,hqdn3d=0.25:0.20:1.0:0.8,"
        "eq=contrast=1.045:saturation=1.055:gamma=1.020:brightness=0.006,"
        "cas=strength=0.48,unsharp=5:5:0.18:5:5:0.0,"
        "drawbox=x=0:y=0:w=iw:h=36:color=black:t=fill,"
        "drawbox=x=0:y=1044:w=iw:h=36:color=black:t=fill,format=yuv420p"
    )
    run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(source),
            "-vf",
            graph,
            "-frames:v",
            str(frames),
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


def smooth_duel(ffmpeg: str, source: Path, frames: int, destination: Path) -> None:
    """Reduce AI shimmer while retaining the short impact-smear cuts."""
    graph = (
        "setpts=PTS-STARTPTS,"
        "minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,"
        "tblend=all_expr='0.88*A+0.12*B',fps=30,"
        "deflicker=size=3:mode=am,hqdn3d=0.35:0.28:1.5:1.1,"
        "tpad=stop_mode=clone:stop_duration=0.10,"
        f"trim=start_frame=0:end_frame={frames},setpts=PTS-STARTPTS,"
        "eq=contrast=1.035:saturation=1.045:gamma=1.015:brightness=0.004,"
        "cas=strength=0.40,unsharp=5:5:0.15:5:5:0.0,format=yuv420p"
    )
    run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(source),
            "-vf",
            graph,
            "-frames:v",
            str(frames),
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()

    root = args.root.resolve()
    v19 = root / "output" / "trailer" / "framepack-v19"
    v20 = root / "output" / "trailer" / "framepack-v20"
    v20.mkdir(parents=True, exist_ok=True)
    ffmpeg = ffmpeg_path()

    earth_specs = (
        ("107-earth-wall-eruption-v20", 60, 1.05, False),
        ("108-earth-boulder-lift-v20", 66, 1.16, True),
    )
    for stem, frames, stretch, camera_motion in earth_specs:
        source = v20 / f"{stem}-svd.mp4"
        destination = v20 / f"{stem}-final.mp4"
        if not source.exists():
            raise FileNotFoundError(source)
        finish_earth(ffmpeg, source, frames, destination, stretch, camera_motion)
        print(f"Wrote {destination}", flush=True)

    duel_specs = (
        ("106-lightning-dive-water-dodge-v19-final.mp4", 63, "109-tactical-1v1-smooth-v20.mp4"),
        ("102-jutsu-fight-sequence-v19-final.mp4", 177, "110-jutsu-fight-smooth-v20.mp4"),
    )
    for source_name, frames, destination_name in duel_specs:
        source = v19 / source_name
        destination = v20 / destination_name
        if not source.exists():
            raise FileNotFoundError(source)
        smooth_duel(ffmpeg, source, frames, destination)
        print(f"Wrote {destination}", flush=True)


if __name__ == "__main__":
    main()
