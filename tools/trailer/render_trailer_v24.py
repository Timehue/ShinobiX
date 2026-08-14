"""Render V24 with stable raid/stag animation and a clarified tactical fight."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from render_trailer_v5 import Shot, ffmpeg_path, make_caption, render_shot, run
from render_trailer_v21 import read_manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    root = args.root.resolve()
    ffmpeg = ffmpeg_path()
    work = root / "tmp" / "trailer" / "render-v24"
    clips = work / "clips"
    output_dir = root / "output" / "trailer"
    v24 = output_dir / "framepack-v24"
    for directory in (work, clips, output_dir):
        directory.mkdir(parents=True, exist_ok=True)

    by_index = read_manifest(root / "tmp" / "trailer" / "render-v23" / "concat-v23.txt")

    tactical_opener = v24 / "118-tactical-opener-clarity-v24.mp4"
    tactical_main = v24 / "119-tactical-main-clarity-v24.mp4"
    oni_source = v24 / "116-squad-giant-oni-stable-v24.mp4"
    stag_source = v24 / "117-hollow-stag-stable-v24.mp4"
    for source in (tactical_opener, tactical_main, oni_source, stag_source):
        if not source.exists():
            raise FileNotFoundError(source)

    by_index[49] = tactical_opener
    by_index[50] = tactical_main

    raid_caption = work / "caption-conquer-epic-raids.png"
    make_caption(raid_caption, "CONQUER EPIC RAIDS")
    raid_clip = clips / "051-giant-oni-raid-stable-v24.mp4"
    render_shot(
        ffmpeg,
        Shot("giant-oni-raid-stable", oni_source, 1.900, caption="CONQUER EPIC RAIDS"),
        raid_caption,
        raid_clip,
    )
    by_index[51] = raid_clip

    stag_clip = clips / "054-hollow-stag-stable-v24.mp4"
    render_shot(
        ffmpeg,
        Shot("hollow-stag-stable", stag_source, 2.000),
        None,
        stag_clip,
    )
    by_index[54] = stag_clip

    clip_paths = [by_index[index] for index in range(60)]
    concat_file = work / "concat-v24.txt"
    concat_file.write_text(
        "".join(f"file '{path.as_posix()}'\n" for path in clip_paths),
        encoding="utf-8",
    )
    silent = work / "silent-v24.mp4"
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(silent)])

    v23_master = output_dir / "shinobi-journey-epic-anime-promo-v23-1080p.mp4"
    if not v23_master.exists():
        raise FileNotFoundError(v23_master)
    temporary = work / "final-v24.tmp.mp4"
    trailer = output_dir / "shinobi-journey-epic-anime-promo-v24-1080p.mp4"
    run([
        ffmpeg, "-y", "-i", str(silent), "-i", str(v23_master),
        "-map", "0:v:0", "-map", "1:a:0", "-c", "copy",
        "-movflags", "+faststart", str(temporary),
    ])
    os.replace(temporary, trailer)
    print(f"Rendered {trailer}")


if __name__ == "__main__":
    main()
