"""Render V20 by replacing four V19 clips and preserving the approved master edit."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from render_trailer_v5 import Shot, ffmpeg_path, make_caption, render_shot, run
from render_trailer_v9 import make_music_edit_v14


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
    v19_work = root / "tmp" / "trailer" / "render-v19"
    work = root / "tmp" / "trailer" / "render-v20"
    clips_dir = work / "clips"
    overlays_dir = work / "overlays"
    v20 = root / "output" / "trailer" / "framepack-v20"
    output_dir = root / "output" / "trailer"
    for directory in (work, clips_dir, overlays_dir, output_dir):
        directory.mkdir(parents=True, exist_ok=True)

    v19_manifest = v19_work / "concat-v19.txt"
    if not v19_manifest.exists():
        raise FileNotFoundError(v19_manifest)
    base_clips = []
    for line in v19_manifest.read_text(encoding="utf-8").splitlines():
        if line.startswith("file '") and line.endswith("'"):
            base_clips.append(Path(line[6:-1]))
    if len(base_clips) != 60:
        raise RuntimeError(f"Expected 60 active V19 clips, found {len(base_clips)}")
    by_index = {int(path.name[:3]): path for path in base_clips}
    if set(by_index) != set(range(60)):
        raise RuntimeError("V19 clip indices are incomplete")

    caption = overlays_dir / "caption-tactical-1v1.png"
    make_caption(caption, "TACTICAL 1V1 JUTSU BATTLES")
    replacements = {
        31: Shot("earth-wall-eruption", v20 / "107-earth-wall-eruption-v20-final.mp4", 2.000),
        32: Shot("earth-boulder-lift", v20 / "108-earth-boulder-lift-v20-final.mp4", 2.200),
        49: Shot(
            "tactical-1v1-smooth",
            v20 / "109-tactical-1v1-smooth-v20.mp4",
            2.100,
            caption="TACTICAL 1V1 JUTSU BATTLES",
        ),
        50: Shot("jutsu-fight-smooth", v20 / "110-jutsu-fight-smooth-v20.mp4", 5.900),
    }

    for index, shot in replacements.items():
        if not shot.source.exists():
            raise FileNotFoundError(shot.source)
        destination = clips_dir / f"{index:03d}-{shot.name}.mp4"
        render_shot(
            ffmpeg,
            shot,
            caption if shot.caption else None,
            destination,
        )
        by_index[index] = destination
        print(f"Replaced shot {index:03d}: {shot.name}", flush=True)

    clip_paths = [by_index[index] for index in range(60)]
    concat_file = work / "concat-v20.txt"
    concat_file.write_text(
        "".join(f"file '{path.as_posix()}'\n" for path in clip_paths),
        encoding="utf-8",
    )
    silent = work / "silent-v20.mp4"
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(silent)])

    music = work / "music-v20.wav"
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
        (sfx / "impact-heavy.wav", 123.902, 0.08),
        (sfx / "victory-seal.wav", 127.352, 0.09),
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

    temporary = work / "final-v20.tmp.mp4"
    trailer = output_dir / "shinobi-journey-epic-anime-promo-v20-1080p.mp4"
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
