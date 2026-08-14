"""Cut the generated FramePack scenes into a one-minute anime cinematic trailer."""

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


@dataclass(frozen=True)
class Shot:
    name: str
    source: Path
    start: float
    end: float
    offset: float = 0.0
    crop: str = "wide"
    caption: str | None = None
    flash: bool = False
    still: bool = False
    speed: float = 1.0

    @property
    def duration(self) -> float:
        return self.end - self.start


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


def make_caption(destination: Path, text: str) -> None:
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    face = font(70)
    tracking = 7
    text = text.upper()
    widths = [draw.textlength(character, font=face) for character in text]
    text_width = int(sum(widths) + max(0, len(text) - 1) * tracking)
    x = (WIDTH - text_width) // 2
    y = 802

    draw.rectangle((0, 742, WIDTH, 962), fill=(0, 0, 0, 80))
    draw.line((x - 70, y - 23, x + text_width + 70, y - 23), fill=(225, 164, 58, 235), width=3)
    for character, character_width in zip(text, widths):
        draw.text(
            (x + 4, y + 5),
            character,
            font=face,
            fill=(0, 0, 0, 245),
            stroke_width=4,
            stroke_fill=(0, 0, 0, 245),
        )
        draw.text(
            (x, y),
            character,
            font=face,
            fill=(252, 241, 211, 255),
            stroke_width=1,
            stroke_fill=(118, 67, 20, 255),
        )
        x += int(character_width) + tracking
    overlay.save(destination)


def crop_filter(crop: str) -> str:
    if crop == "close_left":
        return (
            "scale=2304:1296:force_original_aspect_ratio=increase:flags=lanczos,"
            "crop=2304:1296,crop=1920:1080:x=0:y=108"
        )
    if crop == "close_right":
        return (
            "scale=2304:1296:force_original_aspect_ratio=increase:flags=lanczos,"
            "crop=2304:1296,crop=1920:1080:x=384:y=108"
        )
    if crop == "close_center":
        return (
            "scale=2304:1296:force_original_aspect_ratio=increase:flags=lanczos,"
            "crop=2304:1296,crop=1920:1080:x=192:y=108"
        )
    if crop == "extreme_left":
        return (
            "scale=2688:1512:force_original_aspect_ratio=increase:flags=lanczos,"
            "crop=2688:1512,crop=1920:1080:x=0:y=216"
        )
    if crop == "extreme_right":
        return (
            "scale=2688:1512:force_original_aspect_ratio=increase:flags=lanczos,"
            "crop=2688:1512,crop=1920:1080:x=768:y=216"
        )
    if crop == "extreme_center":
        return (
            "scale=2688:1512:force_original_aspect_ratio=increase:flags=lanczos,"
            "crop=2688:1512,crop=1920:1080:x=384:y=216"
        )
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
        "tpad=stop_mode=clone:stop_duration=6,"
        "eq=contrast=1.035:saturation=1.045:gamma=0.99,"
        "unsharp=5:5:0.25:5:5:0.0"
        + (",fade=t=in:st=0:d=0.067:color=white" if shot.flash else "")
        + "[base]"
    ]
    current = "base"
    if overlay:
        fade_out = max(0.0, exact_duration - 0.22)
        filters.append(
            f"[1:v]format=rgba,fade=t=in:st=0:d=0.10:alpha=1,"
            f"fade=t=out:st={fade_out:.3f}:d=0.20:alpha=1[text]"
        )
        filters.append(f"[{current}][text]overlay=0:0:shortest=1[captioned]")
        current = "captioned"
    filters.append(
        f"[{current}]drawbox=x=0:y=0:w=iw:h=42:color=black:t=fill,"
        f"drawbox=x=0:y={HEIGHT - 42}:w=iw:h=42:color=black:t=fill,format=yuv420p[v]"
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
        "[0:a]atrim=start=14.303:end=74.490,asetpts=PTS-STARTPTS,"
        "afade=t=in:st=0:d=0.08,afade=t=out:st=59.687:d=0.500[out]"
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
    args = parser.parse_args()

    root = args.root.resolve()
    generated = root / "output" / "trailer" / "framepack-scenes"
    proof = root / "output" / "trailer" / "proof-clan-charge-framepack.mp4"
    rooftop = root / "output" / "trailer" / "framepack-03-rooftop-pursuit.mp4"
    work = root / "tmp" / "trailer" / "render-v4"
    clips_dir = work / "clips"
    overlays_dir = work / "overlays"
    output_dir = root / "output" / "trailer"
    for directory in (work, clips_dir, overlays_dir, output_dir):
        directory.mkdir(parents=True, exist_ok=True)

    disclosure = root / "tmp" / "trailer" / "render-v2" / "disclosure-v2.jpg"
    end_card = root / "tmp" / "trailer" / "render-v2" / "end-card-v2.jpg"
    scene = lambda name: generated / f"{name}.mp4"
    points = [
        0.000, 1.200, 3.624, 5.203, 7.268, 8.847, 10.426, 12.818,
        14.258, 15.837, 17.416, 18.832, 20.411, 21.990, 23.824,
        25.403, 26.982, 28.561, 30.140, 31.719, 33.298, 34.877,
        36.456, 38.035, 39.939, 42.308, 44.677, 47.046, 50.713,
        52.292, 53.871, 55.450, 60.454,
    ]
    specs = [
        ("disclosure", disclosure, 0.0, "wide", None, False, True, 1.0),
        ("world-divided", proof, 0.0, "wide", "A WORLD DIVIDED", True, False, 1.0),
        ("rooftop-sprint", rooftop, 0.0, "wide", None, False, False, 1.0),
        ("hero-overlook", scene("01-rill-overlook"), 0.0, "close_center", "ONE SHINOBI RISES", False, False, 0.55),
        ("awakening-wide", scene("02-inferno-awakening"), 0.0, "wide", None, True, False, 1.0),
        ("awakening-close", scene("02-inferno-awakening"), 0.75, "close_left", "AWAKEN YOUR BLOODLINE", False, False, 1.0),
        ("jutsu-cast", scene("04-inferno-jutsu"), 0.0, "wide", None, True, False, 1.0),
        ("rooftop-close", rooftop, 0.72, "close_left", None, False, False, 1.0),
        ("fox-launch", scene("06-rill-lightning-fox"), 0.0, "wide", None, True, False, 1.0),
        ("fox-close", scene("06-rill-lightning-fox"), 0.72, "close_center", "FORGE A LEGEND", False, False, 1.0),
        ("war-wide", scene("05-four-village-war"), 0.0, "wide", None, True, False, 1.0),
        ("war-close", scene("05-four-village-war"), 0.72, "close_left", "FOUR VILLAGES. ONE WAR.", False, False, 1.0),
        ("clan-charge-close", proof, 0.78, "close_center", None, False, False, 1.0),
        ("oni-attack", scene("07-oni-confrontation"), 0.0, "wide", None, True, False, 1.0),
        ("oni-close", scene("07-oni-confrontation"), 0.78, "close_right", "FACE TITANS", False, False, 1.0),
        ("gate-open", scene("09-hollow-gate-finale"), 0.0, "wide", None, True, False, 1.0),
        ("tower-storm", scene("08-worldstorm-tower"), 0.0, "wide", "THE WORLD AWAKENS", False, False, 0.70),
        ("gate-close", scene("09-hollow-gate-finale"), 0.78, "close_left", None, False, False, 1.0),
        ("jutsu-close", scene("04-inferno-jutsu"), 0.78, "close_left", None, True, False, 1.0),
        ("fox-return", scene("06-rill-lightning-fox"), 0.10, "close_right", None, False, False, 1.0),
        ("rooftop-return", rooftop, 0.42, "extreme_left", None, True, False, 1.0),
        ("awakening-return", scene("02-inferno-awakening"), 0.70, "extreme_left", None, False, False, 1.0),
        ("war-return", scene("05-four-village-war"), 0.42, "close_center", None, True, False, 1.0),
        ("fight-clan", proof, 0.60, "wide", "FIGHT FOR YOUR CLAN", False, False, 1.0),
        ("oni-dodge", scene("07-oni-confrontation"), 0.28, "close_left", None, True, False, 1.0),
        ("gate-final", scene("09-hollow-gate-finale"), 0.0, "close_center", None, False, False, 1.0),
        ("war-climax", scene("05-four-village-war"), 0.0, "wide", "CHOOSE YOUR LEGACY", True, False, 1.0),
        ("one-journey", proof, 0.0, "wide", "ONE JOURNEY", False, False, 0.66),
        ("fox-rush", scene("06-rill-lightning-fox"), 0.18, "wide", None, True, False, 1.0),
        ("rooftop-rush", rooftop, 0.50, "close_left", None, False, False, 1.0),
        ("last-question", scene("09-hollow-gate-finale"), 0.72, "close_center", "HOW FAR WILL YOU RISE?", True, False, 1.0),
        ("end-card", end_card, 0.0, "wide", None, False, True, 1.0),
    ]
    if len(specs) != len(points) - 1:
        raise RuntimeError(f"Timeline mismatch: {len(specs)} specs for {len(points) - 1} intervals")

    shots = [
        Shot(name, source, points[index], points[index + 1], offset, crop, caption, flash, still, speed)
        for index, (name, source, offset, crop, caption, flash, still, speed) in enumerate(specs)
    ]
    captions: dict[str, Path] = {}
    for shot in shots:
        if shot.caption and shot.caption not in captions:
            path = overlays_dir / f"caption-{len(captions):02d}.png"
            make_caption(path, shot.caption)
            captions[shot.caption] = path

    ffmpeg = ffmpeg_path()
    clip_paths: list[Path] = []
    for index, shot in enumerate(shots):
        if not shot.source.exists():
            raise FileNotFoundError(shot.source)
        destination = clips_dir / f"{index:02d}-{shot.name}.mp4"
        print(f"[{index + 1:02d}/{len(shots):02d}] {shot.name} ({shot.duration:.3f}s)", flush=True)
        if args.force or not destination.exists() or destination.stat().st_size < 80_000:
            render_shot(ffmpeg, shot, captions.get(shot.caption), destination)
        clip_paths.append(destination)

    concat_file = work / "concat-v4.txt"
    concat_file.write_text("".join(f"file '{path.as_posix()}'\n" for path in clip_paths), encoding="utf-8")
    silent = work / "silent-v4.mp4"
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(silent)])

    music = work / "music-v4.wav"
    make_music_edit(ffmpeg, args.song.resolve(strict=True), music)
    sfx = root / "shinobij.client" / "public" / "sfx" / "production"
    events = [
        (sfx / "reveal.wav", 1.200, 0.10),
        (sfx / "battle-transition.wav", 7.268, 0.09),
        (sfx / "impact-heavy.wav", 12.818, 0.09),
        (sfx / "chakra-positive.wav", 17.416, 0.10),
        (sfx / "impact-heavy.wav", 21.990, 0.09),
        (sfx / "omen.wav", 30.140, 0.08),
        (sfx / "battle-transition.wav", 39.939, 0.09),
        (sfx / "victory-seal.wav", 55.450, 0.11),
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

    final = output_dir / "shinobi-journey-animated-anime-trailer-v4-1080p.mp4"
    temporary = work / "final-v4.tmp.mp4"
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
    os.replace(temporary, final)
    print(f"Rendered {final}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise
