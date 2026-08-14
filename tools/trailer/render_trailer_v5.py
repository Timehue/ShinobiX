"""Render the 2:12 Shinobi Journey V5 anime promo from audited FramePack scenes."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


WIDTH = 1920
HEIGHT = 1080
FPS = 30
TRAILER_END = 132.075


@dataclass(frozen=True)
class Shot:
    name: str
    source: Path
    duration: float
    offset: float = 0.0
    crop: str = "wide"
    caption: str | None = None
    flash: bool = False
    still: bool = False
    speed: float = 1.0


def run(command: list[str], *, quiet: bool = False) -> None:
    if not quiet:
        print(" ".join(f'"{part}"' if " " in part else part for part in command), flush=True)
    completed = subprocess.run(command, check=False)
    if completed.returncode != 0:
        raise RuntimeError(f"Command failed with exit code {completed.returncode}")


def ffmpeg_path() -> str:
    explicit = os.environ.get("SHINOBI_FFMPEG")
    if explicit:
        return explicit
    discovered = shutil.which("ffmpeg")
    if discovered:
        return discovered
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/georgiab.ttf" if bold else "C:/Windows/Fonts/georgia.ttf"),
        Path("C:/Windows/Fonts/timesbd.ttf" if bold else "C:/Windows/Fonts/times.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default(size=size)


def tracked_width(draw: ImageDraw.ImageDraw, text: str, face: ImageFont.FreeTypeFont, tracking: int) -> int:
    return int(sum(draw.textlength(character, font=face) for character in text) + max(0, len(text) - 1) * tracking)


def draw_tracked_line(
    draw: ImageDraw.ImageDraw,
    text: str,
    face: ImageFont.FreeTypeFont,
    center_x: int,
    y: int,
    tracking: int,
) -> None:
    width = tracked_width(draw, text, face, tracking)
    x = center_x - width // 2
    for character in text:
        character_width = draw.textlength(character, font=face)
        draw.text(
            (x + 4, y + 5),
            character,
            font=face,
            fill=(0, 0, 0, 235),
            stroke_width=5,
            stroke_fill=(0, 0, 0, 220),
        )
        draw.text(
            (x, y),
            character,
            font=face,
            fill=(255, 244, 215, 255),
            stroke_width=1,
            stroke_fill=(139, 79, 20, 255),
        )
        x += int(character_width) + tracking


def make_caption(destination: Path, text: str) -> None:
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    lines = [line.strip().upper() for line in text.split("\n") if line.strip()]
    size = 64 if len(lines) == 1 else 58
    face = font(size)
    tracking = 6
    line_height = size + 18
    widest = max(tracked_width(draw, line, face, tracking) for line in lines)
    block_height = len(lines) * line_height
    y = 820 - block_height // 2
    left = max(95, (WIDTH - widest) // 2 - 70)
    right = min(WIDTH - 95, (WIDTH + widest) // 2 + 70)
    top = y - 28
    bottom = y + block_height + 22
    draw.rounded_rectangle((left, top, right, bottom), radius=22, fill=(3, 6, 12, 132))
    draw.line((left + 40, top, right - 40, top), fill=(231, 172, 64, 235), width=3)
    for index, line in enumerate(lines):
        draw_tracked_line(draw, line, face, WIDTH // 2, y + index * line_height, tracking)
    overlay.save(destination)


def crop_filter(crop: str) -> str:
    if crop == "close_left":
        return "scale=2304:1296:force_original_aspect_ratio=increase:flags=lanczos,crop=2304:1296,crop=1920:1080:x=0:y=108"
    if crop == "close_right":
        return "scale=2304:1296:force_original_aspect_ratio=increase:flags=lanczos,crop=2304:1296,crop=1920:1080:x=384:y=108"
    if crop == "close_center":
        return "scale=2304:1296:force_original_aspect_ratio=increase:flags=lanczos,crop=2304:1296,crop=1920:1080:x=192:y=108"
    if crop == "extreme_left":
        return "scale=2688:1512:force_original_aspect_ratio=increase:flags=lanczos,crop=2688:1512,crop=1920:1080:x=0:y=216"
    if crop == "extreme_right":
        return "scale=2688:1512:force_original_aspect_ratio=increase:flags=lanczos,crop=2688:1512,crop=1920:1080:x=768:y=216"
    if crop == "extreme_center":
        return "scale=2688:1512:force_original_aspect_ratio=increase:flags=lanczos,crop=2688:1512,crop=1920:1080:x=384:y=216"
    return "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080"


def render_shot(ffmpeg: str, shot: Shot, overlay: Path | None, destination: Path) -> None:
    frames = max(1, round(shot.duration * FPS))
    exact_duration = frames / FPS
    command = [ffmpeg, "-y"]
    if shot.still:
        command += ["-loop", "1", "-framerate", str(FPS), "-i", str(shot.source)]
        timing_filter = "setpts=PTS-STARTPTS"
    else:
        command += ["-ss", f"{shot.offset:.3f}", "-i", str(shot.source)]
        timing_filter = f"setpts=(PTS-STARTPTS)/{shot.speed:.6f}"

    if overlay:
        command += ["-loop", "1", "-framerate", str(FPS), "-i", str(overlay)]

    filters = [
        f"[0:v]{timing_filter},{crop_filter(shot.crop)},fps={FPS},"
        "tpad=stop_mode=clone:stop_duration=1.5,"
        "eq=contrast=1.025:saturation=1.035:gamma=0.995,"
        "unsharp=5:5:0.20:5:5:0.0"
        + (",fade=t=in:st=0:d=0.067:color=white" if shot.flash else "")
        + "[base]"
    ]
    current = "base"
    if overlay:
        fade_out = max(0.0, exact_duration - 0.20)
        filters.append(
            f"[1:v]format=rgba,fade=t=in:st=0:d=0.10:alpha=1,"
            f"fade=t=out:st={fade_out:.3f}:d=0.18:alpha=1[text]"
        )
        filters.append(f"[{current}][text]overlay=0:0:shortest=1[captioned]")
        current = "captioned"
    filters.append(
        f"[{current}]drawbox=x=0:y=0:w=iw:h=36:color=black:t=fill,"
        f"drawbox=x=0:y={HEIGHT - 36}:w=iw:h=36:color=black:t=fill,format=yuv420p[v]"
    )
    command += [
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[v]",
        "-frames:v",
        str(frames),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "16",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(FPS),
        str(destination),
    ]
    run(command, quiet=True)


def make_music_edit(ffmpeg: str, source: Path, destination: Path) -> None:
    graph = (
        f"[0:a]atrim=start=0:end={TRAILER_END:.3f},asetpts=PTS-STARTPTS,"
        "afade=t=in:st=0:d=0.08,afade=t=out:st=131.175:d=0.900[out]"
    )
    run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(source),
            "-filter_complex",
            graph,
            "-map",
            "[out]",
            "-ar",
            "48000",
            "-c:a",
            "pcm_s16le",
            str(destination),
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--song",
        type=Path,
        default=Path(r"C:\Users\Tyler R\Downloads\SHINOBI ROASTED RICE 2.wav"),
    )
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    root = args.root.resolve()
    old = root / "output" / "trailer" / "framepack-scenes"
    new = root / "output" / "trailer" / "framepack-v5"
    proof = root / "output" / "trailer" / "proof-clan-charge-framepack.mp4"
    rooftop = root / "output" / "trailer" / "framepack-03-rooftop-pursuit.mp4"
    work = root / "tmp" / "trailer" / "render-v5"
    clips_dir = work / "clips"
    overlays_dir = work / "overlays"
    output_dir = root / "output" / "trailer"
    for directory in (work, clips_dir, overlays_dir, output_dir):
        directory.mkdir(parents=True, exist_ok=True)

    disclosure = root / "tmp" / "trailer" / "render-v2" / "disclosure-v2.jpg"
    end_card = root / "tmp" / "trailer" / "render-v2" / "end-card-v2.jpg"
    scene = lambda name: old / f"{name}.mp4"
    final = lambda name: new / f"{name}-final.mp4"
    insert = lambda name: new / f"{name}-proof.mp4"

    shots: list[Shot] = []
    elapsed = 0.0

    def section(end: float, specs: list[tuple]) -> None:
        nonlocal elapsed
        available = end - elapsed
        weight = sum(float(spec[2]) for spec in specs)
        scale = available / weight
        for spec in specs:
            name, source, seconds, offset, crop, caption, flash, still, speed = spec
            duration = float(seconds) * scale
            shots.append(Shot(name, source, duration, offset, crop, caption, flash, still, speed))
            elapsed += duration
        elapsed = end

    def s(name, source, seconds, offset=0.0, crop="wide", caption=None, flash=False, still=False, speed=1.0):
        return (name, source, seconds, offset, crop, caption, flash, still, speed)

    section(1.200, [s("disclosure", disclosure, 1.2, still=True)])
    section(
        8.545,
        [
            s("quiet-oath", final("11-rill-fox-bond-v5"), 3.0, speed=0.60),
            s("village-overlook", scene("01-rill-overlook"), 2.1, crop="close_center", speed=0.48),
            s("world-storm", scene("08-worldstorm-tower"), 2.3, caption="A WORLD DIVIDED", speed=0.45),
        ],
    )
    section(
        14.303,
        [
            s("armies-descend", proof, 2.9, speed=0.82),
            s("four-villages", scene("05-four-village-war"), 2.858, caption="THE FOUR VILLAGES\nHELD THE LINE", speed=0.50),
        ],
    )
    section(
        27.121,
        [
            s("rooftop-pursuit", rooftop, 2.2, speed=0.90),
            s("rooftop-clash", final("12-rooftop-duel-v5"), 2.3, flash=True, speed=0.90),
            s("bloodline-awakens", scene("02-inferno-awakening"), 2.4, caption="UNTIL ONE BLOODLINE\nAWAKENED", speed=0.60),
            s("first-jutsu", scene("04-inferno-jutsu"), 2.1, flash=True, speed=0.75),
            s("first-charge", proof, 1.9, crop="close_center", speed=0.80),
            s("hero-and-fox", final("19-final-launch-v5"), 1.918, speed=0.75),
        ],
    )
    section(
        54.242,
        [
            s("ice-champion", insert("14-ice-champion-v5"), 2.2, caption="FOUR VILLAGES", speed=0.45),
            s("fire-champion", insert("15-fire-champion-v5"), 2.2, speed=0.45),
            s("wind-champion", insert("16-wind-champion-v5"), 2.2, speed=0.45),
            s("lightning-champion", insert("17-lightning-champion-v5"), 2.2, caption="ONE WAR", flash=True, speed=0.45),
            s("battlefield-surge", scene("05-four-village-war"), 2.0, speed=0.65),
            s("clan-charge", proof, 2.2, caption="FIGHT FOR YOUR CLAN", speed=0.75),
            s("duel-break", final("12-rooftop-duel-v5"), 2.0, crop="close_center", speed=0.75),
            s("jutsu-ring", scene("04-inferno-jutsu"), 2.0, offset=0.45, crop="close_left", speed=0.70),
            s("awakening-face", scene("02-inferno-awakening"), 2.0, crop="close_left", speed=0.65),
            s("fox-crouch", scene("06-rill-lightning-fox"), 1.4, speed=0.30),
            s("rain-run", rooftop, 2.0, offset=0.30, crop="close_left", speed=0.80),
            s("hollow-gate", scene("09-hollow-gate-finale"), 2.0, speed=0.75),
            s("tower-rise", scene("08-worldstorm-tower"), 1.6, crop="close_center", speed=0.55),
            s("launch-pose", final("19-final-launch-v5"), 1.121, crop="close_center", speed=0.80),
        ],
    )
    section(
        65.016,
        [
            s("bond-return", final("11-rill-fox-bond-v5"), 2.6, crop="close_center", speed=0.75),
            s("fox-emerges", final("19-final-launch-v5"), 1.4, offset=0.25, crop="close_right", speed=0.50),
            s("hollow-chase", final("18-hollow-chase-v5"), 2.6, speed=0.85),
            s("gate-threat", scene("09-hollow-gate-finale"), 2.3, caption="THE HOLLOW\nBROKE THROUGH", speed=0.80),
            s("brace-together", final("19-final-launch-v5"), 1.874, crop="close_center", speed=0.70),
        ],
    )
    section(
        104.211,
        [
            s("chase-wide", final("18-hollow-chase-v5"), 2.4),
            s("gate-wide", scene("09-hollow-gate-finale"), 2.2, caption="ENTER THE HOLLOW", flash=True, speed=0.80),
            s("oni-dodge-wide", final("13-oni-dodge-v5"), 2.4, caption="FACE TITANS", speed=0.75),
            s("jutsu-wide", scene("04-inferno-jutsu"), 1.8, flash=True, speed=0.78),
            s("fire-strike", insert("15-fire-champion-v5"), 1.6, crop="close_center", speed=0.60),
            s("ice-strike", insert("14-ice-champion-v5"), 1.6, crop="close_center", speed=0.60),
            s("lightning-arrival", insert("17-lightning-champion-v5"), 1.6, crop="close_center", flash=True, speed=0.60),
            s("wind-mastery", insert("16-wind-champion-v5"), 1.6, crop="close_center", speed=0.60),
            s("duel-drive", final("12-rooftop-duel-v5"), 2.2, crop="close_center", speed=0.85),
            s("rooftop-drive", rooftop, 2.2, crop="close_left", speed=0.85),
            s("inferno-rise", scene("02-inferno-awakening"), 2.0, crop="close_left", caption="MASTER YOUR BLOODLINE", speed=0.68),
            s("war-before-morph", scene("05-four-village-war"), 1.8, speed=0.72),
            s("charge-return", proof, 2.2, caption="CHOOSE YOUR LEGACY", speed=0.80),
            s("fox-eyes", scene("06-rill-lightning-fox"), 1.0, crop="close_right", speed=0.38),
            s("fox-attack", final("19-final-launch-v5"), 1.0, offset=0.55, crop="close_right", speed=0.48),
            s("storm-close", scene("08-worldstorm-tower"), 1.5, crop="extreme_center", speed=0.62),
            s("spirit-close", scene("09-hollow-gate-finale"), 1.7, offset=0.55, crop="close_right", speed=0.72),
            s("oni-guard", final("13-oni-dodge-v5"), 2.0, offset=0.30, crop="close_left", speed=0.75),
            s("hound-close", final("18-hollow-chase-v5"), 2.0, offset=0.25, crop="close_right", speed=0.82),
            s("fire-ring-close", scene("04-inferno-jutsu"), 1.6, offset=0.58, crop="close_left", flash=True, speed=0.75),
            s("blade-close", final("12-rooftop-duel-v5"), 1.5, offset=0.32, crop="close_center", speed=0.75),
            s("fire-fist-close", insert("15-fire-champion-v5"), 1.0, crop="extreme_left", speed=0.46),
            s("lightning-eyes", insert("17-lightning-champion-v5"), 1.0, crop="extreme_center", speed=0.46),
        ],
    )
    section(
        123.902,
        [
            s("rush-rooftop", rooftop, 1.2, offset=0.55, crop="close_left"),
            s("rush-duel", final("12-rooftop-duel-v5"), 1.2, crop="close_center", flash=True),
            s("rush-ice", insert("14-ice-champion-v5"), 1.0, crop="close_center", speed=0.80),
            s("rush-fire", insert("15-fire-champion-v5"), 1.0, crop="close_center", flash=True, speed=0.80),
            s("rush-wind", insert("16-wind-champion-v5"), 1.0, crop="close_center", speed=0.80),
            s("rush-lightning", insert("17-lightning-champion-v5"), 1.0, crop="close_center", flash=True, speed=0.80),
            s("rush-oni", final("13-oni-dodge-v5"), 1.2, offset=0.38, crop="close_left"),
            s("rush-chase", final("18-hollow-chase-v5"), 1.2, offset=0.30, crop="close_right"),
            s("rush-gate", scene("09-hollow-gate-finale"), 1.2, offset=0.40, crop="close_right"),
            s("rush-jutsu", scene("04-inferno-jutsu"), 1.2, offset=0.72, crop="close_left", flash=True),
            s("rush-awaken", scene("02-inferno-awakening"), 1.2, offset=0.35, crop="close_left"),
            s("rush-war", scene("05-four-village-war"), 1.0, offset=0.15, speed=0.75),
            s("rush-charge", proof, 1.2, offset=0.25, crop="close_center"),
            s("rush-fox-start", scene("06-rill-lightning-fox"), 0.8, crop="close_right", speed=0.48),
            s("rush-fox-end", final("19-final-launch-v5"), 0.8, offset=0.70, crop="close_right", speed=0.48),
            s("rush-tower", scene("08-worldstorm-tower"), 1.0, crop="close_center", speed=0.70),
            s("rush-final", final("19-final-launch-v5"), 1.2, crop="close_center"),
            s("rush-blades", final("12-rooftop-duel-v5"), 0.9, offset=0.28, crop="extreme_center"),
            s("rush-oni-close", final("13-oni-dodge-v5"), 0.9, offset=0.48, crop="extreme_left", flash=True),
            s("rush-hound-close", final("18-hollow-chase-v5"), 0.9, offset=0.44, crop="extreme_right"),
            s("rush-fire-close", scene("04-inferno-jutsu"), 0.9, offset=0.82, crop="extreme_left", flash=True),
            s("rush-army-close", proof, 0.9, offset=0.58, crop="extreme_center"),
            s("become-legend", final("19-final-launch-v5"), 1.1, crop="close_center", caption="BECOME THE LEGEND"),
        ],
    )
    section(
        126.500,
        [s("journey-begins", final("19-final-launch-v5"), 2.598, crop="close_center", caption="YOUR JOURNEY BEGINS", speed=0.78)],
    )
    section(TRAILER_END, [s("end-card", end_card, 5.575, still=True)])

    captions: dict[str, Path] = {}
    for shot in shots:
        if shot.caption and shot.caption not in captions:
            path = overlays_dir / f"caption-{len(captions):02d}.png"
            make_caption(path, shot.caption)
            captions[shot.caption] = path

    nominal_duration = sum(shot.duration for shot in shots)
    frame_duration = sum(max(1, round(shot.duration * FPS)) for shot in shots) / FPS
    print(
        f"timeline_shots={len(shots)} nominal_duration={nominal_duration:.3f} "
        f"frame_duration={frame_duration:.3f}",
        flush=True,
    )
    if args.dry_run:
        for index, shot in enumerate(shots):
            print(
                f"{index:03d} {shot.name} duration={shot.duration:.3f} "
                f"source_time={shot.duration * shot.speed:.3f} offset={shot.offset:.3f} "
                f"source={shot.source}",
                flush=True,
            )
        return

    ffmpeg = ffmpeg_path()
    clip_paths: list[Path] = []
    for index, shot in enumerate(shots):
        if not shot.source.exists():
            raise FileNotFoundError(shot.source)
        destination = clips_dir / f"{index:03d}-{shot.name}.mp4"
        print(f"[{index + 1:03d}/{len(shots):03d}] {shot.name} ({shot.duration:.3f}s)", flush=True)
        if args.force or not destination.exists() or destination.stat().st_size < 80_000:
            render_shot(ffmpeg, shot, captions.get(shot.caption), destination)
        clip_paths.append(destination)

    concat_file = work / "concat-v5.txt"
    concat_file.write_text("".join(f"file '{path.as_posix()}'\n" for path in clip_paths), encoding="utf-8")
    silent = work / "silent-v5.mp4"
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(silent)])

    music = work / "music-v5.wav"
    make_music_edit(ffmpeg, args.song.resolve(strict=True), music)
    sfx = root / "shinobij.client" / "public" / "sfx" / "production"
    events = [
        (sfx / "reveal.wav", 1.200, 0.08),
        (sfx / "battle-transition.wav", 14.303, 0.07),
        (sfx / "chakra-positive.wav", 27.121, 0.08),
        (sfx / "impact-heavy.wav", 28.561, 0.07),
        (sfx / "omen.wav", 54.242, 0.07),
        (sfx / "battle-transition.wav", 65.016, 0.07),
        (sfx / "impact-heavy.wav", 83.476, 0.07),
        (sfx / "mythic.wav", 104.211, 0.07),
        (sfx / "impact-heavy.wav", 123.902, 0.07),
        (sfx / "victory-seal.wav", 126.500, 0.09),
    ]
    command = [ffmpeg, "-y", "-i", str(silent), "-i", str(music)]
    for path, _, _ in events:
        command += ["-i", str(path)]
    filters = ["[1:a]volume=1.0[music]"]
    labels = ["[music]"]
    for index, (_, timestamp, volume) in enumerate(events):
        label = f"sfx{index}"
        filters.append(f"[{index + 2}:a]adelay={round(timestamp * 1000)}:all=1,volume={volume}[{label}]")
        labels.append(f"[{label}]")
    filters.append(
        "".join(labels)
        + f"amix=inputs={len(labels)}:duration=first:dropout_transition=0:normalize=0,"
        "alimiter=limit=0.96[aout]"
    )

    trailer = output_dir / "shinobi-journey-epic-anime-promo-v5-1080p.mp4"
    temporary = work / "final-v5.tmp.mp4"
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
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise
