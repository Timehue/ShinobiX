"""Build the Rill-led Shinobi Journey V25 cinematic and landing-page cuts."""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from render_trailer_v5 import FPS, HEIGHT, WIDTH, ffmpeg_path, run


FULL_DURATION = 69.0
LANDING_DURATION = 24.0
BAR_HEIGHT = 58


@dataclass(frozen=True)
class CinematicShot:
    name: str
    source: Path
    duration: float
    still: bool = False
    offset: float = 0.0
    zoom_start: float = 1.025
    zoom_end: float = 1.075
    pan_x: float = 0.5
    pan_y: float = 0.5
    overlay: str | None = None
    flash: bool = False


def title_font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in (
        Path("C:/Windows/Fonts/georgiab.ttf"),
        Path("C:/Windows/Fonts/timesbd.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
    ):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default(size=size)


def body_font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in (
        Path("C:/Windows/Fonts/georgia.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
    ):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default(size=size)


def tracked_width(draw: ImageDraw.ImageDraw, text: str, face: ImageFont.FreeTypeFont, tracking: int) -> int:
    return round(sum(draw.textlength(character, font=face) for character in text) + tracking * max(0, len(text) - 1))


def draw_tracked(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    face: ImageFont.FreeTypeFont,
    tracking: int,
    fill: tuple[int, int, int, int],
    anchor: str = "center",
) -> None:
    width = tracked_width(draw, text, face, tracking)
    x = xy[0] - width // 2 if anchor == "center" else xy[0]
    y = xy[1]
    for character in text:
        draw.text(
            (x + 3, y + 4),
            character,
            font=face,
            fill=(0, 0, 0, 210),
            stroke_width=3,
            stroke_fill=(0, 0, 0, 190),
        )
        draw.text(
            (x, y),
            character,
            font=face,
            fill=fill,
            stroke_width=1,
            stroke_fill=(72, 118, 150, 220),
        )
        x += round(draw.textlength(character, font=face)) + tracking


def make_story_overlay(destination: Path, headline: str, kicker: str | None = None) -> None:
    image = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    lines = [line.strip().upper() for line in headline.split("\n") if line.strip()]
    face = title_font(58 if len(max(lines, key=len)) < 27 else 50)
    y = 790 - (len(lines) - 1) * 40
    if kicker:
        kicker_face = body_font(21)
        draw_tracked(draw, (WIDTH // 2, y - 60), kicker.upper(), kicker_face, 7, (148, 216, 244, 245))
    draw.line((WIDTH // 2 - 310, y - 22, WIDTH // 2 + 310, y - 22), fill=(106, 198, 234, 205), width=2)
    for index, line in enumerate(lines):
        draw_tracked(draw, (WIDTH // 2, y + index * 70), line, face, 4, (246, 244, 235, 255))
    image.save(destination)


def make_end_card(destination: Path, logo_path: Path) -> None:
    base = Image.new("RGBA", (WIDTH, HEIGHT), (3, 8, 17, 255))
    glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((390, 30, 1530, 910), fill=(20, 132, 190, 90))
    glow_draw.ellipse((670, 120, 1290, 750), fill=(226, 154, 63, 75))
    glow = glow.filter(ImageFilter.GaussianBlur(170))
    base = Image.alpha_composite(base, glow)
    draw = ImageDraw.Draw(base)
    for index in range(34):
        x = (97 * index + 141) % WIDTH
        y = (173 * index + 83) % HEIGHT
        radius = 1 + index % 2
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(128, 211, 244, 75))

    logo = Image.open(logo_path).convert("RGBA")
    logo.thumbnail((1200, 410), Image.Resampling.LANCZOS)
    logo_x = (WIDTH - logo.width) // 2
    base.alpha_composite(logo, (logo_x, 180))

    cta_face = title_font(45)
    draw_tracked(draw, (WIDTH // 2, 702), "PLAY FREE NOW", cta_face, 5, (255, 241, 207, 255))
    url_face = body_font(24)
    draw_tracked(draw, (WIDTH // 2, 780), "SHINOBIJOURNEY.COM", url_face, 7, (139, 214, 242, 255))
    legal_face = body_font(19)
    legal = "CINEMATIC TRAILER  |  NOT ACTUAL GAMEPLAY"
    legal_width = draw.textlength(legal, font=legal_face)
    draw.text(((WIDTH - legal_width) / 2, 924), legal, font=legal_face, fill=(180, 188, 199, 225))
    draw.line((655, 853, 1265, 853), fill=(194, 138, 63, 170), width=2)
    base.save(destination)


def render_clip(
    ffmpeg: str,
    shot: CinematicShot,
    overlay_path: Path | None,
    destination: Path,
) -> None:
    frames = max(1, round(shot.duration * FPS))
    duration = frames / FPS
    command = [ffmpeg, "-loglevel", "error", "-y"]
    if shot.still:
        command += ["-loop", "1", "-framerate", str(FPS), "-i", str(shot.source)]
    else:
        command += ["-ss", f"{shot.offset:.3f}", "-i", str(shot.source)]
    if overlay_path:
        command += ["-loop", "1", "-framerate", str(FPS), "-i", str(overlay_path)]

    if shot.still:
        denominator = max(1, frames - 1)
        zoom = f"{shot.zoom_start:.5f}+({shot.zoom_end - shot.zoom_start:.5f})*on/{denominator}"
        base_filter = (
            "[0:v]scale=2200:1238:force_original_aspect_ratio=increase:flags=lanczos,"
            "crop=2200:1238,"
            f"zoompan=z='{zoom}':"
            f"x='(iw-iw/zoom)*{shot.pan_x:.4f}':y='(ih-ih/zoom)*{shot.pan_y:.4f}':"
            f"d=1:s={WIDTH}x{HEIGHT}:fps={FPS},"
        )
    else:
        base_filter = (
            "[0:v]setpts=PTS-STARTPTS,"
            f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,"
            f"crop={WIDTH}:{HEIGHT},fps={FPS},"
            f"tpad=stop_mode=clone:stop_duration=2,trim=duration={duration:.6f},"
        )
    base_filter += (
        "hqdn3d=0.35:0.28:1.0:0.8,"
        "eq=contrast=1.055:saturation=1.070:gamma=1.010:brightness=-0.004,"
        "curves=all='0/0 0.10/0.075 0.50/0.535 0.90/0.94 1/1',"
        "unsharp=5:5:0.30:5:5:0.0,vignette=PI/5"
    )
    if shot.flash:
        base_filter += ",fade=t=in:st=0:d=0.080:color=white"
    filters = [base_filter + "[base]"]
    current = "base"
    if overlay_path:
        fade_out = max(0.0, duration - 0.24)
        filters.append(
            f"[1:v]format=rgba,fade=t=in:st=0.14:d=0.26:alpha=1,"
            f"fade=t=out:st={fade_out:.3f}:d=0.20:alpha=1[text]"
        )
        filters.append(f"[{current}][text]overlay=0:0:shortest=1[captioned]")
        current = "captioned"
    filters.append(
        f"[{current}]drawbox=x=0:y=0:w=iw:h={BAR_HEIGHT}:color=black:t=fill,"
        f"drawbox=x=0:y={HEIGHT - BAR_HEIGHT}:w=iw:h={BAR_HEIGHT}:color=black:t=fill,"
        "format=yuv420p[out]"
    )
    command += [
        "-filter_complex",
        ";".join(filters),
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
        "15",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(FPS),
        str(destination),
    ]
    run(command, quiet=True)


def assemble_silent(ffmpeg: str, clips: list[Path], manifest: Path, destination: Path) -> None:
    manifest.write_text("".join(f"file '{clip.as_posix()}'\n" for clip in clips), encoding="utf-8")
    run([
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
        "-c",
        "copy",
        str(destination),
    ])


def mix_audio(
    ffmpeg: str,
    silent: Path,
    song: Path,
    sfx_root: Path,
    duration: float,
    events: list[tuple[str, float, float]],
    destination: Path,
) -> None:
    command = [ffmpeg, "-loglevel", "error", "-y", "-i", str(silent), "-i", str(song)]
    for filename, _, _ in events:
        command += ["-i", str(sfx_root / filename)]
    fade_start = max(0.0, duration - 2.25)
    filters = [
        f"[1:a]atrim=start=0:end={duration:.3f},asetpts=PTS-STARTPTS,"
        f"volume=0.94,afade=t=in:st=0:d=0.12,afade=t=out:st={fade_start:.3f}:d=2.20[music]"
    ]
    labels = ["[music]"]
    for index, (_, timestamp, volume) in enumerate(events):
        label = f"sfx{index}"
        filters.append(
            f"[{index + 2}:a]adelay={round(timestamp * 1000)}:all=1,"
            f"volume={volume:.4f}[{label}]"
        )
        labels.append(f"[{label}]")
    filters.append(
        "".join(labels)
        + f"amix=inputs={len(labels)}:duration=first:dropout_transition=0:normalize=0,"
        "alimiter=limit=0.95[aout]"
    )
    temporary = destination.with_name(destination.stem + ".tmp.mp4")
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
    os.replace(temporary, destination)


def encode_web(ffmpeg: str, source: Path, destination: Path, crf: int) -> None:
    run([
        ffmpeg,
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        str(crf),
        "-profile:v",
        "high",
        "-level",
        "4.1",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        str(destination),
    ])


def ensure_duration(name: str, shots: list[CinematicShot], expected: float) -> None:
    total_frames = sum(max(1, round(shot.duration * FPS)) for shot in shots)
    expected_frames = round(expected * FPS)
    if total_frames != expected_frames:
        raise ValueError(f"{name} timeline is {total_frames} frames; expected {expected_frames}")


def render_timeline(
    ffmpeg: str,
    shots: list[CinematicShot],
    work: Path,
    label: str,
    force: bool,
) -> Path:
    clip_dir = work / f"clips-{label}"
    overlay_dir = work / "overlays"
    clip_dir.mkdir(parents=True, exist_ok=True)
    overlay_dir.mkdir(parents=True, exist_ok=True)
    rendered: list[Path] = []
    for index, shot in enumerate(shots):
        destination = clip_dir / f"{index:03d}-{shot.name}.mp4"
        overlay_path = None
        if shot.overlay:
            overlay_path = overlay_dir / f"{shot.overlay}.png"
            if not overlay_path.exists():
                raise FileNotFoundError(overlay_path)
        if force or not destination.exists():
            print(f"[{label}] {index + 1:02d}/{len(shots):02d} {shot.name}", flush=True)
            render_clip(ffmpeg, shot, overlay_path, destination)
        rendered.append(destination)
    silent = work / f"silent-{label}.mp4"
    assemble_silent(ffmpeg, rendered, work / f"concat-{label}.txt", silent)
    return silent


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
    song = args.song.resolve(strict=True)
    ffmpeg = ffmpeg_path()
    work = root / "tmp" / "trailer" / "render-v25"
    output = root / "output" / "trailer"
    overlays = work / "overlays"
    for directory in (work, output, overlays):
        directory.mkdir(parents=True, exist_ok=True)

    art = root / "tmp" / "trailer" / "cinematic-v25"
    v19 = root / "tmp" / "trailer" / "render-v19" / "clips"
    v21 = root / "tmp" / "trailer" / "render-v21" / "clips"
    v23 = root / "tmp" / "trailer" / "render-v23" / "clips"
    story = root / "shinobij.client" / "public" / "scenes" / "story" / "cinematic" / "storywide"
    end_card = work / "end-card-v25.png"

    make_story_overlay(overlays / "meter-truth.png", "THE WORLD REMEMBERS\nYOU WRONG.", "FROSTFANG VILLAGE")
    make_story_overlay(overlays / "four-sacrifices.png", "FOUR VILLAGES.\nFOUR SACRIFICES.")
    make_story_overlay(overlays / "court-machine.png", "ONE MACHINE\nBENEATH THEM ALL.", "THE SUNKEN COURT")
    make_story_overlay(overlays / "unclassifiable.png", "IT COULD NOT\nCLASSIFY HIM.", "RILL SMITH")
    make_end_card(end_card, root / "shinobij.client" / "public" / "shinobi-journey-logo-wide.webp")

    meter = art / "002-rill-meter-discovery-v25.png"
    court = art / "003-sunken-court-reveal-v25.png"
    fight = art / "004-rill-vs-hollow-kael-v25.png"
    close = art / "005-rill-final-close-v25.png"
    anchor = art / "001-rill-character-anchor-v25.png"

    ice = v19 / "005-ice-capital.mp4"
    fire = v21 / "006-fire-capital-embers-ambient-v21.mp4"
    wind = v19 / "007-wind-capital.mp4"
    lightning = v19 / "008-lightning-capital.mp4"
    eclipse = v19 / "009-elemental-eclipse.mp4"
    seal_room = v21 / "010-ancient-seal-ash-ambient-v21.mp4"
    rooftop = v19 / "012-rooftop-sentry.mp4"
    focus = v19 / "013-rill-focus.mp4"
    armies = v19 / "020-four-armies.mp4"
    combo = v19 / "040-elemental-combo.mp4"
    oni_shadow = v21 / "042-oni-shadow-ash-ambient-v21.mp4"
    oni_close = v21 / "043-oni-close-embers-ambient-v21.mp4"
    siege = v19 / "052-four-clan-siege.mp4"
    fracture = v19 / "053-seal-fracture.mp4"
    stag = v19 / "054-hollow-stag.mp4"
    leviathan = v19 / "056-world-event-leviathan.mp4"
    finisher = v23 / "057-squad-leviathan-finisher-v23.mp4"

    required = [
        meter, court, fight, close, anchor, ice, fire, wind, lightning, eclipse, seal_room,
        rooftop, focus, armies, combo, oni_shadow, oni_close, siege, fracture, stag,
        leviathan, finisher, end_card,
    ]
    missing = [path for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing V25 sources:\n" + "\n".join(str(path) for path in missing))

    full = [
        CinematicShot("meter-discovery", meter, 5.100, still=True, zoom_end=1.090, pan_x=0.47, overlay="meter-truth"),
        CinematicShot("rooftop-sentry", rooftop, 3.445),
        CinematicShot("frostfang-whiteout", story / "frostfang-whiteout.webp", 2.855, still=True, zoom_end=1.060, pan_x=0.58),
        CinematicShot("rill-focus", focus, 2.903),
        CinematicShot("rill-village-oath", anchor, 1.200, still=True, zoom_start=1.060, zoom_end=1.085, overlay="four-sacrifices", flash=True),
        CinematicShot("ice-capital", ice, 1.850),
        CinematicShot("fire-capital", fire, 1.850),
        CinematicShot("wind-capital", wind, 1.850),
        CinematicShot("lightning-capital", lightning, 1.850),
        CinematicShot("elemental-eclipse", eclipse, 1.900, flash=True),
        CinematicShot("ancient-seal", seal_room, 2.318),
        CinematicShot("sunken-court-reveal", court, 3.179, still=True, zoom_end=1.085, pan_y=0.46, overlay="court-machine", flash=True),
        CinematicShot("rill-first-strike", fight, 2.300, still=True, zoom_start=1.040, zoom_end=1.105, pan_x=0.48),
        CinematicShot("oni-shadow", oni_shadow, 2.000),
        CinematicShot("oni-close", oni_close, 1.800),
        CinematicShot("four-armies", armies, 2.200, flash=True),
        CinematicShot("elemental-combo", combo, 2.200),
        CinematicShot("rill-vs-kael", fight, 2.600, still=True, zoom_start=1.085, zoom_end=1.150, pan_x=0.54, flash=True),
        CinematicShot("seal-fracture", fracture, 2.200),
        CinematicShot("four-clan-siege", siege, 2.200),
        CinematicShot("hollow-stag", stag, 2.200),
        CinematicShot("world-leviathan", leviathan, 2.200),
        CinematicShot("squad-finisher", finisher, 2.042, flash=True),
        CinematicShot("rill-unclassifiable", close, 2.058, still=True, zoom_start=1.055, zoom_end=1.100, pan_x=0.46, overlay="unclassifiable"),
        CinematicShot("rill-climax", fight, 2.000, still=True, zoom_start=1.120, zoom_end=1.180, pan_x=0.55, flash=True),
        CinematicShot("finisher-return", finisher, 1.700),
        CinematicShot("seal-break", fracture, 1.700, flash=True),
        CinematicShot("court-awakens", court, 1.700, still=True, zoom_start=1.100, zoom_end=1.155, pan_y=0.43),
        CinematicShot("rill-resolves", close, 1.550, still=True, zoom_start=1.100, zoom_end=1.145, pan_x=0.48),
        CinematicShot("end-card", end_card, 4.000, still=True, zoom_start=1.000, zoom_end=1.018),
    ]
    ensure_duration("full", full, FULL_DURATION)

    landing = [
        CinematicShot("meter-discovery", meter, 3.100, still=True, zoom_end=1.085, overlay="meter-truth"),
        CinematicShot("rooftop-sentry", rooftop, 2.000),
        CinematicShot("ice-capital", ice, 0.767),
        CinematicShot("fire-capital", fire, 0.767),
        CinematicShot("wind-capital", wind, 0.750),
        CinematicShot("lightning-capital", lightning, 0.750),
        CinematicShot("sunken-court", court, 2.800, still=True, zoom_end=1.095, overlay="court-machine", flash=True),
        CinematicShot("oni-shadow", oni_shadow, 1.300),
        CinematicShot("rill-vs-kael", fight, 2.300, still=True, zoom_start=1.070, zoom_end=1.145, flash=True),
        CinematicShot("seal-fracture", fracture, 1.500),
        CinematicShot("four-armies", armies, 1.500),
        CinematicShot("squad-finisher", finisher, 1.500, flash=True),
        CinematicShot("rill-unclassifiable", close, 1.700, still=True, zoom_start=1.070, zoom_end=1.120, overlay="unclassifiable"),
        CinematicShot("end-card", end_card, 3.300, still=True, zoom_start=1.000, zoom_end=1.015),
    ]
    ensure_duration("landing", landing, LANDING_DURATION)

    sfx = root / "shinobij.client" / "public" / "sfx" / "production"
    full_events = [
        ("omen.wav", 0.200, 0.105),
        ("battle-transition.wav", 5.100, 0.075),
        ("reveal.wav", 8.545, 0.105),
        ("chapter-seal.wav", 14.303, 0.125),
        ("mythic.wav", 22.703, 0.075),
        ("impact-heavy.wav", 27.121, 0.120),
        ("chakra-negative.wav", 32.600, 0.080),
        ("battle-transition.wav", 34.600, 0.075),
        ("impact-heavy.wav", 38.600, 0.075),
        ("battle-transition.wav", 43.400, 0.080),
        ("impact-heavy.wav", 45.600, 0.105),
        ("decision.wav", 54.242, 0.090),
        ("battle-transition.wav", 56.300, 0.085),
        ("impact-heavy.wav", 58.300, 0.100),
        ("mythic.wav", 61.700, 0.085),
        ("chakra-positive.wav", 63.400, 0.085),
        ("victory-seal.wav", 65.016, 0.145),
    ]
    landing_events = [
        ("omen.wav", 0.100, 0.110),
        ("battle-transition.wav", 3.100, 0.080),
        ("chapter-seal.wav", 5.100, 0.100),
        ("impact-heavy.wav", 8.100, 0.120),
        ("battle-transition.wav", 12.200, 0.090),
        ("impact-heavy.wav", 14.500, 0.110),
        ("impact-heavy.wav", 17.500, 0.105),
        ("victory-seal.wav", 20.700, 0.150),
    ]

    full_silent = render_timeline(ffmpeg, full, work, "full", args.force)
    full_master = output / "shinobi-journey-rill-cinematic-v25-1080p.mp4"
    mix_audio(ffmpeg, full_silent, song, sfx, FULL_DURATION, full_events, full_master)
    encode_web(ffmpeg, full_master, output / "shinobi-journey-rill-cinematic-v25-web.mp4", 23)

    landing_silent = render_timeline(ffmpeg, landing, work, "landing", args.force)
    landing_master = output / "shinobi-journey-rill-landing-v25-1080p.mp4"
    mix_audio(ffmpeg, landing_silent, song, sfx, LANDING_DURATION, landing_events, landing_master)
    encode_web(ffmpeg, landing_master, output / "shinobi-journey-rill-landing-v25-web.mp4", 24)

    print(f"Rendered {full_master}")
    print(f"Rendered {landing_master}")


if __name__ == "__main__":
    main()
