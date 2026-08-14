"""Build a crisp seven-beat tactical 1v1 sequence for trailer V21."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from render_trailer_v5 import FPS, ffmpeg_path, run


@dataclass(frozen=True)
class Beat:
    source: str
    frames: int


BEATS = (
    Beat("97-lightning-dive-water-dodge-v19-smooth.mp4", 36),
    Beat("98-water-counter-evade-v19-smooth.mp4", 34),
    Beat("103-low-kick-water-evade-v19-smooth.mp4", 34),
    Beat("104-rising-knee-lightning-guard-v19-smooth.mp4", 34),
    Beat("99-close-jutsu-parry-v19-smooth.mp4", 34),
    Beat("100-water-palm-lightning-guard-v19-smooth.mp4", 34),
    Beat("105-water-wheel-kick-lightning-guard-v19-smooth.mp4", 34),
)


def retime_beat(ffmpeg: str, source: Path, frames: int, destination: Path) -> None:
    """Accelerate a clean motion pass without temporal blending or frozen tails."""
    # The normalized FramePack passes contain 52 source frames each.
    # Mapping first-to-last frame avoids both a frozen tail and a short output.
    source_frames = 52
    factor = (frames - 1) / (source_frames - 1)
    graph = (
        "setpts=(PTS-STARTPTS)*" + f"{factor:.8f},"
        "minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,"
        "tpad=stop_mode=clone:stop_duration=0.067,"
        f"fps={FPS},trim=start_frame=0:end_frame={frames},setpts=PTS-STARTPTS,"
        "deflicker=size=3:mode=am,hqdn3d=0.12:0.10:0.45:0.35,"
        "eq=contrast=1.045:saturation=1.055:gamma=1.018:brightness=0.004,"
        "cas=strength=0.56,unsharp=5:5:0.22:5:5:0.0,"
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


def cut(ffmpeg: str, source: Path, start_frame: int, frames: int, destination: Path) -> None:
    graph = (
        f"trim=start_frame={start_frame}:end_frame={start_frame + frames},"
        "setpts=PTS-STARTPTS,format=yuv420p"
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
    ffmpeg = ffmpeg_path()
    normalized = root / "tmp" / "trailer" / "render-v19-fight" / "normalized"
    work = root / "tmp" / "trailer" / "render-v21-tactical"
    cuts = work / "beats"
    output = root / "output" / "trailer" / "framepack-v21"
    for directory in (work, cuts, output):
        directory.mkdir(parents=True, exist_ok=True)

    beat_paths: list[Path] = []
    for index, beat in enumerate(BEATS):
        source = normalized / beat.source
        if not source.exists():
            raise FileNotFoundError(source)
        destination = cuts / f"{index:02d}-{source.stem}-v21.mp4"
        print(f"Retiming beat {index + 1}/{len(BEATS)}: {source.stem}", flush=True)
        retime_beat(ffmpeg, source, beat.frames, destination)
        beat_paths.append(destination)

    manifest = work / "seven-beat-sequence.txt"
    manifest.write_text(
        "".join(f"file '{path.as_posix()}'\n" for path in beat_paths),
        encoding="utf-8",
    )
    full = output / "113-tactical-seven-beat-full-v21.mp4"
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(manifest), "-c", "copy", str(full)])

    opener = output / "111-tactical-seven-beat-opener-v21.mp4"
    main = output / "112-tactical-seven-beat-main-v21.mp4"
    cut(ffmpeg, full, 0, 63, opener)
    cut(ffmpeg, full, 63, 177, main)
    print(f"Wrote {full}", flush=True)
    print(f"Wrote {opener}", flush=True)
    print(f"Wrote {main}", flush=True)


if __name__ == "__main__":
    main()
