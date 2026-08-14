"""Render V21 with factual jutsu captions, ambient motion, and a crisp duel."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from render_trailer_v5 import FPS, Shot, ffmpeg_path, make_caption, render_shot, run
from render_trailer_v9 import make_music_edit_v14


# These are the objectively lowest-motion narrative shots from the V20 audit.
# Effects are selected to belong to each scene and deliberately exclude shake.
AMBIENT: dict[int, tuple[str, float]] = {
    3: ("ash", 0.19),
    6: ("embers", 0.23),
    10: ("ash", 0.18),
    11: ("ash", 0.18),
    17: ("embers", 0.24),
    18: ("ash", 0.17),
    19: ("rain", 0.22),
    21: ("ash", 0.20),
    22: ("ash", 0.20),
    23: ("snow", 0.18),
    24: ("rain", 0.22),
    25: ("embers", 0.22),
    26: ("rain", 0.36),
    30: ("ash", 0.18),
    34: ("embers", 0.20),
    42: ("ash", 0.19),
    43: ("embers", 0.21),
    47: ("snow", 0.17),
    57: ("rain", 0.18),
    58: ("snow", 0.17),
}


def ambient_pass(
    ffmpeg: str,
    source: Path,
    plate: Path,
    opacity: float,
    destination: Path,
    storm_pulse: bool = False,
) -> None:
    """Screen a restrained particle plate into a shot while preserving title safe."""
    lighting = (
        "eq=contrast=1.012:saturation=1.008:gamma=1.003:"
        "brightness='0.010*sin(2*PI*t*2.2)':eval=frame,"
        if storm_pulse
        else "eq=contrast=1.012:saturation=1.008:gamma=1.003,"
    )
    graph = (
        "[0:v]setpts=PTS-STARTPTS,fps=30[base];"
        "[1:v]scale=1920:1080:flags=lanczos,setsar=1,fps=30,"
        "drawbox=x=0:y=0:w=iw:h=40:color=black:t=fill,"
        "drawbox=x=0:y=750:w=iw:h=330:color=black:t=fill[particles];"
        f"[base][particles]blend=all_mode=screen:all_opacity={opacity:.3f}:shortest=1,"
        + lighting
        + "cas=strength=0.18,"
        "drawbox=x=0:y=0:w=iw:h=36:color=black:t=fill,"
        "drawbox=x=0:y=1044:w=iw:h=36:color=black:t=fill,format=yuv420p[out]"
    )
    run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(source),
            "-stream_loop",
            "-1",
            "-i",
            str(plate),
            "-filter_complex",
            graph,
            "-map",
            "[out]",
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


def read_manifest(path: Path) -> dict[int, Path]:
    clips: list[Path] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("file '") and line.endswith("'"):
            clips.append(Path(line[6:-1]))
    if len(clips) != 60:
        raise RuntimeError(f"Expected 60 V20 clips, found {len(clips)}")
    indexed = {int(path.name[:3]): path for path in clips}
    if set(indexed) != set(range(60)):
        raise RuntimeError("V20 clip indices are incomplete")
    return indexed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--song",
        type=Path,
        default=Path(r"C:\Users\Tyler R\Downloads\SHINOBI ROASTED RICE 2.wav"),
    )
    args = parser.parse_args()

    root = args.root.resolve()
    ffmpeg = ffmpeg_path()
    work = root / "tmp" / "trailer" / "render-v21"
    clips_dir = work / "clips"
    bases_dir = work / "captioned-bases"
    overlays_dir = work / "overlays"
    plates_dir = root / "tmp" / "trailer" / "motion"
    v5 = root / "output" / "trailer" / "framepack-v5"
    v20 = root / "output" / "trailer" / "framepack-v20"
    v21 = root / "output" / "trailer" / "framepack-v21"
    output_dir = root / "output" / "trailer"
    for directory in (work, clips_dir, bases_dir, overlays_dir, v21, output_dir):
        directory.mkdir(parents=True, exist_ok=True)

    by_index = read_manifest(root / "tmp" / "trailer" / "render-v20" / "concat-v20.txt")

    jutsu_text = "LEARN OVER 100 JUTSU"
    jutsu_caption = overlays_dir / "caption-learn-over-100-jutsu.png"
    tactical_caption = overlays_dir / "caption-tactical-1v1.png"
    make_caption(jutsu_caption, jutsu_text)
    make_caption(tactical_caption, "TACTICAL 1V1 JUTSU BATTLES")

    custom = {
        31: Shot(
            "earth-wall-learn-100-jutsu",
            v20 / "107-earth-wall-eruption-v20-final.mp4",
            2.000,
            caption=jutsu_text,
        ),
        34: Shot(
            "fire-champion-learn-100-jutsu",
            v5 / "15-fire-champion-v5-proof.mp4",
            2.100,
            caption=jutsu_text,
            speed=0.52,
        ),
        49: Shot(
            "tactical-seven-beat-opener",
            v21 / "111-tactical-seven-beat-opener-v21.mp4",
            2.100,
            caption="TACTICAL 1V1 JUTSU BATTLES",
        ),
        50: Shot(
            "tactical-seven-beat-main",
            v21 / "112-tactical-seven-beat-main-v21.mp4",
            5.900,
        ),
    }
    for index, shot in custom.items():
        if not shot.source.exists():
            raise FileNotFoundError(shot.source)
        destination = bases_dir / f"{index:03d}-{shot.name}.mp4"
        overlay = jutsu_caption if index in {31, 34} else tactical_caption if index == 49 else None
        render_shot(ffmpeg, shot, overlay, destination)
        by_index[index] = destination
        print(f"Rebuilt shot {index:03d}: {shot.name}", flush=True)

    for index, (kind, opacity) in AMBIENT.items():
        source = by_index[index]
        plate = plates_dir / f"particles-{kind}.mp4"
        if not plate.exists():
            raise FileNotFoundError(plate)
        destination = clips_dir / f"{index:03d}-{source.stem[4:]}-{kind}-ambient-v21.mp4"
        ambient_pass(ffmpeg, source, plate, opacity, destination, storm_pulse=index == 26)
        by_index[index] = destination
        print(f"Animated shot {index:03d} with {kind}", flush=True)

    clip_paths = [by_index[index] for index in range(60)]
    concat_file = work / "concat-v21.txt"
    concat_file.write_text(
        "".join(f"file '{path.as_posix()}'\n" for path in clip_paths),
        encoding="utf-8",
    )
    silent = work / "silent-v21.mp4"
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(silent)])

    music = work / "music-v21.wav"
    make_music_edit_v14(ffmpeg, args.song.resolve(strict=True), music)
    sfx = root / "shinobij.client" / "public" / "sfx" / "production"
    events = [
        (sfx / "reveal.wav", 1.200, 0.07),
        (sfx / "battle-transition.wav", 8.545, 0.06),
        (sfx / "omen.wav", 14.303, 0.07),
        (sfx / "impact-heavy.wav", 27.121, 0.08),
        (sfx / "battle-transition.wav", 54.242, 0.06),
        (sfx / "impact-heavy.wav", 65.016, 0.07),
        (sfx / "battle-transition.wav", 67.016, 0.045),
        (sfx / "mythic.wav", 104.211, 0.07),
        (sfx / "battle-transition.wav", 106.311, 0.045),
        (sfx / "impact-heavy.wav", 109.211, 0.055),
        (sfx / "battle-transition.wav", 105.567, 0.034),
        (sfx / "impact-heavy.wav", 107.833, 0.044),
        (sfx / "impact-heavy.wav", 110.100, 0.042),
        (sfx / "battle-transition.wav", 111.233, 0.032),
        (sfx / "impact-heavy.wav", 123.902, 0.08),
        (sfx / "victory-seal.wav", 127.352, 0.085),
    ]
    command = [ffmpeg, "-y", "-i", str(silent), "-i", str(music)]
    for path, _, _ in events:
        command += ["-i", str(path)]
    filters = ["[1:a]volume=1.0[music]"]
    labels = ["[music]"]
    for index, (_, timestamp, volume) in enumerate(events):
        label = f"sfx{index}"
        filters.append(
            f"[{index + 2}:a]adelay={round(timestamp * 1000)}:all=1,"
            f"volume={volume}[{label}]"
        )
        labels.append(f"[{label}]")
    filters.append(
        "".join(labels)
        + f"amix=inputs={len(labels)}:duration=first:dropout_transition=0:normalize=0,"
        "alimiter=limit=0.96[aout]"
    )

    temporary = work / "final-v21.tmp.mp4"
    trailer = output_dir / "shinobi-journey-epic-anime-promo-v21-1080p.mp4"
    command += [
        "-filter_complex",
        ";".join(filters),
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "320k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(temporary),
    ]
    run(command)
    os.replace(temporary, trailer)
    print(f"Rendered {trailer}", flush=True)


if __name__ == "__main__":
    main()
