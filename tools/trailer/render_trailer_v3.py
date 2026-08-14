"""Edit the stable 2.5D scene renders into an anime-style trailer."""

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

    @property
    def duration(self) -> float:
        return self.end - self.start


def run(command: list[str], *, quiet: bool = False) -> None:
    if not quiet:
        print(" ".join(f'"{part}"' if " " in part else part for part in command), flush=True)
    result = subprocess.run(command, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed with exit code {result.returncode}")


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


def tracked_width(draw: ImageDraw.ImageDraw, text: str, face: ImageFont.ImageFont, tracking: int) -> int:
    return int(sum(draw.textlength(character, font=face) for character in text) + max(0, len(text) - 1) * tracking)


def draw_tracked(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, face: ImageFont.ImageFont, tracking: int) -> None:
    for character in text:
        draw.text((x + 3, y + 4), character, font=face, fill=(0, 0, 0, 235), stroke_width=3, stroke_fill=(0, 0, 0, 235))
        draw.text((x, y), character, font=face, fill=(249, 236, 202, 255), stroke_width=1, stroke_fill=(102, 57, 18, 255))
        x += int(draw.textlength(character, font=face)) + tracking


def make_caption(destination: Path, text: str) -> None:
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    face = font(66)
    tracking = 6
    text = text.upper()
    width = tracked_width(draw, text, face, tracking)
    x = (WIDTH - width) // 2
    y = 790
    draw.polygon(((x - 76, y - 24), (x + width + 76, y - 24), (x + width + 52, y + 104), (x - 52, y + 104)), fill=(3, 6, 12, 200))
    draw.line((x - 28, y - 4, x + width + 28, y - 4), fill=(232, 183, 72, 240), width=3)
    draw.line((x - 28, y + 82, x + width + 28, y + 82), fill=(177, 35, 25, 240), width=3)
    draw_tracked(draw, x, y, text, face, tracking)
    overlay.save(destination)


def crop_filter(crop: str) -> str:
    if crop == "close_left":
        return "scale=2304:1296:flags=lanczos,crop=1920:1080:x=0:y=108"
    if crop == "close_right":
        return "scale=2304:1296:flags=lanczos,crop=1920:1080:x=384:y=108"
    if crop == "close_center":
        return "scale=2304:1296:flags=lanczos,crop=1920:1080:x=192:y=108"
    if crop == "extreme_left":
        return "scale=2688:1512:flags=lanczos,crop=1920:1080:x=0:y=216"
    if crop == "extreme_right":
        return "scale=2688:1512:flags=lanczos,crop=1920:1080:x=768:y=216"
    if crop == "extreme_center":
        return "scale=2688:1512:flags=lanczos,crop=1920:1080:x=384:y=216"
    return "scale=1920:1080:flags=lanczos"


def render_shot(ffmpeg: str, shot: Shot, overlay: Path | None, destination: Path) -> None:
    frames = max(1, round(shot.duration * FPS))
    exact_duration = frames / FPS
    command = [ffmpeg, "-y"]
    if shot.still:
        command += ["-loop", "1", "-framerate", str(FPS), "-i", str(shot.source)]
        source_filter = crop_filter(shot.crop)
    else:
        command += ["-ss", f"{shot.offset:.3f}", "-i", str(shot.source)]
        source_filter = crop_filter(shot.crop)
    overlay_index: int | None = None
    if overlay:
        overlay_index = 1
        command += ["-loop", "1", "-framerate", str(FPS), "-i", str(overlay)]

    filters = [
        f"[0:v]{source_filter},fps={FPS},"
        "scale=in_range=tv:out_range=tv,"
        "eq=contrast=1.025:saturation=1.035:gamma=0.99,"
        "unsharp=5:5:0.28:5:5:0.0"
        + (",fade=t=in:st=0:d=0.067:color=white" if shot.flash else "")
        + "[base]"
    ]
    current = "base"
    if overlay_index is not None:
        fade_out = max(0.0, exact_duration - 0.25)
        filters.append(
            f"[{overlay_index}:v]format=rgba,fade=t=in:st=0:d=0.13:alpha=1,"
            f"fade=t=out:st={fade_out:.3f}:d=0.23:alpha=1[text]"
        )
        filters.append(f"[{current}][text]overlay=0:0:shortest=1[captioned]")
        current = "captioned"
    filters.append(
        f"[{current}]drawbox=x=0:y=0:w=iw:h=44:color=black:t=fill,"
        f"drawbox=x=0:y={HEIGHT - 44}:w=iw:h=44:color=black:t=fill,format=yuv420p[v]"
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
        "17",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(FPS),
        str(destination),
    ]
    run(command, quiet=True)


def make_music_edit(ffmpeg: str, source: Path, destination: Path) -> None:
    if destination.exists() and destination.stat().st_size > 1_000_000:
        return
    graph = (
        "[0:a]atrim=start=14.303:end=104.211,asetpts=PTS-STARTPTS,"
        "afade=t=in:st=0:d=0.10,afade=t=out:st=89.500:d=0.408[out]"
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
    parser.add_argument("--song", type=Path, default=Path("C:/Users/Tyler R/Downloads/SHINOBI ROASTED RICE 2.wav"))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    root = args.root.resolve()
    scenes = root / "tmp" / "trailer" / "anime-scenes-v3"
    work = root / "tmp" / "trailer" / "render-v3"
    clips_dir = work / "clips"
    overlays_dir = work / "overlays"
    output_dir = root / "output" / "trailer"
    for directory in (work, clips_dir, overlays_dir, output_dir):
        directory.mkdir(parents=True, exist_ok=True)
    disclosure = root / "tmp" / "trailer" / "render-v2" / "disclosure-v2.jpg"
    end_card = root / "tmp" / "trailer" / "render-v2" / "end-card-v2.jpg"
    if not disclosure.exists() or not end_card.exists():
        raise FileNotFoundError("V2 disclosure/end card assets are required")

    scene = lambda name: scenes / f"{name}.mp4"
    points = [
        0.000, 1.200, 3.624, 5.203, 7.268, 8.847, 10.426, 12.818, 14.258,
        15.837, 17.416, 18.832, 20.411, 21.990, 23.824, 25.403, 26.982,
        28.561, 30.140, 31.719, 33.298, 34.877, 36.456, 38.035, 39.939,
        42.308, 44.677, 47.046, 50.713, 52.292, 53.871, 55.450, 57.029,
        58.608, 60.187, 61.766, 63.345, 64.924, 66.503, 68.082, 69.173,
        70.752, 72.331, 74.095, 75.674, 77.253, 78.832, 80.411, 82.000,
        83.579, 85.158, 86.737, 90.608,
    ]
    specs = [
        ("disclosure", disclosure, 0.0, "wide", None, False, True),
        ("journey-open", scene("rill-overlook"), 0.0, "wide", "YOUR JOURNEY BEGINS", False, False),
        ("hero-close", scene("landing-hero"), 0.8, "close_right", None, False, False),
        ("world-map-a", scene("world-map"), 0.0, "wide", None, False, False),
        ("rooftop-wide", scene("rooftop-pursuit"), 0.0, "wide", None, True, False),
        ("rooftop-close", scene("rooftop-pursuit"), 1.7, "close_left", None, False, False),
        ("war-reveal", scene("four-village-war"), 0.0, "wide", "FOUR RIVAL VILLAGES", False, False),
        ("clan-charge-a", scene("four-clan-charge"), 0.4, "wide", None, True, False),
        ("fox-launch", scene("rill-lightning-fox"), 0.7, "close_center", None, False, False),
        ("bloodline-eye", scene("inferno-awakening"), 0.0, "close_right", None, True, False),
        ("bloodline-extreme", scene("inferno-awakening"), 1.8, "extreme_right", "AWAKEN YOUR BLOODLINE", False, False),
        ("jutsu-wide", scene("inferno-jutsu"), 0.0, "wide", None, True, False),
        ("inferno-world", scene("inferno-world"), 0.5, "wide", None, False, False),
        ("jutsu-close", scene("inferno-jutsu"), 1.9, "close_left", None, False, False),
        ("fox-wide", scene("rill-lightning-fox"), 0.0, "wide", None, True, False),
        ("companion-bond-a", scene("companion-bond"), 0.5, "wide", "BONDS BECOME POWER", False, False),
        ("war-sweep", scene("four-village-war"), 1.6, "close_left", None, False, False),
        ("oni-wide", scene("oni-confrontation"), 0.0, "wide", None, True, False),
        ("oni-close", scene("oni-confrontation"), 1.7, "close_right", None, False, False),
        ("gate-wide", scene("hollow-gate-finale"), 0.0, "wide", None, True, False),
        ("tower-rise-a", scene("worldstorm-tower"), 0.0, "wide", None, False, False),
        ("hound-charge-a", scene("hollow-hound"), 0.8, "close_center", None, True, False),
        ("gate-close", scene("hollow-gate-finale"), 1.8, "close_left", None, False, False),
        ("fight-clan", scene("four-clan-charge"), 0.0, "wide", "FIGHT FOR YOUR CLAN", True, False),
        ("quiet-bond", scene("companion-bond"), 0.0, "close_center", None, False, False),
        ("quiet-overlook", scene("rill-overlook"), 0.8, "close_right", None, False, False),
        ("world-map-b", scene("world-map"), 0.6, "close_center", None, False, False),
        ("tower-legend", scene("worldstorm-tower"), 0.7, "wide", "CLIMB BEYOND LEGEND", False, False),
        ("hound-wide", scene("hollow-hound"), 0.0, "wide", None, True, False),
        ("oni-return", scene("oni-confrontation"), 0.9, "extreme_right", None, False, False),
        ("clan-charge-b", scene("four-clan-charge"), 1.1, "close_center", None, True, False),
        ("war-return", scene("four-village-war"), 0.8, "wide", None, False, False),
        ("fox-return", scene("rill-lightning-fox"), 1.2, "close_right", None, True, False),
        ("eye-return", scene("inferno-awakening"), 0.7, "extreme_right", None, False, False),
        ("jutsu-return", scene("inferno-jutsu"), 0.7, "close_left", None, True, False),
        ("gate-return", scene("hollow-gate-finale"), 0.7, "wide", None, False, False),
        ("tower-return", scene("worldstorm-tower"), 1.5, "close_right", None, True, False),
        ("rooftop-return", scene("rooftop-pursuit"), 0.9, "close_left", None, False, False),
        ("hound-return", scene("hollow-hound"), 0.5, "close_center", None, True, False),
        ("one-journey", scene("four-clan-charge"), 0.6, "wide", "ONE JOURNEY", True, False),
        ("fox-rush", scene("rill-lightning-fox"), 0.0, "wide", None, False, False),
        ("oni-rush", scene("oni-confrontation"), 1.1, "close_right", None, True, False),
        ("gate-rush", scene("hollow-gate-finale"), 0.4, "wide", None, False, False),
        ("eye-rush", scene("inferno-awakening"), 1.5, "extreme_right", None, True, False),
        ("jutsu-rush", scene("inferno-jutsu"), 1.1, "close_left", None, False, False),
        ("war-rush", scene("four-village-war"), 1.4, "close_center", None, True, False),
        ("hound-rush", scene("hollow-hound"), 0.9, "wide", None, False, False),
        ("tower-rush", scene("worldstorm-tower"), 1.0, "close_right", None, True, False),
        ("final-gate", scene("hollow-gate-finale"), 0.0, "wide", None, False, False),
        ("final-hero", scene("landing-hero"), 0.5, "extreme_right", "HOW FAR WILL YOU RISE?", True, False),
        ("last-eye", scene("inferno-awakening"), 0.2, "extreme_right", None, True, False),
        ("end-card", end_card, 0.0, "wide", None, False, True),
    ]
    if len(specs) != len(points) - 1:
        raise RuntimeError(f"Timeline mismatch: {len(specs)} specs for {len(points) - 1} intervals")
    shots = [
        Shot(name, source, points[index], points[index + 1], offset, crop, caption, flash, still)
        for index, (name, source, offset, crop, caption, flash, still) in enumerate(specs)
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
        else:
            print(f"  reusing {destination.name}", flush=True)
        clip_paths.append(destination)

    concat_file = work / "concat-v3.txt"
    concat_file.write_text("".join(f"file '{path.as_posix()}'\n" for path in clip_paths), encoding="utf-8")
    silent = work / "silent-v3.mp4"
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(silent)])

    music = root / "tmp" / "trailer" / "shinobi-journey-trailer-music-v3.wav"
    make_music_edit(ffmpeg, args.song.resolve(), music)
    sfx = root / "shinobij.client" / "public" / "sfx" / "production"
    events = [
        (sfx / "reveal.wav", 1.200, 0.20),
        (sfx / "battle-transition.wav", 7.268, 0.16),
        (sfx / "impact-heavy.wav", 14.258, 0.16),
        (sfx / "chakra-positive.wav", 18.832, 0.18),
        (sfx / "impact-heavy.wav", 23.824, 0.16),
        (sfx / "omen.wav", 39.939, 0.14),
        (sfx / "battle-transition.wav", 50.713, 0.16),
        (sfx / "impact-heavy.wav", 69.173, 0.18),
        (sfx / "knockout.wav", 74.095, 0.16),
        (sfx / "victory-seal.wav", 86.737, 0.20),
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
        + f"amix=inputs={len(labels)}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.96[aout]"
    )
    final = output_dir / "shinobi-journey-anime-cinematic-trailer-v3-1080p.mp4"
    temporary = work / "final-v3.tmp.mp4"
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
