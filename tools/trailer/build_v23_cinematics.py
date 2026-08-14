"""Finish the V23 war and squad-versus-leviathan animations."""

from __future__ import annotations

import argparse
from pathlib import Path

from render_trailer_v5 import FPS, ffmpeg_path, run


def finish_svd(ffmpeg: str, source: Path, frames: int, destination: Path) -> None:
    graph = (
        "setpts=PTS-STARTPTS,"
        "minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,"
        "fps=30,tpad=stop_mode=clone:stop_duration=0.10,"
        f"trim=start_frame=0:end_frame={frames},setpts=PTS-STARTPTS,"
        "scale=1920:1080:flags=lanczos,"
        "deflicker=size=3:mode=am,hqdn3d=0.16:0.12:0.55:0.40,"
        "eq=contrast=1.045:saturation=1.060:gamma=1.016:brightness=0.004,"
        "cas=strength=0.54,unsharp=5:5:0.20:5:5:0.0,"
        "drawbox=x=0:y=0:w=iw:h=36:color=black:t=fill,"
        "drawbox=x=0:y=1044:w=iw:h=36:color=black:t=fill,format=yuv420p"
    )
    run([
        ffmpeg, "-loglevel", "error", "-y", "-i", str(source), "-vf", graph,
        "-frames:v", str(frames), "-an", "-c:v", "libx264", "-preset", "slow",
        "-crf", "14", "-pix_fmt", "yuv420p", "-r", str(FPS), str(destination),
    ], quiet=True)


def add_fx(ffmpeg: str, source: Path, fx: Path, frames: int, opacity: float, destination: Path) -> None:
    graph = (
        "[0:v]setpts=PTS-STARTPTS,format=gbrp[base];"
        "[1:v]scale=1920:1080:flags=lanczos,setpts=PTS-STARTPTS,format=gbrp[fx];"
        f"[base][fx]blend=all_mode=screen:all_opacity={opacity:.3f}:shortest=1,"
        "eq=contrast=1.012:saturation=1.018:gamma=1.004,cas=strength=0.22,"
        "drawbox=x=0:y=0:w=iw:h=36:color=black:t=fill,"
        "drawbox=x=0:y=1044:w=iw:h=36:color=black:t=fill,format=yuv420p[out]"
    )
    run([
        ffmpeg, "-loglevel", "error", "-y", "-i", str(source), "-i", str(fx),
        "-filter_complex", graph, "-map", "[out]", "-frames:v", str(frames), "-an",
        "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p",
        "-r", str(FPS), str(destination),
    ], quiet=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    root = args.root.resolve()
    ffmpeg = ffmpeg_path()
    v22 = root / "output" / "trailer" / "framepack-v22"
    v23 = root / "output" / "trailer" / "framepack-v23"
    fx = root / "tmp" / "trailer" / "cinematic-v23" / "elemental-battle-fx-v23.mp4"
    v23.mkdir(parents=True, exist_ok=True)
    if not fx.exists():
        raise FileNotFoundError(fx)

    finisher_svd = v23 / "115-squad-leviathan-finisher-v23-svd.mp4"
    finisher_clean = v23 / "115-squad-leviathan-finisher-v23-clean.mp4"
    if not finisher_svd.exists():
        raise FileNotFoundError(finisher_svd)
    finish_svd(ffmpeg, finisher_svd, 51, finisher_clean)
    add_fx(
        ffmpeg,
        finisher_clean,
        fx,
        51,
        0.36,
        v23 / "115-squad-leviathan-finisher-v23-final.mp4",
    )

    war_source = v22 / "114-village-elemental-war-v22-final.mp4"
    if not war_source.exists():
        raise FileNotFoundError(war_source)
    add_fx(
        ffmpeg,
        war_source,
        fx,
        60,
        0.52,
        v23 / "114-village-elemental-war-strong-v23.mp4",
    )
    print(f"Wrote V23 cinematics in {v23}", flush=True)


if __name__ == "__main__":
    main()
