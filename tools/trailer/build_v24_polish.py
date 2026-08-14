"""Build stable V24 action replacements and a clearer tactical grade."""

from __future__ import annotations

import argparse
from pathlib import Path

from render_trailer_v5 import FPS, ffmpeg_path, run


def animate_still(
    ffmpeg: str,
    source: Path,
    fx: Path,
    frames: int,
    opacity: float,
    crop_y: int,
    gamma: float,
    brightness: float,
    destination: Path,
) -> None:
    zoom = 0.022 if frames <= 57 else 0.018
    graph = (
        "[0:v]scale=1920:1280:force_original_aspect_ratio=increase:flags=lanczos,"
        f"crop=1920:1080:0:{crop_y},"
        f"zoompan=z='1+{zoom:.6f}*on/{frames - 1}':"
        "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=30,"
        "format=gbrp[base];"
        "[1:v]scale=1920:1080:flags=lanczos,setpts=PTS-STARTPTS,format=gbrp[fx];"
        f"[base][fx]blend=all_mode=screen:all_opacity={opacity:.3f}:shortest=1,"
        f"eq=contrast=1.040:saturation=1.045:gamma={gamma:.3f}:brightness={brightness:.3f},"
        "cas=strength=0.48,unsharp=5:5:0.16:5:5:0.0,"
        "drawbox=x=0:y=0:w=iw:h=36:color=black:t=fill,"
        "drawbox=x=0:y=1044:w=iw:h=36:color=black:t=fill,format=yuv420p[out]"
    )
    run([
        ffmpeg, "-loglevel", "error", "-y", "-loop", "1", "-framerate", str(FPS),
        "-i", str(source), "-i", str(fx), "-filter_complex", graph, "-map", "[out]",
        "-frames:v", str(frames), "-an", "-c:v", "libx264", "-preset", "slow",
        "-crf", "14", "-pix_fmt", "yuv420p", "-r", str(FPS), str(destination),
    ], quiet=True)


def polish_tactical(ffmpeg: str, source: Path, destination: Path) -> None:
    graph = (
        "hqdn3d=0.42:0.32:1.15:0.90,"
        "eq=contrast=1.050:saturation=1.065:gamma=1.145:brightness=0.010,"
        "curves=all='0/0 0.12/0.180 0.50/0.575 0.88/0.925 1/1',"
        "cas=strength=0.72,unsharp=5:5:0.22:5:5:0.0,format=yuv420p"
    )
    run([
        ffmpeg, "-loglevel", "error", "-y", "-i", str(source), "-vf", graph,
        "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "14",
        "-pix_fmt", "yuv420p", "-r", str(FPS), str(destination),
    ], quiet=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    root = args.root.resolve()
    ffmpeg = ffmpeg_path()
    output = root / "output" / "trailer" / "framepack-v24"
    output.mkdir(parents=True, exist_ok=True)
    fx = root / "tmp" / "trailer" / "cinematic-v24"

    animate_still(
        ffmpeg,
        root / "tmp" / "trailer" / "cinematic-v9" / "73-squad-giant-oni-v9.png",
        fx / "oni-raid-fx-v24.mp4",
        57,
        0.54,
        20,
        1.080,
        0.012,
        output / "116-squad-giant-oni-stable-v24.mp4",
    )
    animate_still(
        ffmpeg,
        root / "tmp" / "trailer" / "cinematic-v9" / "75-squad-hollow-stag-v9.png",
        fx / "hollow-stag-fx-v24.mp4",
        60,
        0.36,
        75,
        1.025,
        0.004,
        output / "117-hollow-stag-stable-v24.mp4",
    )
    polish_tactical(
        ffmpeg,
        root / "tmp" / "trailer" / "render-v21" / "captioned-bases" / "049-tactical-seven-beat-opener.mp4",
        output / "118-tactical-opener-clarity-v24.mp4",
    )
    polish_tactical(
        ffmpeg,
        root / "tmp" / "trailer" / "render-v21" / "captioned-bases" / "050-tactical-seven-beat-main.mp4",
        output / "119-tactical-main-clarity-v24.mp4",
    )
    print(f"Wrote V24 polished action clips in {output}")


if __name__ == "__main__":
    main()
