"""Render V22 with a continuous jutsu caption and a true elemental war."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from render_trailer_v5 import FPS, Shot, ffmpeg_path, make_caption, render_shot, run
from render_trailer_v9 import make_music_edit_v14
from render_trailer_v21 import ambient_pass, read_manifest


JUTSU_FRAMES = (60, 66, 63, 63)


def encode_concat(ffmpeg: str, paths: list[Path], frames: int, manifest: Path, destination: Path) -> None:
    manifest.write_text(
        "".join(f"file '{path.as_posix()}'\n" for path in paths),
        encoding="utf-8",
    )
    run(
        [
            ffmpeg,
            "-loglevel",
            "error",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(manifest),
            "-vf",
            "fps=30,format=yuv420p",
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


def caption_sequence(ffmpeg: str, source: Path, caption: Path, frames: int, destination: Path) -> None:
    duration = frames / FPS
    graph = (
        "[0:v]setpts=PTS-STARTPTS[base];"
        f"[1:v]format=rgba,fade=t=in:st=0:d=0.10:alpha=1,"
        f"fade=t=out:st={duration - 0.20:.3f}:d=0.18:alpha=1[text];"
        "[base][text]overlay=0:0:shortest=1,format=yuv420p[out]"
    )
    run(
        [
            ffmpeg,
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-loop",
            "1",
            "-framerate",
            str(FPS),
            "-i",
            str(caption),
            "-filter_complex",
            graph,
            "-map",
            "[out]",
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


def cut(ffmpeg: str, source: Path, start: int, frames: int, destination: Path) -> None:
    run(
        [
            ffmpeg,
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-vf",
            f"trim=start_frame={start}:end_frame={start + frames},setpts=PTS-STARTPTS,format=yuv420p",
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


def rebuild_jutsu_showcase(
    root: Path,
    ffmpeg: str,
    work: Path,
    by_index: dict[int, Path],
) -> None:
    bases = work / "jutsu-bases"
    bases.mkdir(parents=True, exist_ok=True)
    v5 = root / "output" / "trailer" / "framepack-v5"
    v20 = root / "output" / "trailer" / "framepack-v20"
    specs = (
        Shot("earth-wall", v20 / "107-earth-wall-eruption-v20-final.mp4", 2.000),
        Shot("earth-boulder", v20 / "108-earth-boulder-lift-v20-final.mp4", 2.200),
        Shot("ice-champion", v5 / "14-ice-champion-v5-proof.mp4", 2.100, speed=0.52),
        Shot("fire-champion", v5 / "15-fire-champion-v5-proof.mp4", 2.100, speed=0.52),
    )
    clean: list[Path] = []
    for index, shot in enumerate(specs, start=31):
        destination = bases / f"{index:03d}-{shot.name}-clean.mp4"
        render_shot(ffmpeg, shot, None, destination)
        clean.append(destination)

    plates = root / "tmp" / "trailer" / "motion"
    ice_ambient = bases / "033-ice-champion-snow-v22.mp4"
    fire_ambient = bases / "034-fire-champion-embers-v22.mp4"
    ambient_pass(ffmpeg, clean[2], plates / "particles-snow.mp4", 0.18, ice_ambient)
    ambient_pass(ffmpeg, clean[3], plates / "particles-embers.mp4", 0.20, fire_ambient)
    clean[2] = ice_ambient
    clean[3] = fire_ambient

    total_frames = sum(JUTSU_FRAMES)
    clean_sequence = work / "jutsu-showcase-clean-v22.mp4"
    encode_concat(
        ffmpeg,
        clean,
        total_frames,
        work / "jutsu-showcase-clean.txt",
        clean_sequence,
    )
    caption = work / "caption-learn-over-100-jutsu.png"
    make_caption(caption, "LEARN OVER 100 JUTSU")
    captioned = work / "jutsu-showcase-captioned-v22.mp4"
    caption_sequence(ffmpeg, clean_sequence, caption, total_frames, captioned)

    cursor = 0
    for index, frames in zip(range(31, 35), JUTSU_FRAMES):
        destination = work / "clips" / f"{index:03d}-jutsu-example-continuous-v22.mp4"
        cut(ffmpeg, captioned, cursor, frames, destination)
        by_index[index] = destination
        cursor += frames


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
    work = root / "tmp" / "trailer" / "render-v22"
    clips = work / "clips"
    output_dir = root / "output" / "trailer"
    for directory in (work, clips, output_dir):
        directory.mkdir(parents=True, exist_ok=True)

    by_index = read_manifest(root / "tmp" / "trailer" / "render-v21" / "concat-v21.txt")
    rebuild_jutsu_showcase(root, ffmpeg, work, by_index)
    print("Rebuilt shots 031-034 with one continuous jutsu caption", flush=True)

    war_source = root / "output" / "trailer" / "framepack-v22" / "114-village-elemental-war-v22-final.mp4"
    if not war_source.exists():
        raise FileNotFoundError(war_source)
    war_caption = work / "caption-village-war.png"
    make_caption(war_caption, "VILLAGE VS VILLAGE WAR")
    war_shot = Shot("elemental-village-war", war_source, 2.000, caption="VILLAGE VS VILLAGE WAR")
    war_clip = clips / "055-elemental-village-war-v22.mp4"
    render_shot(ffmpeg, war_shot, war_caption, war_clip)
    by_index[55] = war_clip
    print("Replaced shot 055 with the new two-sided elemental war", flush=True)

    clip_paths = [by_index[index] for index in range(60)]
    concat_file = work / "concat-v22.txt"
    concat_file.write_text(
        "".join(f"file '{path.as_posix()}'\n" for path in clip_paths),
        encoding="utf-8",
    )
    silent = work / "silent-v22.mp4"
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(silent)])

    music = work / "music-v22.wav"
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

    temporary = work / "final-v22.tmp.mp4"
    trailer = output_dir / "shinobi-journey-epic-anime-promo-v22-1080p.mp4"
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
