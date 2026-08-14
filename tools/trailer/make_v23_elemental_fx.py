"""Create a deterministic elemental battle-effects plate for trailer V23."""

from __future__ import annotations

import math
import random
import subprocess
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from render_trailer_v5 import ffmpeg_path


WIDTH = 960
HEIGHT = 540
FPS = 30
FRAMES = 60


@dataclass(frozen=True)
class Particle:
    x: float
    y: float
    vx: float
    vy: float
    size: float
    phase: float


def color(rgb: tuple[int, int, int], strength: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, round(channel * strength))) for channel in rgb)


def lightning(draw: ImageDraw.ImageDraw, frame: int, trigger: int, seed: int) -> None:
    age = frame - trigger
    if age < 0 or age > 4:
        return
    rng = random.Random(seed + age)
    strength = (1.0, 0.82, 0.60, 0.35, 0.18)[age]
    points = [(rng.randint(650, 930), -5)]
    x, y = points[0]
    while y < 280:
        x += rng.randint(-38, 18)
        y += rng.randint(26, 54)
        points.append((x, y))
    draw.line(points, fill=color((125, 185, 255), strength), width=max(1, 4 - age // 2))
    for branch_index in range(2, len(points) - 1, 2):
        bx, by = points[branch_index]
        branch = [(bx, by), (bx + rng.randint(25, 65), by + rng.randint(18, 48))]
        draw.line(branch, fill=color((145, 115, 255), strength * 0.72), width=2)


def draw_frame(
    frame_index: int,
    rain: list[Particle],
    embers: list[Particle],
    sparks: list[Particle],
    debris: list[Particle],
) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), "black")
    draw = ImageDraw.Draw(image)

    for drop in rain:
        x = (drop.x + frame_index * drop.vx) % WIDTH
        y = (drop.y + frame_index * drop.vy) % HEIGHT
        draw.line((x, y, x - 5, y + 18), fill=(30, 44, 68), width=1)

    for ember in embers:
        x = (ember.x + frame_index * ember.vx + math.sin(frame_index * 0.15 + ember.phase) * 2) % 510
        y = (ember.y + frame_index * ember.vy) % HEIGHT
        flicker = 0.45 + 0.55 * abs(math.sin(frame_index * 0.21 + ember.phase))
        radius = ember.size
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color((255, 104, 14), flicker))

    for spark in sparks:
        x = 480 + ((spark.x + frame_index * spark.vx) % 480)
        y = (spark.y + frame_index * spark.vy) % HEIGHT
        flicker = 0.40 + 0.60 * abs(math.sin(frame_index * 0.24 + spark.phase))
        draw.line((x, y, x + spark.vx * 3, y + spark.vy * 3), fill=color((88, 166, 255), flicker), width=2)

    for rock in debris:
        age = (frame_index + int(rock.phase * 10)) % FRAMES
        direction = -1 if rock.x < WIDTH / 2 else 1
        x = WIDTH / 2 + direction * (18 + age * abs(rock.vx))
        y = HEIGHT / 2 - age * abs(rock.vy) + 0.11 * age * age
        radius = rock.size
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(86, 55, 34))

    # Two expanding, split-color shockwaves make the central collision visibly advance.
    for start in (0, 30):
        age = frame_index - start
        if 0 <= age < 30:
            progress = age / 29
            radius = 25 + progress * 220
            strength = (1.0 - progress) ** 0.65
            box = (WIDTH / 2 - radius, HEIGHT / 2 - radius * 0.58, WIDTH / 2 + radius, HEIGHT / 2 + radius * 0.58)
            draw.arc(box, 90, 270, fill=color((255, 119, 22), strength), width=max(1, round(5 * strength)))
            draw.arc(box, 270, 450, fill=color((92, 178, 255), strength), width=max(1, round(5 * strength)))

    pulse = 0.38 + 0.62 * abs(math.sin(frame_index * 0.34))
    draw.ellipse((465, 252, 495, 282), fill=color((245, 232, 211), pulse))
    lightning(draw, frame_index, 5, 2305)
    lightning(draw, frame_index, 25, 2325)
    lightning(draw, frame_index, 43, 2343)
    return image.filter(ImageFilter.GaussianBlur(0.35))


def main() -> None:
    root = Path.cwd()
    output = root / "tmp" / "trailer" / "cinematic-v23" / "elemental-battle-fx-v23.mp4"
    output.parent.mkdir(parents=True, exist_ok=True)
    rng = random.Random(23023)
    rain = [Particle(rng.uniform(0, WIDTH), rng.uniform(0, HEIGHT), -2.0, 10.0, 1.0, rng.random()) for _ in range(170)]
    embers = [Particle(rng.uniform(0, 500), rng.uniform(0, HEIGHT), rng.uniform(-0.2, 0.5), rng.uniform(-2.8, -0.8), rng.uniform(0.7, 2.1), rng.uniform(0, math.tau)) for _ in range(90)]
    sparks = [Particle(rng.uniform(0, 480), rng.uniform(0, HEIGHT), rng.uniform(-1.8, 1.8), rng.uniform(-1.2, 1.2), 1.0, rng.uniform(0, math.tau)) for _ in range(70)]
    debris = [Particle(rng.choice((rng.uniform(0, 470), rng.uniform(490, WIDTH))), 0, rng.uniform(2.5, 7.0), rng.uniform(1.8, 5.0), rng.uniform(1.2, 3.8), rng.random()) for _ in range(34)]

    command = [
        ffmpeg_path(), "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264",
        "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p", str(output),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    assert process.stdin is not None
    for frame_index in range(FRAMES):
        process.stdin.write(draw_frame(frame_index, rain, embers, sparks, debris).tobytes())
    process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError("Failed to render the V23 elemental FX plate")
    print(f"Wrote {output}", flush=True)


if __name__ == "__main__":
    main()
