"""Render the faster, motion-heavy Shinobi Journey cinematic trailer V2."""

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
    kind: str = "still"
    motion: str = "push"
    caption: str | None = None
    particles: str | None = None
    reverse: bool = False
    flash: bool = False
    grade: str = "neutral"

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
    return int(sum(draw.textlength(character, font=face) for character in text) + max(0, len(text) - 1) * tracking)


def draw_tracked(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    face: ImageFont.ImageFont,
    fill: tuple[int, int, int, int] | str,
    tracking: int,
    *,
    stroke_width: int = 0,
    stroke_fill: tuple[int, int, int, int] | str | None = None,
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


def normalize_image(source: Path, destination: Path) -> None:
    with Image.open(source) as loaded:
        image = ImageOps.fit(loaded.convert("RGB"), (WORK_WIDTH, WORK_HEIGHT), Image.Resampling.LANCZOS)
    image = ImageEnhance.Contrast(image).enhance(1.045)
    image = ImageEnhance.Color(image).enhance(1.055)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, quality=95)


def make_caption(destination: Path, text: str) -> None:
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    face = font(78)
    text = text.upper()
    tracking = 7
    width = tracked_width(draw, text, face, tracking)
    x = (WIDTH - width) // 2
    y = 760
    draw.rectangle((x - 92, y - 30, x + width + 92, y + 126), fill=(2, 5, 10, 182))
    draw.polygon(((x - 92, y - 30), (x - 52, y - 30), (x - 92, y + 126)), fill=(176, 38, 25, 245))
    draw.polygon(((x + width + 92, y - 30), (x + width + 52, y + 126), (x + width + 92, y + 126)), fill=(176, 38, 25, 245))
    draw.line((x - 42, y - 6, x + width + 42, y - 6), fill=(244, 197, 88, 230), width=3)
    draw.line((x - 42, y + 101, x + width + 42, y + 101), fill=(244, 197, 88, 230), width=3)
    draw_tracked(draw, (x + 4, y + 5), text, face, (0, 0, 0, 235), tracking, stroke_width=4, stroke_fill=(0, 0, 0, 235))
    draw_tracked(draw, (x, y), text, face, (250, 238, 205, 255), tracking, stroke_width=1, stroke_fill=(102, 57, 18, 255))
    overlay.save(destination)


def make_disclosure(destination: Path) -> None:
    image = Image.new("RGB", (WORK_WIDTH, WORK_HEIGHT), "#020407")
    draw = ImageDraw.Draw(image)
    title_face = font(106)
    sub_face = font(54, bold=False)
    title = "CINEMATIC TRAILER"
    sub = "NOT ACTUAL GAMEPLAY"
    title_width = tracked_width(draw, title, title_face, 14)
    sub_width = tracked_width(draw, sub, sub_face, 10)
    draw.line((930, 855, 2910, 855), fill="#a67834", width=4)
    draw_tracked(draw, ((WORK_WIDTH - title_width) // 2, 930), title, title_face, "#efd99a", 14)
    draw_tracked(draw, ((WORK_WIDTH - sub_width) // 2, 1090), sub, sub_face, "#aab7c9", 10)
    draw.line((930, 1250, 2910, 1250), fill="#a67834", width=4)
    image.save(destination, quality=96)


def make_end_card(
    background_source: Path,
    logo_source: Path,
    destination: Path,
    *,
    cta: str = "JOIN THE BETA",
    url: str = "SHINOBIJOURNEY.COM",
    small: str = "PLAY FREE IN YOUR BROWSER",
    logo_width: int = 2680,
    logo_y: int = 220,
) -> None:
    with Image.open(background_source) as loaded:
        background = ImageOps.fit(loaded.convert("RGB"), (WORK_WIDTH, WORK_HEIGHT), Image.Resampling.LANCZOS)
    background = background.filter(ImageFilter.GaussianBlur(6))
    background = ImageEnhance.Brightness(background).enhance(0.32)
    overlay = Image.new("RGBA", background.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((0, 0, WORK_WIDTH, WORK_HEIGHT), fill=(0, 0, 0, 62))

    with Image.open(logo_source) as loaded:
        logo = loaded.convert("RGBA")
    logo_height = int(logo.height * logo_width / logo.width)
    logo = logo.resize((logo_width, logo_height), Image.Resampling.LANCZOS)
    overlay.alpha_composite(logo, ((WORK_WIDTH - logo_width) // 2, logo_y))

    cta_face = font(114)
    url_face = font(74, bold=False)
    small_face = font(42, bold=False)
    cta_width = tracked_width(draw, cta, cta_face, 17)
    url_width = tracked_width(draw, url, url_face, 12)
    small_width = tracked_width(draw, small, small_face, 7)
    draw.rounded_rectangle((1110, 1365, 2730, 1605), radius=32, fill=(3, 7, 14, 232), outline=(234, 188, 78, 255), width=7)
    draw_tracked(draw, ((WORK_WIDTH - cta_width) // 2, 1395), cta, cta_face, (251, 231, 176, 255), 17)
    draw_tracked(draw, ((WORK_WIDTH - url_width) // 2, 1690), url, url_face, (233, 240, 249, 255), 12)
    draw.line((1240, 1855, 2600, 1855), fill=(153, 108, 42, 230), width=3)
    draw_tracked(draw, ((WORK_WIDTH - small_width) // 2, 1900), small, small_face, (174, 188, 207, 255), 7)
    Image.alpha_composite(background.convert("RGBA"), overlay).convert("RGB").save(destination, quality=96)


def still_motion_filter(motion: str, frame_count: int, grade: str, flash: bool) -> str:
    last = max(1, frame_count - 1)
    progress = f"min(1,on/{last})"
    if motion == "pull":
        zoom, x, y = f"1.18-0.16*{progress}", "(iw-iw/zoom)/2", "(ih-ih/zoom)/2"
    elif motion == "pan_lr":
        zoom, x, y = f"1.16+0.05*{progress}", f"(iw-iw/zoom)*{progress}", "(ih-ih/zoom)*0.50"
    elif motion == "pan_rl":
        zoom, x, y = f"1.16+0.05*{progress}", f"(iw-iw/zoom)*(1-{progress})", "(ih-ih/zoom)*0.50"
    elif motion == "tilt_up":
        zoom, x, y = f"1.11+0.10*{progress}", "(iw-iw/zoom)/2", f"(ih-ih/zoom)*(1-{progress})"
    elif motion == "fast_push":
        zoom, x, y = f"1.00+0.33*{progress}", "(iw-iw/zoom)/2", "(ih-ih/zoom)/2"
    elif motion == "whip_lr":
        zoom, x, y = f"1.23+0.18*{progress}", f"(iw-iw/zoom)*{progress}", "(ih-ih/zoom)*0.48"
    elif motion == "whip_rl":
        zoom, x, y = f"1.23+0.18*{progress}", f"(iw-iw/zoom)*(1-{progress})", "(ih-ih/zoom)*0.52"
    else:
        zoom, x, y = f"1.02+0.17*{progress}", "(iw-iw/zoom)/2", "(ih-ih/zoom)/2"

    shake_x = "40+7*sin(n*2.1)+4*sin(n*5.7)" if motion in {"fast_push", "whip_lr", "whip_rl"} else "40+2*sin(n*0.21)"
    shake_y = "23+6*cos(n*2.7)" if motion in {"fast_push", "whip_lr", "whip_rl"} else "23+2*cos(n*0.17)"
    brightness = {
        "fire": "0.010*sin(15*t)",
        "storm": "if(lt(mod(t,1.17),0.055),0.20,0)",
        "cold": "-0.015",
    }.get(grade, "0")
    filters = [
        f"zoompan=z='{zoom}':x='{x}':y='{y}':d=1:s=2000x1126:fps={FPS}",
        f"crop={WIDTH}:{HEIGHT}:x='{shake_x}':y='{shake_y}'",
        f"eq=brightness='{brightness}':contrast=1.055:saturation=1.095:gamma=0.985:eval=frame",
        "unsharp=5:5:0.48:5:5:0.0",
        "noise=alls=2.0:allf=t",
    ]
    if flash:
        filters.append("fade=t=in:st=0:d=0.10:color=white")
    return ",".join(filters)


def video_motion_filter(shot: Shot) -> str:
    filters = []
    if shot.reverse:
        filters.append("reverse")
    filters.extend(
        [
            "minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1",
            "tpad=stop_mode=clone:stop_duration=4",
            "scale=2000:1126:flags=lanczos",
        ]
    )
    if shot.motion in {"fast_push", "whip_lr", "whip_rl"}:
        filters.append("crop=1920:1080:x='40+7*sin(n*2.2)':y='23+5*cos(n*2.9)'")
    else:
        filters.append("crop=1920:1080:x='40+2*sin(n*0.18)':y='23+2*cos(n*0.15)'")
    brightness = {
        "fire": "0.010*sin(15*t)",
        "storm": "if(lt(mod(t,1.17),0.055),0.18,0)",
        "cold": "-0.015",
    }.get(shot.grade, "0")
    filters.extend(
        [
            f"eq=brightness='{brightness}':contrast=1.055:saturation=1.105:gamma=0.985:eval=frame",
            "unsharp=5:5:0.48:5:5:0.0",
            "noise=alls=1.8:allf=t",
        ]
    )
    if shot.flash:
        filters.append("fade=t=in:st=0:d=0.10:color=white")
    return ",".join(filters)


def render_shot(
    ffmpeg: str,
    shot: Shot,
    normalized: Path | None,
    overlay: Path | None,
    particle_plate: Path | None,
    output: Path,
) -> None:
    frame_count = max(1, round(shot.duration * FPS))
    exact_duration = frame_count / FPS
    source = normalized if shot.kind == "still" else shot.source
    assert source is not None

    command = [ffmpeg, "-y"]
    if shot.kind == "still":
        command += ["-loop", "1", "-framerate", str(FPS), "-i", str(source)]
        base_filter = still_motion_filter(shot.motion, frame_count, shot.grade, shot.flash)
    else:
        command += ["-i", str(source)]
        base_filter = video_motion_filter(shot)

    particle_index: int | None = None
    overlay_index: int | None = None
    next_input = 1
    if particle_plate:
        particle_index = next_input
        next_input += 1
        command += ["-stream_loop", "-1", "-i", str(particle_plate)]
    if overlay:
        overlay_index = next_input
        command += ["-loop", "1", "-framerate", str(FPS), "-i", str(overlay)]

    graph = [f"[0:v]{base_filter}[base]"]
    current = "base"
    if particle_index is not None:
        opacity = {"embers": 0.62, "snow": 0.48, "rain": 0.43, "ash": 0.36}.get(shot.particles or "", 0.4)
        graph.append(f"[{particle_index}:v]scale={WIDTH}:{HEIGHT}:flags=lanczos[particles]")
        graph.append(f"[{current}][particles]blend=all_mode=screen:all_opacity={opacity:.2f}[withfx]")
        current = "withfx"
    if overlay_index is not None:
        fade_out = max(0.0, exact_duration - 0.30)
        graph.append(
            f"[{overlay_index}:v]format=rgba,fade=t=in:st=0:d=0.16:alpha=1,"
            f"fade=t=out:st={fade_out:.3f}:d=0.28:alpha=1[text]"
        )
        graph.append(f"[{current}][text]overlay=0:0:shortest=1[withtext]")
        current = "withtext"
    graph.append(
        f"[{current}]drawbox=x=0:y=0:w=iw:h=46:color=black:t=fill,"
        f"drawbox=x=0:y={HEIGHT - 46}:w=iw:h=46:color=black:t=fill,format=yuv420p[v]"
    )
    command += [
        "-filter_complex",
        ";".join(graph),
        "-map",
        "[v]",
        "-frames:v",
        str(frame_count),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(FPS),
        str(output),
    ]
    run(command, quiet=True)


def make_music_edit(ffmpeg: str, source: Path, destination: Path) -> None:
    if destination.exists() and destination.stat().st_size > 1_000_000:
        return
    graph = (
        "[0:a]atrim=start=65.016:end=123.902,asetpts=PTS-STARTPTS[a];"
        "[0:a]atrim=start=175.171:end=204.840,asetpts=PTS-STARTPTS[b];"
        "[a][b]acrossfade=d=0.120:c1=tri:c2=tri[out]"
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
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    root = args.root.resolve()
    work = root / "tmp" / "trailer" / "render-v2"
    normalized_dir = work / "normalized"
    clips_dir = work / "clips"
    overlays_dir = work / "overlays"
    for directory in (work, normalized_dir, clips_dir, overlays_dir):
        directory.mkdir(parents=True, exist_ok=True)
    output_dir = (args.output_dir or root / "output" / "trailer").resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    cinematic = root / "tmp" / "trailer" / "cinematic"
    motion = root / "tmp" / "trailer" / "motion"
    public = root / "shinobij.client" / "public"
    assets = root / "shinobij.client" / "src" / "assets"
    ffmpeg = ffmpeg_path()

    disclosure = work / "disclosure-v2.jpg"
    end_card = work / "end-card-v2.jpg"
    make_disclosure(disclosure)
    make_end_card(cinematic / "09-hollow-gate-finale.png", public / "shinobi-journey-logo-wide.webp", end_card)

    svd = lambda name: motion / f"svd-{name}.mp4"
    shots = [
        Shot("disclosure", disclosure, 0.000, 1.200, motion="push"),
        Shot("overlook-motion-a", svd("01-rill-overlook"), 1.200, 3.158, "video", caption="YOUR JOURNEY BEGINS", particles="snow", grade="cold"),
        Shot("overlook-drive", cinematic / "01-rill-overlook.png", 3.158, 4.737, motion="fast_push", particles="snow", grade="cold"),
        Shot("world-map-open", assets / "Maps" / "world_map-v2.webp", 4.737, 7.175, motion="whip_lr", particles="ash"),
        Shot("rooftop-motion-a", motion / "svd-rooftop-test.mp4", 7.175, 8.754, "video", motion="whip_lr", particles="rain", flash=True, grade="storm"),
        Shot("rooftop-pursuit-a", cinematic / "03-rooftop-pursuit.png", 8.754, 10.333, motion="pan_lr", particles="rain", grade="storm"),
        Shot("awakening-motion-a", svd("02-inferno-awakening"), 10.333, 11.912, "video", motion="fast_push", particles="embers", flash=True, grade="fire"),
        Shot("awakening-close", cinematic / "02-inferno-awakening.png", 11.912, 13.491, motion="fast_push", caption="AWAKEN YOUR BLOODLINE", particles="embers", grade="fire"),
        Shot("jutsu-motion-a", svd("04-inferno-jutsu"), 13.491, 15.070, "video", motion="whip_rl", particles="embers", flash=True, grade="fire"),
        Shot("jutsu-sweep", cinematic / "04-inferno-jutsu.png", 15.070, 16.649, motion="whip_lr", particles="embers", grade="fire"),
        Shot("bloodline-world", public / "bloodline-inferno-cataclysm.webp", 16.649, 18.460, motion="fast_push", particles="embers", grade="fire"),
        Shot("war-motion-a", svd("05-four-village-war"), 18.460, 20.039, "video", motion="fast_push", caption="FOUR RIVAL VILLAGES", particles="ash", flash=True, grade="storm"),
        Shot("clan-war-a", public / "landing-clanwar-v2.webp", 20.039, 21.618, motion="whip_rl", particles="ash", grade="storm"),
        Shot("fox-motion-a", svd("06-rill-lightning-fox"), 21.618, 23.382, "video", motion="whip_lr", particles="rain", flash=True, grade="storm"),
        Shot("oni-motion-a", svd("07-oni-confrontation"), 23.382, 24.961, "video", motion="fast_push", particles="embers", flash=True, grade="fire"),
        Shot("oni-full-frame", cinematic / "07-oni-confrontation.png", 24.961, 26.540, motion="fast_push", particles="embers", grade="fire"),
        Shot("tower-motion-a", svd("08-worldstorm-tower"), 26.540, 28.119, "video", motion="tilt_up", particles="rain", flash=True, grade="storm"),
        Shot("tower-rise", cinematic / "08-worldstorm-tower.png", 28.119, 29.698, motion="tilt_up", particles="rain", grade="storm"),
        Shot("four-village-sweep", cinematic / "05-four-village-war.png", 29.698, 31.277, motion="whip_lr", particles="ash"),
        Shot("hound-charge", public / "hollow-gate" / "hollow-hound-alpha-cinematic.webp", 31.277, 32.856, motion="fast_push", particles="ash", grade="cold"),
        Shot("finale-motion-a", svd("09-hollow-gate-finale"), 32.856, 34.435, "video", motion="whip_rl", particles="embers", flash=True, grade="fire"),
        Shot("finale-clash-a", cinematic / "09-hollow-gate-finale.png", 34.435, 36.014, motion="fast_push", particles="embers", grade="fire"),
        Shot("map-return", assets / "Maps" / "world_map-v2.webp", 36.014, 37.593, motion="whip_rl", particles="ash"),
        Shot("fight-for-clan", public / "landing-clanwar-v2.webp", 37.593, 39.195, motion="fast_push", caption="FIGHT FOR YOUR CLAN", particles="ash", flash=True),
        Shot("rise-overlook", cinematic / "01-rill-overlook.png", 39.195, 40.774, motion="pull", caption="RISE BEYOND LEGEND", particles="snow", grade="cold"),
        Shot("tower-motion-b", svd("08-worldstorm-tower"), 40.774, 42.376, "video", motion="tilt_up", particles="rain", reverse=True, grade="storm"),
        Shot("jutsu-motion-b", svd("04-inferno-jutsu"), 42.376, 43.955, "video", motion="fast_push", particles="embers", reverse=True, flash=True, grade="fire"),
        Shot("awakening-motion-b", svd("02-inferno-awakening"), 43.955, 45.534, "video", motion="fast_push", particles="embers", reverse=True, grade="fire"),
        Shot("fox-motion-b", svd("06-rill-lightning-fox"), 45.534, 46.626, "video", motion="whip_rl", particles="rain", reverse=True, flash=True, grade="storm"),
        Shot("war-motion-b", svd("05-four-village-war"), 46.626, 48.205, "video", motion="whip_lr", particles="ash", reverse=True, flash=True),
        Shot("oni-motion-b", svd("07-oni-confrontation"), 48.205, 49.784, "video", motion="fast_push", particles="embers", reverse=True, grade="fire"),
        Shot("finale-motion-b", svd("09-hollow-gate-finale"), 49.784, 51.734, "video", motion="fast_push", particles="embers", reverse=True, flash=True, grade="fire"),
        Shot("hero-keyart", public / "landing-hero-keyart.webp", 51.734, 53.313, motion="whip_rl", particles="snow", grade="cold"),
        Shot("hound-return", public / "hollow-gate" / "hollow-hound-alpha-cinematic.webp", 53.313, 54.892, motion="whip_lr", particles="ash", grade="cold"),
        Shot("storm-tower-return", cinematic / "08-worldstorm-tower.png", 54.892, 56.471, motion="fast_push", particles="rain", flash=True, grade="storm"),
        Shot("finale-breath", cinematic / "09-hollow-gate-finale.png", 56.471, 58.766, motion="pull", particles="embers", grade="fire"),
        Shot("one-journey", svd("01-rill-overlook"), 58.766, 59.881, "video", caption="ONE JOURNEY. NO LIMITS.", particles="snow", grade="cold"),
        Shot("rooftop-motion-c", motion / "svd-rooftop-test.mp4", 59.881, 61.460, "video", motion="whip_lr", particles="rain", reverse=True, flash=True, grade="storm"),
        Shot("awakening-motion-c", svd("02-inferno-awakening"), 61.460, 63.039, "video", motion="fast_push", particles="embers", flash=True, grade="fire"),
        Shot("jutsu-motion-c", svd("04-inferno-jutsu"), 63.039, 64.548, "video", motion="whip_rl", particles="embers", flash=True, grade="fire"),
        Shot("war-motion-c", svd("05-four-village-war"), 64.548, 66.127, "video", motion="fast_push", particles="ash", flash=True),
        Shot("fox-motion-c", svd("06-rill-lightning-fox"), 66.127, 67.706, "video", motion="whip_lr", particles="rain", flash=True, grade="storm"),
        Shot("oni-motion-c", svd("07-oni-confrontation"), 67.706, 68.867, "video", motion="fast_push", particles="embers", flash=True, grade="fire"),
        Shot("tower-motion-c", svd("08-worldstorm-tower"), 68.867, 70.446, "video", motion="tilt_up", particles="rain", flash=True, grade="storm"),
        Shot("finale-motion-c", svd("09-hollow-gate-finale"), 70.446, 72.025, "video", motion="fast_push", particles="embers", flash=True, grade="fire"),
        Shot("rapid-hero", public / "landing-hero-keyart.webp", 72.025, 72.815, motion="whip_lr", particles="snow"),
        Shot("rapid-map", assets / "Maps" / "world_map-v2.webp", 72.815, 73.604, motion="whip_rl", particles="ash"),
        Shot("rapid-clan", public / "landing-clanwar-v2.webp", 73.604, 74.393, motion="fast_push", particles="ash", flash=True),
        Shot("rapid-bloodline", public / "bloodline-inferno-cataclysm.webp", 74.393, 75.183, motion="fast_push", particles="embers", grade="fire"),
        Shot("rapid-fox", cinematic / "06-rill-lightning-fox.png", 75.183, 75.972, motion="whip_lr", particles="rain", grade="storm"),
        Shot("rapid-oni", cinematic / "07-oni-confrontation.png", 75.972, 76.762, motion="fast_push", particles="embers", flash=True, grade="fire"),
        Shot("rapid-hound", public / "hollow-gate" / "hollow-hound-alpha-cinematic.webp", 76.762, 77.552, motion="whip_rl", particles="ash"),
        Shot("rapid-tower", cinematic / "08-worldstorm-tower.png", 77.552, 78.643, motion="tilt_up", particles="rain", flash=True, grade="storm"),
        Shot("final-jutsu", svd("04-inferno-jutsu"), 78.643, 80.222, "video", motion="whip_lr", particles="embers", flash=True, grade="fire"),
        Shot("final-war", svd("05-four-village-war"), 80.222, 81.801, "video", motion="fast_push", particles="ash", reverse=True, flash=True),
        Shot("final-gate", svd("09-hollow-gate-finale"), 81.801, 83.380, "video", motion="fast_push", particles="embers", flash=True, grade="fire"),
        Shot("final-eye", svd("02-inferno-awakening"), 83.380, 84.889, "video", motion="fast_push", particles="embers", reverse=True, flash=True, grade="fire"),
        Shot("end-card", end_card, 84.889, 88.435, motion="push", particles="ash"),
    ]

    captions: dict[str, Path] = {}
    for shot in shots:
        if shot.caption and shot.caption not in captions:
            path = overlays_dir / f"caption-{len(captions):02d}.png"
            make_caption(path, shot.caption)
            captions[shot.caption] = path

    particle_plates = {
        kind: motion / f"particles-{kind}.mp4" for kind in ("embers", "snow", "rain", "ash")
    }
    clip_paths: list[Path] = []
    for index, shot in enumerate(shots):
        if not shot.source.exists():
            raise FileNotFoundError(shot.source)
        normalized: Path | None = None
        if shot.kind == "still":
            normalized = normalized_dir / f"{index:02d}-{shot.name}.jpg"
            if args.force or not normalized.exists():
                normalize_image(shot.source, normalized)
        clip = clips_dir / f"{index:02d}-{shot.name}.mp4"
        print(f"[{index + 1:02d}/{len(shots):02d}] {shot.name} ({shot.duration:.3f}s)", flush=True)
        if args.force or not clip.exists() or clip.stat().st_size < 80_000:
            render_shot(
                ffmpeg,
                shot,
                normalized,
                captions.get(shot.caption),
                particle_plates.get(shot.particles or ""),
                clip,
            )
        else:
            print(f"  reusing {clip.name}", flush=True)
        clip_paths.append(clip)

    concat_path = work / "concat-v2.txt"
    concat_path.write_text("".join(f"file '{path.as_posix()}'\n" for path in clip_paths), encoding="utf-8")
    silent_video = work / "silent-trailer-v2.mp4"
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_path), "-c", "copy", str(silent_video)])

    music_edit = root / "tmp" / "trailer" / "shinobi-journey-trailer-music-v2.wav"
    make_music_edit(ffmpeg, args.song.resolve(), music_edit)

    sfx_dir = public / "sfx" / "production"
    sfx_events = [
        (sfx_dir / "reveal.wav", 1.200, 0.24),
        (sfx_dir / "battle-transition.wav", 7.175, 0.20),
        (sfx_dir / "chakra-positive.wav", 10.333, 0.22),
        (sfx_dir / "impact-heavy.wav", 18.460, 0.22),
        (sfx_dir / "command.wav", 21.618, 0.16),
        (sfx_dir / "impact-heavy.wav", 23.382, 0.24),
        (sfx_dir / "omen.wav", 39.195, 0.18),
        (sfx_dir / "battle-transition.wav", 58.766, 0.22),
        (sfx_dir / "impact-heavy.wav", 64.548, 0.20),
        (sfx_dir / "knockout.wav", 68.867, 0.20),
        (sfx_dir / "impact-heavy.wav", 78.643, 0.24),
        (sfx_dir / "victory-seal.wav", 84.889, 0.25),
    ]

    final_path = output_dir / "shinobi-journey-cinematic-beta-trailer-v2-1080p.mp4"
    temp_path = work / "final-v2.tmp.mp4"
    command = [ffmpeg, "-y", "-i", str(silent_video), "-i", str(music_edit)]
    for path, _, _ in sfx_events:
        command += ["-i", str(path)]
    filters = ["[1:a]volume=1.0[music]"]
    mix_labels = ["[music]"]
    for index, (_, time_seconds, volume) in enumerate(sfx_events):
        label = f"sfx{index}"
        filters.append(f"[{index + 2}:a]adelay={round(time_seconds * 1000)}:all=1,volume={volume}[{label}]")
        mix_labels.append(f"[{label}]")
    filters.append(
        "".join(mix_labels)
        + f"amix=inputs={len(mix_labels)}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.96[aout]"
    )
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
        str(temp_path),
    ]
    run(command)
    os.replace(temp_path, final_path)
    print(f"Rendered {final_path}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise
