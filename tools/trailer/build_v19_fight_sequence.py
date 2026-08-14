"""Smooth, restore detail, and cut the approved V19 duel motion passes."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from render_trailer_v5 import FPS, ffmpeg_path, run


@dataclass(frozen=True)
class Beat:
    stem: str
    frames: int


BEATS = (
    Beat("98-water-counter-evade-v19", 45),
    Beat("99-close-jutsu-parry-v19", 42),
    Beat("100-water-palm-lightning-guard-v19", 45),
    Beat("105-water-wheel-kick-lightning-guard-v19", 45),
)


def normalize(
    ffmpeg: str,
    motion: Path,
    keyframe: Path,
    destination: Path,
) -> None:
    """Interpolate low-motion SVD output without introducing overlay ghosts."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not keyframe.exists():
        raise FileNotFoundError(keyframe)
    graph = (
        "[0:v]setpts=PTS-STARTPTS,"
        "minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,"
        "scale=1920:1080:flags=lanczos,"
        "eq=contrast=1.045:saturation=1.06:gamma=1.025:brightness=0.008,"
        "cas=strength=0.52,unsharp=5:5:0.20:5:5:0.0,"
        "drawbox=x=0:y=0:w=iw:h=36:color=black:t=fill,"
        "drawbox=x=0:y=1044:w=iw:h=36:color=black:t=fill,"
        "format=yuv420p[out]"
    )
    run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(motion),
            "-filter_complex",
            graph,
            "-map",
            "[out]",
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


def trim_frames(ffmpeg: str, source: Path, frames: int, destination: Path) -> None:
    run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(source),
            "-vf",
            f"trim=start_frame=0:end_frame={frames},setpts=PTS-STARTPTS,format=yuv420p",
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


def retime_frames(
    ffmpeg: str,
    source: Path,
    frames: int,
    destination: Path,
    factor: float = 1.18,
) -> None:
    """Extend a short motion pass with optical flow instead of a frozen tail."""
    run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(source),
            "-vf",
            (
                f"setpts=PTS*{factor:.6f},"
                "minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,"
                f"trim=start_frame=0:end_frame={frames},setpts=PTS-STARTPTS,format=yuv420p"
            ),
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
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    root = args.root.resolve()
    keyframes = root / "tmp" / "trailer" / "cinematic-v19"
    sources = root / "output" / "trailer" / "framepack-v19"
    work = root / "tmp" / "trailer" / "render-v19-fight"
    normalized = work / "normalized"
    cut_dir = work / "cuts"
    for directory in (sources, work, normalized, cut_dir):
        directory.mkdir(parents=True, exist_ok=True)

    ffmpeg = ffmpeg_path()
    all_stems = [beat.stem for beat in BEATS] + [
        "97-lightning-dive-water-dodge-v19",
        "101-vault-over-lightning-sweep-v19",
        "103-low-kick-water-evade-v19",
        "104-rising-knee-lightning-guard-v19",
    ]
    normalized_paths: dict[str, Path] = {}
    for stem in all_stems:
        motion = sources / f"{stem}-svd.mp4"
        keyframe = keyframes / f"{stem}.png"
        destination = normalized / f"{stem}-smooth.mp4"
        if not motion.exists():
            raise FileNotFoundError(motion)
        if not keyframe.exists():
            raise FileNotFoundError(keyframe)
        if args.force or not destination.exists() or destination.stat().st_size < 100_000:
            print(f"Normalizing {stem}", flush=True)
            normalize(ffmpeg, motion, keyframe, destination)
        normalized_paths[stem] = destination

    cuts: list[Path] = []
    for index, beat in enumerate(BEATS):
        destination = cut_dir / f"{index:02d}-{beat.stem}.mp4"
        if args.force or not destination.exists() or destination.stat().st_size < 100_000:
            print(f"Cutting {beat.stem} to {beat.frames} frames", flush=True)
            trim_frames(ffmpeg, normalized_paths[beat.stem], beat.frames, destination)
        cuts.append(destination)

    concat = work / "fight-sequence.txt"
    concat.write_text(
        "".join(f"file '{path.as_posix()}'\n" for path in cuts),
        encoding="utf-8",
    )
    sequence = sources / "102-jutsu-fight-sequence-v19-final.mp4"
    run(
        [
            ffmpeg,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat),
            "-c",
            "copy",
            str(sequence),
        ]
    )

    finale = sources / "101-vault-over-lightning-sweep-v19-final.mp4"
    trim_frames(
        ffmpeg,
        normalized_paths["101-vault-over-lightning-sweep-v19"],
        51,
        finale,
    )

    elemental_replacement = sources / "103-low-kick-water-evade-v19-final.mp4"
    retime_frames(
        ffmpeg,
        normalized_paths["103-low-kick-water-evade-v19"],
        60,
        elemental_replacement,
    )

    rooftop_replacement = sources / "104-rising-knee-lightning-guard-v19-final.mp4"
    retime_frames(
        ffmpeg,
        normalized_paths["104-rising-knee-lightning-guard-v19"],
        66,
        rooftop_replacement,
        factor=1.30,
    )

    tactical_opener = sources / "106-lightning-dive-water-dodge-v19-final.mp4"
    retime_frames(
        ffmpeg,
        normalized_paths["97-lightning-dive-water-dodge-v19"],
        63,
        tactical_opener,
        factor=1.28,
    )

    print(f"Wrote {sequence}", flush=True)
    print(f"Wrote {finale}", flush=True)
    print(f"Wrote {elemental_replacement}", flush=True)
    print(f"Wrote {rooftop_replacement}", flush=True)
    print(f"Wrote {tactical_opener}", flush=True)


if __name__ == "__main__":
    main()
