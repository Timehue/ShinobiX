"""Render V23 with a stronger elemental war and post-dragon raid climax."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from render_trailer_v5 import Shot, ffmpeg_path, make_caption, render_shot, run
from render_trailer_v9 import make_music_edit_v14
from render_trailer_v21 import read_manifest


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
    work = root / "tmp" / "trailer" / "render-v23"
    clips = work / "clips"
    output_dir = root / "output" / "trailer"
    v23 = output_dir / "framepack-v23"
    for directory in (work, clips, output_dir):
        directory.mkdir(parents=True, exist_ok=True)

    by_index = read_manifest(root / "tmp" / "trailer" / "render-v22" / "concat-v22.txt")

    war_source = v23 / "114-village-elemental-war-strong-v23.mp4"
    finisher_source = v23 / "115-squad-leviathan-finisher-v23-final.mp4"
    for source in (war_source, finisher_source):
        if not source.exists():
            raise FileNotFoundError(source)

    war_caption = work / "caption-village-war.png"
    make_caption(war_caption, "VILLAGE VS VILLAGE WAR")
    war_clip = clips / "055-elemental-village-war-strong-v23.mp4"
    render_shot(
        ffmpeg,
        Shot("elemental-village-war-strong", war_source, 2.000, caption="VILLAGE VS VILLAGE WAR"),
        war_caption,
        war_clip,
    )
    by_index[55] = war_clip

    finisher_clip = clips / "057-squad-leviathan-finisher-v23.mp4"
    render_shot(
        ffmpeg,
        Shot("squad-leviathan-finisher", finisher_source, 1.700),
        None,
        finisher_clip,
    )
    by_index[57] = finisher_clip
    print("Replaced shots 055 and 057", flush=True)

    clip_paths = [by_index[index] for index in range(60)]
    concat_file = work / "concat-v23.txt"
    concat_file.write_text(
        "".join(f"file '{path.as_posix()}'\n" for path in clip_paths),
        encoding="utf-8",
    )
    silent = work / "silent-v23.mp4"
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(silent)])

    music = work / "music-v23.wav"
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
        (sfx / "battle-transition.wav", 105.567, 0.034),
        (sfx / "battle-transition.wav", 106.311, 0.045),
        (sfx / "impact-heavy.wav", 107.833, 0.044),
        (sfx / "impact-heavy.wav", 109.211, 0.055),
        (sfx / "impact-heavy.wav", 110.100, 0.042),
        (sfx / "battle-transition.wav", 111.233, 0.032),
        (sfx / "battle-transition.wav", 120.267, 0.045),
        (sfx / "impact-heavy.wav", 121.267, 0.055),
        (sfx / "impact-heavy.wav", 123.902, 0.08),
        (sfx / "impact-heavy.wav", 124.867, 0.050),
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

    temporary = work / "final-v23.tmp.mp4"
    trailer = output_dir / "shinobi-journey-epic-anime-promo-v23-1080p.mp4"
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
