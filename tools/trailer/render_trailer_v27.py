"""Render the canon-led Frostfang V27 landing-page cinematic."""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from render_trailer_v5 import FPS, HEIGHT, WIDTH, ffmpeg_path, run
from render_trailer_v25 import body_font, draw_tracked, title_font


BAR_HEIGHT = 58


@dataclass(frozen=True)
class Shot:
    name: str
    source: Path
    frames: int
    source_frames: int
    overlay: Path | None = None
    crop: str = "wide"
    flash: bool = False


def make_overlay(
    destination: Path,
    headline: str,
    kicker: str,
    *,
    centered: bool = False,
    shade_right: bool = False,
) -> None:
    image = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    lines = [line.strip().upper() for line in headline.split("\n") if line.strip()]
    longest = max(len(line) for line in lines)
    size = 58 if longest <= 28 else 49 if longest <= 38 else 43
    face = title_font(size)
    kicker_face = body_font(20)
    tracking = 3
    line_height = size + 17
    widths = [sum(draw.textlength(char, font=face) + tracking for char in line) for line in lines]
    block_width = int(max(widths))
    block_height = line_height * len(lines)
    if centered:
        left = max(120, (WIDTH - block_width) // 2 - 72)
        right = min(WIDTH - 120, (WIDTH + block_width) // 2 + 72)
        y = (HEIGHT - block_height) // 2 - 8
        x = WIDTH // 2
    else:
        left = 112
        right = min(WIDTH - 112, left + block_width + 144)
        y = 735 - block_height // 2
        x = left + 72 + block_width // 2
    top = y - 72
    bottom = y + block_height + 44
    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle((left, top, right, bottom), radius=18, fill=(2, 7, 15, 170))
    shadow = shadow.filter(ImageFilter.GaussianBlur(9))
    image = Image.alpha_composite(image, shadow)
    draw = ImageDraw.Draw(image)
    kicker_width = draw.textlength(kicker.upper(), font=kicker_face)
    kicker_x = x - kicker_width / 2
    draw.text((kicker_x, top + 25), kicker.upper(), font=kicker_face, fill=(139, 218, 244, 245))
    draw.line((x - min(300, block_width // 2), y - 22, x + min(300, block_width // 2), y - 22), fill=(157, 216, 239, 215), width=2)
    for index, line in enumerate(lines):
        draw_tracked(draw, (x, y + index * line_height), line, face, tracking, (248, 247, 241, 255))
    if shade_right:
        shade = Image.new("RGBA", image.size, (0, 0, 0, 0))
        shade_draw = ImageDraw.Draw(shade)
        start = WIDTH - 430
        for x_pos in range(start, WIDTH):
            alpha = round(225 * (x_pos - start) / max(1, WIDTH - start - 1))
            shade_draw.line((x_pos, 0, x_pos, HEIGHT), fill=(1, 5, 11, alpha))
        image = Image.alpha_composite(image, shade)
    image.save(destination)


def make_litany_card(destination: Path) -> None:
    image = Image.new("RGBA", (WIDTH, HEIGHT), (2, 7, 15, 255))
    glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((460, 110, 1460, 970), fill=(29, 139, 190, 84))
    glow = glow.filter(ImageFilter.GaussianBlur(180))
    image = Image.alpha_composite(image, glow)
    draw = ImageDraw.Draw(image)
    kicker = body_font(21)
    draw_tracked(draw, (WIDTH // 2, 280), "THE FROSTFANG LITANY", kicker, 8, (151, 218, 243, 245))
    words = ["CHECKED.", "COUNTED.", "KEPT.", "WARM."]
    face = title_font(57)
    widths = [sum(draw.textlength(c, font=face) + 4 for c in word) for word in words]
    gap = 70
    total = int(sum(widths) + gap * (len(words) - 1))
    cursor = (WIDTH - total) // 2
    for index, (word, width) in enumerate(zip(words, widths)):
        center = int(cursor + width / 2)
        color = (248, 247, 241, 255) if index < 3 else (255, 220, 148, 255)
        draw_tracked(draw, (center, 500), word, face, 4, color)
        cursor += int(width) + gap
    draw.line((460, 635, 1460, 635), fill=(119, 192, 221, 145), width=2)
    image.save(destination)


def make_end_card(destination: Path, logo_path: Path) -> None:
    image = Image.new("RGBA", (WIDTH, HEIGHT), (2, 7, 15, 255))
    glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((420, 10, 1500, 950), fill=(21, 130, 189, 92))
    gd.ellipse((690, 120, 1230, 780), fill=(232, 160, 70, 54))
    glow = glow.filter(ImageFilter.GaussianBlur(180))
    image = Image.alpha_composite(image, glow)
    draw = ImageDraw.Draw(image)
    logo = Image.open(logo_path).convert("RGBA")
    logo.thumbnail((1180, 390), Image.Resampling.LANCZOS)
    image.alpha_composite(logo, ((WIDTH - logo.width) // 2, 135))
    draw = ImageDraw.Draw(image)
    subtitle = title_font(48)
    draw_tracked(draw, (WIDTH // 2, 615), "THE OATH MUST BREAK", subtitle, 5, (250, 245, 229, 255))
    draw.line((645, 700, 1275, 700), fill=(142, 210, 236, 190), width=2)
    cta = title_font(34)
    draw_tracked(draw, (WIDTH // 2, 750), "PLAY FREE NOW", cta, 5, (255, 217, 145, 255))
    url = body_font(23)
    draw_tracked(draw, (WIDTH // 2, 820), "SHINOBIJOURNEY.COM", url, 7, (151, 218, 243, 255))
    legal = body_font(18)
    legal_text = "CINEMATIC TRAILER  |  NOT ACTUAL GAMEPLAY"
    legal_width = draw.textlength(legal_text, font=legal)
    draw.text(((WIDTH - legal_width) / 2, 942), legal_text, font=legal, fill=(178, 188, 199, 220))
    image.save(destination)


def crop_filter(crop: str) -> str:
    if crop == "extreme_left":
        return "scale=3072:1772:flags=lanczos,crop=1920:1080:x=0:y=346"
    if crop == "close_left":
        return "scale=2304:1329:flags=lanczos,crop=1920:1080:x=0:y=124"
    if crop == "close_right":
        return "scale=2304:1329:flags=lanczos,crop=1920:1080:x=384:y=124"
    if crop == "close_center":
        return "scale=2304:1329:flags=lanczos,crop=1920:1080:x=192:y=124"
    return "scale=2048:1182:flags=lanczos,crop=1920:1080:x='64+10*sin(n/56)':y=51"


def render_motion(ffmpeg: str, shot: Shot, destination: Path) -> None:
    factor = (shot.frames - 1) / max(1, shot.source_frames - 1)
    command = [ffmpeg, "-loglevel", "error", "-y", "-i", str(shot.source)]
    if shot.overlay:
        command += ["-loop", "1", "-framerate", str(FPS), "-i", str(shot.overlay)]
    base = (
        "[0:v]setpts=PTS-STARTPTS,"
        f"{crop_filter(shot.crop)},"
        f"setpts=(PTS-STARTPTS)*{factor:.8f},fps={FPS},"
        "tpad=stop_mode=clone:stop_duration=1,"
        f"trim=end_frame={shot.frames},setpts=N/({FPS}*TB),"
        "hqdn3d=0.30:0.24:0.90:0.72,"
        "eq=contrast=1.055:saturation=1.035:gamma=0.995:brightness=-0.004,"
        "curves=all='0/0 0.10/0.07 0.50/0.53 0.90/0.94 1/1',"
        "unsharp=5:5:0.26:5:5:0.0,vignette=PI/5"
    )
    if shot.flash:
        base += ",fade=t=in:st=0:d=0.06:color=white"
    filters = [base + "[base]"]
    current = "base"
    if shot.overlay:
        duration = shot.frames / FPS
        fade_out = max(0.0, duration - 0.20)
        filters.append(
            f"[1:v]format=rgba,fade=t=in:st=0.10:d=0.22:alpha=1,"
            f"fade=t=out:st={fade_out:.3f}:d=0.18:alpha=1[text]"
        )
        filters.append(f"[{current}][text]overlay=0:0:shortest=1[captioned]")
        current = "captioned"
    filters.append(
        f"[{current}]drawbox=x=0:y=0:w=iw:h={BAR_HEIGHT}:color=black:t=fill,"
        f"drawbox=x=0:y={HEIGHT - BAR_HEIGHT}:w=iw:h={BAR_HEIGHT}:color=black:t=fill,"
        "format=yuv420p[out]"
    )
    command += [
        "-filter_complex", ";".join(filters), "-map", "[out]", "-frames:v", str(shot.frames),
        "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p",
        "-r", str(FPS), str(destination),
    ]
    run(command, quiet=True)


def render_card(ffmpeg: str, still: Path, particles: Path, frames: int, destination: Path) -> None:
    duration = frames / FPS
    graph = (
        "[0:v]scale=2048:1152:flags=lanczos,"
        f"zoompan=z='1.0+0.010*on/{max(1, frames - 1)}':x='iw/2-(iw/zoom/2)':"
        f"y='ih/2-(ih/zoom/2)':d=1:s={WIDTH}x{HEIGHT}:fps={FPS},format=gbrp[card];"
        f"[1:v]scale={WIDTH}:{HEIGHT}:flags=lanczos,setpts=PTS-STARTPTS,format=gbrp[snow];"
        "[card][snow]blend=all_mode=screen:all_opacity=0.28:shortest=1,"
        "fade=t=in:st=0:d=0.10:color=black,"
        f"fade=t=out:st={max(0.0, duration - 0.16):.3f}:d=0.14:color=black,"
        f"drawbox=x=0:y=0:w=iw:h={BAR_HEIGHT}:color=black:t=fill,"
        f"drawbox=x=0:y={HEIGHT - BAR_HEIGHT}:w=iw:h={BAR_HEIGHT}:color=black:t=fill,"
        "format=yuv420p[out]"
    )
    run([
        ffmpeg, "-loglevel", "error", "-y", "-loop", "1", "-framerate", str(FPS), "-i", str(still),
        "-stream_loop", "-1", "-i", str(particles), "-filter_complex", graph, "-map", "[out]",
        "-frames:v", str(frames), "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "14",
        "-pix_fmt", "yuv420p", "-r", str(FPS), str(destination),
    ], quiet=True)


def assemble(ffmpeg: str, clips: list[Path], manifest: Path, destination: Path) -> None:
    manifest.write_text("".join(f"file '{clip.as_posix()}'\n" for clip in clips), encoding="utf-8")
    run([ffmpeg, "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(manifest), "-c", "copy", str(destination)])


def mix_audio(ffmpeg: str, silent: Path, root: Path, frames: int, destination: Path) -> None:
    duration = frames / FPS
    music = root / "shinobij.client" / "public" / "music" / "vn" / "frostfang-warmth-we-keep.ogg"
    sfx = root / "shinobij.client" / "public" / "sfx" / "production"
    events = [
        ("chapter-seal.wav", 0.00, 0.11),
        ("reveal.wav", 2.30, 0.10),
        ("command.wav", 3.50, 0.22),
        ("omen.wav", 6.70, 0.15),
        ("reveal.wav", 8.70, 0.14),
        ("chakra-negative.wav", 11.10, 0.13),
        ("foil-tear.wav", 15.30, 0.25),
        ("decision.wav", 18.20, 0.16),
        ("omen.wav", 22.70, 0.14),
        ("battle-transition.wav", 25.50, 0.18),
        ("impact-heavy.wav", 27.00, 0.20),
        ("card-place.wav", 29.20, 0.22),
        ("card-place.wav", 30.20, 0.22),
        ("card-place.wav", 31.20, 0.22),
        ("mythic.wav", 32.20, 0.18),
        ("victory-seal.wav", 34.60, 0.16),
    ]
    command = [ffmpeg, "-loglevel", "error", "-y", "-i", str(silent), "-i", str(music)]
    for filename, _, _ in events:
        command += ["-i", str(sfx / filename)]
    filters = [
        f"[1:a]atrim=start=0:end={duration:.3f},asetpts=PTS-STARTPTS,volume=0.82,"
        f"afade=t=in:st=0:d=0.18,afade=t=out:st={duration - 1.20:.3f}:d=1.15[music]"
    ]
    labels = ["[music]"]
    for index, (_, timestamp, volume) in enumerate(events):
        label = f"sfx{index}"
        filters.append(f"[{index + 2}:a]adelay={round(timestamp * 1000)}:all=1,volume={volume:.4f}[{label}]")
        labels.append(f"[{label}]")
    filters.append(
        "".join(labels)
        + f"amix=inputs={len(labels)}:duration=first:dropout_transition=0:normalize=0,"
        "loudnorm=I=-14.0:LRA=10.0:TP=-1.5,alimiter=limit=0.94,aresample=48000[aout]"
    )
    temporary = destination.with_name(destination.stem + ".tmp.mp4")
    command += [
        "-filter_complex", ";".join(filters), "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy",
        "-c:a", "aac", "-b:a", "320k", "-shortest", "-movflags", "+faststart", str(temporary),
    ]
    run(command)
    os.replace(temporary, destination)


def encode_web(ffmpeg: str, source: Path, destination: Path) -> None:
    run([
        ffmpeg, "-loglevel", "error", "-y", "-i", str(source), "-c:v", "libx264", "-preset", "slow",
        "-crf", "23", "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p", "-c:a", "aac",
        "-b:a", "192k", "-movflags", "+faststart", str(destination),
    ])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    ffmpeg = ffmpeg_path()
    work = root / "tmp" / "trailer" / "render-v27"
    clips_dir = work / "clips"
    overlays = work / "overlays"
    output = root / "output" / "trailer"
    motion = output / "framepack-v27"
    for directory in (work, clips_dir, overlays, output):
        directory.mkdir(parents=True, exist_ok=True)

    make_overlay(overlays / "plate.png", "THE PLATE KNEW RILL.\nAS SOMEONE LONG DEAD.", "FROSTFANG INTAKE")
    make_overlay(overlays / "rescue.png", "NO ONE IS LEFT BEHIND.", "THE COUNT'S PROMISE")
    make_overlay(overlays / "silence.png", "FROSTFANG SAVES EVERYONE.\nEVEN FROM THE PART THAT WANTED TO LEAVE.", "THE WHITE SILENCE")
    make_overlay(
        overlays / "yura.png",
        "IF THEY COME FOR ME NOW,\nTHEY CHOSE TO.",
        "CAPTAIN YURA",
        shade_right=True,
    )
    make_overlay(overlays / "zero.png", "THE METER REACHES ZERO TONIGHT.", "KAGE KAEL WHITEFANG")
    make_overlay(overlays / "kael.png", "SHOW ME WHAT HOLDS\nWHEN NOTHING IS HOLDING IT.", "KAEL", centered=True)
    make_overlay(overlays / "break.png", "BREAK EVERY MARK.", "YOUR CHOICE", centered=True)
    make_overlay(overlays / "bind.png", "BIND THE VAULT.", "YOUR CHOICE", centered=True)
    make_overlay(overlays / "take.png", "TAKE THE VALVE.", "YOUR CHOICE", centered=True)
    make_litany_card(work / "litany-card.png")
    make_end_card(work / "end-card.png", root / "shinobij.client" / "public" / "shinobi-journey-logo-wide.webp")

    specs = [
        Shot("plate", motion / "001-rill-plate-name-v27.mp4", 105, 37, overlays / "plate.png"),
        Shot("rescue", motion / "002-kael-carries-shepherd-v27.mp4", 96, 37, overlays / "rescue.png"),
        Shot("silence", motion / "003-white-silence-reveal-v27.mp4", 150, 37, overlays / "silence.png"),
        # Only the first 11 source frames are accepted. The later generated
        # motion lets Rill's hand intrude on Yura's decision and is rejected.
        Shot("yura", motion / "004-yura-breaks-mark-v27.mp4", 135, 11, overlays / "yura.png", "extreme_left"),
        Shot("faceoff", motion / "005-meter-zero-faceoff-v27.mp4", 138, 37, overlays / "zero.png"),
        Shot("kael-close", motion / "005-meter-zero-faceoff-v27.mp4", 66, 37, overlays / "kael.png", "close_right"),
        Shot("action", motion / "006-rill-keeps-flame-v27.mp4", 102, 73, None, "wide", True),
        Shot("choice-break", motion / "006-rill-keeps-flame-v27.mp4", 30, 73, overlays / "break.png", "close_left"),
        Shot("choice-bind", motion / "005-meter-zero-faceoff-v27.mp4", 30, 37, overlays / "bind.png", "close_center"),
        Shot("choice-take", motion / "005-meter-zero-faceoff-v27.mp4", 30, 37, overlays / "take.png", "close_left"),
    ]
    clips: list[Path] = []
    for index, spec in enumerate(specs):
        if not spec.source.exists():
            raise FileNotFoundError(spec.source)
        destination = clips_dir / f"{index:03d}-{spec.name}.mp4"
        if args.force or not destination.exists():
            print(f"shot={index + 1}/{len(specs) + 2} name={spec.name}", flush=True)
            render_motion(ffmpeg, spec, destination)
        clips.append(destination)
        if index == 1:
            litany = clips_dir / "002-litany.mp4"
            if args.force or not litany.exists():
                render_card(ffmpeg, work / "litany-card.png", root / "tmp" / "trailer" / "motion" / "particles-snow.mp4", 60, litany)
            clips.append(litany)

    end_clip = clips_dir / "011-end-card.mp4"
    if args.force or not end_clip.exists():
        render_card(ffmpeg, work / "end-card.png", root / "tmp" / "trailer" / "motion" / "particles-snow.mp4", 120, end_clip)
    clips.append(end_clip)
    total_frames = sum(spec.frames for spec in specs) + 60 + 120
    if total_frames != 1062:
        raise ValueError(f"Unexpected V27 timeline: {total_frames} frames")
    silent = work / "silent-v27.mp4"
    assemble(ffmpeg, clips, work / "concat-v27.txt", silent)
    master = output / "shinobi-journey-rill-frostfang-story-v27-1080p.mp4"
    mix_audio(ffmpeg, silent, root, total_frames, master)
    web = output / "shinobi-journey-rill-frostfang-story-v27-web.mp4"
    encode_web(ffmpeg, master, web)
    print(f"Rendered {master}")
    print(f"Rendered {web}")
    print(f"Frames {total_frames} Duration {total_frames / FPS:.3f}s")


if __name__ == "__main__":
    main()
