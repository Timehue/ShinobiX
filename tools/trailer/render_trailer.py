"""Render the Shinobi Journey cinematic beta trailer.

The renderer intentionally treats the generated key art like anime layout
plates: animated camera moves, hard editorial cuts, title overlays, impact
sound design, and a clearly labeled cinematic/non-gameplay presentation.
"""

from __future__ import annotations

import argparse
import math
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps


WIDTH = 1920
HEIGHT = 1080
FPS = 30
WORK_WIDTH = 3840
WORK_HEIGHT = 2160


@dataclass(frozen=True)
class Shot:
    name: str
    source: Path
    start: float
    end: float
    motion: str = "push"
    caption: str | None = None
    fit: str = "fill"

    @property
    def duration(self) -> float:
        return self.end - self.start


def run(command: list[str], *, quiet: bool = False) -> None:
    if not quiet:
        print(" ".join(f'"{part}"' if " " in part else part for part in command))
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
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover - environment diagnostic
        raise RuntimeError("ffmpeg is required; set SHINOBI_FFMPEG or install imageio-ffmpeg") from exc


def font(size: int, *, bold: bool = True) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/georgiab.ttf" if bold else "C:/Windows/Fonts/georgia.ttf"),
        Path("C:/Windows/Fonts/timesbd.ttf" if bold else "C:/Windows/Fonts/times.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default(size=size)


def tracked_width(draw: ImageDraw.ImageDraw, text: str, face: ImageFont.ImageFont, tracking: int) -> int:
    widths = [draw.textlength(character, font=face) for character in text]
    return int(sum(widths) + max(0, len(text) - 1) * tracking)


def draw_tracked(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    face: ImageFont.ImageFont,
    fill: str | tuple[int, int, int, int],
    tracking: int,
    *,
    stroke_width: int = 0,
    stroke_fill: str | tuple[int, int, int, int] | None = None,
) -> None:
    x, y = xy
    for character in text:
        draw.text(
            (x, y),
            character,
            font=face,
            fill=fill,
            stroke_width=stroke_width,
            stroke_fill=stroke_fill,
        )
        x += int(draw.textlength(character, font=face)) + tracking


def vignette(size: tuple[int, int]) -> Image.Image:
    width, height = size
    mask = Image.new("L", size, 0)
    pixels = mask.load()
    for y in range(height):
        ny = (y - height / 2) / (height / 2)
        for x in range(width):
            nx = (x - width / 2) / (width / 2)
            radius = math.sqrt(nx * nx + ny * ny)
            pixels[x, y] = int(max(0, min(185, (radius - 0.34) * 230)))
    return mask.filter(ImageFilter.GaussianBlur(65))


def normalize_image(source: Path, destination: Path, fit: str) -> None:
    with Image.open(source) as loaded:
        image = loaded.convert("RGB")
        if fit == "contain":
            background = ImageOps.fit(image, (WORK_WIDTH, WORK_HEIGHT), Image.Resampling.LANCZOS)
            background = background.filter(ImageFilter.GaussianBlur(42))
            background = ImageEnhance.Brightness(background).enhance(0.44)
            foreground = image.copy()
            foreground.thumbnail((3500, 1980), Image.Resampling.LANCZOS)
            canvas = background
            x = (WORK_WIDTH - foreground.width) // 2
            y = (WORK_HEIGHT - foreground.height) // 2
            canvas.paste(foreground, (x, y))
        else:
            canvas = ImageOps.fit(image, (WORK_WIDTH, WORK_HEIGHT), Image.Resampling.LANCZOS)
        canvas = ImageEnhance.Contrast(canvas).enhance(1.035)
        canvas = ImageEnhance.Color(canvas).enhance(1.035)
        destination.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(destination, quality=95)


def make_caption(destination: Path, text: str) -> None:
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    face = font(73)
    tracking = 7
    text = text.upper()
    text_width = tracked_width(draw, text, face, tracking)
    x = (WIDTH - text_width) // 2
    y = 754

    # Wide cinematic shadow plate and gold hairlines.
    draw.rounded_rectangle((x - 68, y - 35, x + text_width + 68, y + 121), radius=18, fill=(4, 7, 12, 162))
    draw.line((x - 22, y - 12, x + text_width + 22, y - 12), fill=(233, 192, 91, 205), width=2)
    draw.line((x - 22, y + 94, x + text_width + 22, y + 94), fill=(233, 192, 91, 205), width=2)
    draw_tracked(draw, (x + 4, y + 4), text, face, (0, 0, 0, 220), tracking, stroke_width=3, stroke_fill=(0, 0, 0, 220))
    draw_tracked(draw, (x, y), text, face, (247, 232, 190, 255), tracking, stroke_width=1, stroke_fill=(104, 65, 20, 255))
    overlay.save(destination)


def make_disclosure(destination: Path) -> None:
    image = Image.new("RGB", (WORK_WIDTH, WORK_HEIGHT), "#030508")
    draw = ImageDraw.Draw(image)
    title_face = font(112)
    sub_face = font(58, bold=False)
    title = "CINEMATIC VISUALIZATION"
    sub = "NOT ACTUAL GAMEPLAY"
    title_width = tracked_width(draw, title, title_face, 13)
    sub_width = tracked_width(draw, sub, sub_face, 11)
    draw.line((920, 910, 2920, 910), fill="#9b7135", width=3)
    draw_tracked(draw, ((WORK_WIDTH - title_width) // 2, 955), title, title_face, "#ebd391", 13)
    draw_tracked(draw, ((WORK_WIDTH - sub_width) // 2, 1112), sub, sub_face, "#aab5c5", 11)
    draw.line((920, 1252, 2920, 1252), fill="#9b7135", width=3)
    image.save(destination)


def make_end_card(background_source: Path, logo_source: Path, destination: Path) -> None:
    with Image.open(background_source) as loaded:
        background = ImageOps.fit(loaded.convert("RGB"), (WORK_WIDTH, WORK_HEIGHT), Image.Resampling.LANCZOS)
    background = background.filter(ImageFilter.GaussianBlur(10))
    background = ImageEnhance.Brightness(background).enhance(0.30)
    overlay = Image.new("RGBA", background.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((0, 0, WORK_WIDTH, WORK_HEIGHT), fill=(0, 0, 0, 65))

    with Image.open(logo_source) as loaded:
        logo = loaded.convert("RGBA")
    target_width = 2740
    target_height = int(logo.height * target_width / logo.width)
    logo = logo.resize((target_width, target_height), Image.Resampling.LANCZOS)
    logo_x = (WORK_WIDTH - target_width) // 2
    logo_y = 230
    overlay.alpha_composite(logo, (logo_x, logo_y))

    cta_face = font(104)
    url_face = font(70, bold=False)
    cta = "JOIN THE BETA"
    url = "SHINOBIJOURNEY.COM"
    cta_width = tracked_width(draw, cta, cta_face, 15)
    url_width = tracked_width(draw, url, url_face, 12)
    button = (WORK_WIDTH // 2 - 760, 1395, WORK_WIDTH // 2 + 760, 1605)
    draw.rounded_rectangle(button, radius=28, fill=(4, 8, 15, 220), outline=(230, 184, 80, 255), width=6)
    draw_tracked(draw, ((WORK_WIDTH - cta_width) // 2, 1423), cta, cta_face, (247, 225, 166, 255), 15)
    draw_tracked(draw, ((WORK_WIDTH - url_width) // 2, 1700), url, url_face, (224, 232, 243, 255), 12)
    draw.line((1240, 1850, 2600, 1850), fill=(138, 101, 42, 210), width=3)
    beta_face = font(42, bold=False)
    beta = "PLAY FREE IN YOUR BROWSER"
    beta_width = tracked_width(draw, beta, beta_face, 8)
    draw_tracked(draw, ((WORK_WIDTH - beta_width) // 2, 1895), beta, beta_face, (164, 177, 197, 255), 8)

    final = Image.alpha_composite(background.convert("RGBA"), overlay)
    darkness = vignette((WORK_WIDTH, WORK_HEIGHT))
    final.paste((0, 0, 0, 165), (0, 0, WORK_WIDTH, WORK_HEIGHT), darkness)
    # Reapply the crisp foreground after the vignette.
    final = Image.alpha_composite(final, overlay)
    final.convert("RGB").save(destination, quality=96)


def motion_filter(motion: str, frame_count: int) -> str:
    last = max(1, frame_count - 1)
    progress = f"min(1,on/{last})"
    if motion == "pull":
        zoom = f"1.14-0.14*{progress}"
        x = "(iw-iw/zoom)/2"
        y = "(ih-ih/zoom)/2"
    elif motion == "pan_lr":
        zoom = f"1.11+0.035*{progress}"
        x = f"(iw-iw/zoom)*{progress}"
        y = "(ih-ih/zoom)*0.52"
    elif motion == "pan_rl":
        zoom = f"1.11+0.035*{progress}"
        x = f"(iw-iw/zoom)*(1-{progress})"
        y = "(ih-ih/zoom)*0.48"
    elif motion == "tilt_up":
        zoom = f"1.08+0.08*{progress}"
        x = "(iw-iw/zoom)/2"
        y = f"(ih-ih/zoom)*(1-{progress})"
    elif motion == "fast_push":
        zoom = f"1.00+0.28*{progress}"
        x = "(iw-iw/zoom)/2"
        y = "(ih-ih/zoom)/2"
    elif motion == "drift_left":
        zoom = f"1.04+0.10*{progress}"
        x = f"(iw-iw/zoom)*(0.70-0.45*{progress})"
        y = "(ih-ih/zoom)*0.48"
    else:
        zoom = f"1.00+0.13*{progress}"
        x = "(iw-iw/zoom)/2"
        y = "(ih-ih/zoom)/2"
    return (
        f"zoompan=z='{zoom}':x='{x}':y='{y}':d=1:s={WIDTH}x{HEIGHT}:fps={FPS},"
        "eq=contrast=1.025:saturation=1.035,unsharp=5:5:0.35:5:5:0.0,"
        "noise=alls=2.2:allf=t,"
        f"drawbox=x=0:y=0:w=iw:h=48:color=black:t=fill,"
        f"drawbox=x=0:y={HEIGHT - 48}:w=iw:h=48:color=black:t=fill"
    )


def render_shot(ffmpeg: str, shot: Shot, normalized: Path, overlay: Path | None, output: Path) -> None:
    frame_count = max(1, round(shot.duration * FPS))
    duration = frame_count / FPS
    base_filter = motion_filter(shot.motion, frame_count)
    command = [ffmpeg, "-y", "-loop", "1", "-framerate", str(FPS), "-i", str(normalized)]
    if overlay:
        fade_out = max(0.0, duration - 0.48)
        command += ["-loop", "1", "-framerate", str(FPS), "-i", str(overlay)]
        filter_graph = (
            f"[0:v]{base_filter}[base];"
            f"[1:v]format=rgba,fade=t=in:st=0:d=0.32:alpha=1,"
            f"fade=t=out:st={fade_out:.3f}:d=0.45:alpha=1[text];"
            "[base][text]overlay=0:0:shortest=1,format=yuv420p[v]"
        )
        command += ["-filter_complex", filter_graph, "-map", "[v]"]
    else:
        command += ["-vf", base_filter + ",format=yuv420p"]
    command += [
        "-frames:v",
        str(frame_count),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(FPS),
        str(output),
    ]
    run(command, quiet=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--music", type=Path)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()

    root = args.root.resolve()
    work = root / "tmp" / "trailer" / "render"
    output_dir = (args.output_dir or root / "output" / "trailer").resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    normalized_dir = work / "normalized"
    clips_dir = work / "clips"
    overlays_dir = work / "overlays"
    normalized_dir.mkdir(exist_ok=True)
    clips_dir.mkdir(exist_ok=True)
    overlays_dir.mkdir(exist_ok=True)

    cinematic = root / "tmp" / "trailer" / "cinematic"
    public = root / "shinobij.client" / "public"
    assets = root / "shinobij.client" / "src" / "assets"
    music = (args.music or root / "tmp" / "trailer" / "shinobi-journey-trailer-music-edit.wav").resolve()

    disclosure = work / "disclosure.png"
    end_card = work / "end-card.jpg"
    make_disclosure(disclosure)
    make_end_card(cinematic / "01-rill-overlook.png", public / "shinobi-journey-logo-wide.webp", end_card)

    shots = [
        Shot("disclosure", disclosure, 0.000, 1.672, "push"),
        Shot("world-awakens", public / "landing-hero-keyart.webp", 1.672, 8.545, "pull"),
        Shot("journey-begins", cinematic / "01-rill-overlook.png", 8.545, 14.303, "pan_rl", "YOUR JOURNEY BEGINS"),
        Shot("four-villages-map", assets / "Maps" / "world_map-v2.webp", 14.303, 21.571, "pull"),
        Shot("rival-banners", public / "landing-clanwar-v2.webp", 21.571, 27.121, "push", "FOUR RIVAL VILLAGES"),
        Shot("rooftop-pursuit", cinematic / "03-rooftop-pursuit.png", 27.121, 33.135, "pan_lr"),
        Shot("bloodline-eye", cinematic / "02-inferno-awakening.png", 33.135, 38.127, "fast_push"),
        Shot("inferno-seal", cinematic / "04-inferno-jutsu.png", 38.127, 45.093, "drift_left"),
        Shot("inferno-landscape", public / "bloodline-inferno-cataclysm.webp", 45.093, 54.242, "push", "AWAKEN YOUR BLOODLINE"),
        Shot("companion-strike", cinematic / "06-rill-lightning-fox.png", 54.242, 60.256, "push"),
        Shot("companion-home", assets / "pet-home" / "home-hero.webp", 60.256, 65.016, "pull", "BONDS BECOME POWER"),
        Shot("world-paths", assets / "Maps" / "world_map-v2.webp", 65.016, 72.191, "pan_lr"),
        Shot("lone-shinobi", public / "landing-hero-keyart.webp", 72.191, 78.112, "drift_left"),
        Shot("war-musters", public / "landing-clanwar-v2.webp", 78.112, 83.476, "fast_push"),
        Shot("four-village-war", cinematic / "05-four-village-war.png", 83.476, 88.398, "push", "FIGHT FOR YOUR CLAN"),
        Shot("oni-reveal", assets / "clan-boss" / "clan-boss-oni.webp", 88.398, 95.062, "fast_push", fit="contain"),
        Shot("oni-confrontation", cinematic / "07-oni-confrontation.png", 95.062, 104.211, "tilt_up"),
        Shot("worldstorm-tower", cinematic / "08-worldstorm-tower.png", 104.211, 111.642, "pan_rl"),
        Shot("spire", assets / "towers" / "spire-banner.webp", 111.642, 116.750, "tilt_up", "CLIMB BEYOND LEGEND", fit="contain"),
        Shot("worldstorm-dragon", assets / "hunter" / "beasts" / "apex-ai-worldstorm-dragon.webp", 116.750, 123.902, "fast_push", fit="contain"),
        Shot("quiet-resolve", cinematic / "01-rill-overlook.png", 123.902, 132.075, "pull", "HOW FAR WILL YOU RISE?"),
        Shot("hollow-hound", public / "hollow-gate" / "hollow-hound-alpha-cinematic.webp", 132.075, 138.321, "fast_push"),
        Shot("hollow-clash", cinematic / "09-hollow-gate-finale.png", 138.321, 145.357, "push"),
        Shot("final-awakening", cinematic / "02-inferno-awakening.png", 145.357, 149.281, "fast_push"),
        Shot("last-charge", cinematic / "03-rooftop-pursuit.png", 149.281, 152.602, "pan_lr"),
        Shot("final-impact", cinematic / "09-hollow-gate-finale.png", 152.602, 155.527, "fast_push"),
        Shot("end-card", end_card, 155.527, 161.624, "push"),
    ]

    captions: dict[str, Path] = {}
    for shot in shots:
        if shot.caption and shot.caption not in captions:
            caption_path = overlays_dir / f"caption-{len(captions):02d}.png"
            make_caption(caption_path, shot.caption)
            captions[shot.caption] = caption_path

    ffmpeg = ffmpeg_path()
    clip_paths: list[Path] = []
    for index, shot in enumerate(shots):
        if not shot.source.exists():
            raise FileNotFoundError(shot.source)
        normalized = normalized_dir / f"{index:02d}-{shot.name}.jpg"
        if not normalized.exists():
            normalize_image(shot.source, normalized, shot.fit)
        clip = clips_dir / f"{index:02d}-{shot.name}.mp4"
        print(f"[{index + 1:02d}/{len(shots):02d}] {shot.name} ({shot.duration:.3f}s)")
        if clip.exists() and clip.stat().st_size > 100_000:
            print(f"  reusing {clip.name}")
        else:
            render_shot(ffmpeg, shot, normalized, captions.get(shot.caption), clip)
        clip_paths.append(clip)

    concat_path = work / "concat.txt"
    concat_path.write_text(
        "".join(f"file '{path.as_posix()}'\n" for path in clip_paths),
        encoding="utf-8",
    )
    silent_video = work / "silent-trailer.mp4"
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_path), "-c", "copy", str(silent_video)])

    sfx_events = [
        (public / "sfx" / "production" / "reveal.wav", 8.545, 0.22),
        (public / "sfx" / "production" / "impact-heavy.wav", 28.561, 0.20),
        (public / "sfx" / "production" / "chakra-positive.wav", 38.127, 0.18),
        (public / "sfx" / "production" / "battle-transition.wav", 54.242, 0.18),
        (public / "sfx" / "production" / "command.wav", 83.476, 0.16),
        (public / "sfx" / "production" / "impact-heavy.wav", 95.062, 0.24),
        (public / "sfx" / "production" / "omen.wav", 132.075, 0.20),
        (public / "sfx" / "production" / "knockout.wav", 152.602, 0.28),
        (public / "sfx" / "production" / "victory-seal.wav", 155.527, 0.24),
    ]
    for path, _, _ in sfx_events:
        if not path.exists():
            raise FileNotFoundError(path)

    final_path = output_dir / "shinobi-journey-cinematic-beta-trailer-1080p.mp4"
    final_temp = work / "final-master.tmp.mp4"
    command = [ffmpeg, "-y", "-i", str(silent_video), "-i", str(music)]
    for path, _, _ in sfx_events:
        command += ["-i", str(path)]
    audio_filters = ["[1:a]volume=1.0[music]"]
    mix_labels = ["[music]"]
    for index, (_, time_seconds, volume) in enumerate(sfx_events):
        delay_ms = round(time_seconds * 1000)
        input_index = index + 2
        label = f"sfx{index}"
        audio_filters.append(f"[{input_index}:a]adelay={delay_ms}:all=1,volume={volume}[{label}]")
        mix_labels.append(f"[{label}]")
    audio_filters.append(
        "".join(mix_labels)
        + f"amix=inputs={len(mix_labels)}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.96[aout]"
    )
    command += [
        "-filter_complex",
        ";".join(audio_filters),
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
        str(final_temp),
    ]
    run(command)
    os.replace(final_temp, final_path)
    print(f"Rendered {final_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise
