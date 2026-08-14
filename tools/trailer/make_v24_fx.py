"""Create stable deterministic effects plates for the V24 raid and Hollow Stag shots."""

from __future__ import annotations

import math
import random
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from render_trailer_v5 import ffmpeg_path


WIDTH = 960
HEIGHT = 540
FPS = 30


def encode(frames: list[Image.Image], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg_path(), "-loglevel", "error", "-y", "-f", "rawvideo",
        "-pix_fmt", "rgb24", "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS),
        "-i", "-", "-an", "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "16", "-pix_fmt", "yuv420p", str(destination),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    assert process.stdin is not None
    for frame in frames:
        process.stdin.write(frame.convert("RGB").tobytes())
    process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError(f"Failed to encode {destination}")


def branch(draw: ImageDraw.ImageDraw, start: tuple[int, int], end: tuple[int, int], seed: int, strength: float) -> None:
    rng = random.Random(seed)
    points = [start]
    segments = 8
    for index in range(1, segments):
        progress = index / segments
        x = start[0] + (end[0] - start[0]) * progress + rng.randint(-12, 12)
        y = start[1] + (end[1] - start[1]) * progress + rng.randint(-10, 10)
        points.append((round(x), round(y)))
    points.append(end)
    color = (126, 92, 255, max(0, min(255, round(220 * strength))))
    draw.line(points, fill=color, width=max(1, round(4 * strength)))


def oni_frames() -> list[Image.Image]:
    rng = random.Random(24051)
    embers = [(rng.uniform(0, WIDTH), rng.uniform(0, HEIGHT), rng.uniform(-0.35, 0.35), rng.uniform(-2.4, -0.7), rng.uniform(0.8, 2.1), rng.random() * math.tau) for _ in range(115)]
    ice = [(rng.uniform(0, 330), rng.uniform(250, 520), rng.uniform(-1.1, 0.4), rng.uniform(-1.7, -0.3), rng.uniform(0.7, 2.0), rng.random() * math.tau) for _ in range(55)]
    debris = [(rng.uniform(180, 780), rng.uniform(265, 510), rng.uniform(-1.4, 1.4), rng.uniform(-2.8, -0.7), rng.uniform(1.0, 3.2)) for _ in range(38)]
    frames: list[Image.Image] = []
    for frame_index in range(57):
        layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 255))
        draw = ImageDraw.Draw(layer, "RGBA")
        for x, y, vx, vy, size, phase in embers:
            px = (x + vx * frame_index + math.sin(frame_index * 0.18 + phase) * 3) % WIDTH
            py = (y + vy * frame_index) % HEIGHT
            alpha = round(95 + 105 * abs(math.sin(frame_index * 0.19 + phase)))
            draw.ellipse((px - size, py - size, px + size, py + size), fill=(255, 92, 16, alpha))
        for x, y, vx, vy, size, phase in ice:
            px = (x + vx * frame_index) % 350
            py = 210 + ((y - 210 + vy * frame_index) % 330)
            alpha = round(70 + 125 * abs(math.sin(frame_index * 0.23 + phase)))
            draw.line((px, py, px + 5, py - 13), fill=(95, 191, 255, alpha), width=max(1, round(size)))
        for x, y, vx, vy, size in debris:
            age = frame_index % 28
            px = x + vx * age
            py = y + vy * age + 0.09 * age * age
            draw.ellipse((px - size, py - size, px + size, py + size), fill=(104, 54, 31, 145))

        pulse = 0.55 + 0.45 * abs(math.sin(frame_index * 0.24))
        draw.ellipse((474, 222, 488, 236), fill=(255, 108, 24, round(105 * pulse)))
        if frame_index in range(7, 12) or frame_index in range(34, 39):
            age = frame_index - (7 if frame_index < 20 else 34)
            strength = (1.0, 0.84, 0.64, 0.42, 0.22)[age]
            branch(draw, (930, 438), (650, 335), 24000 + frame_index, strength)
            branch(draw, (845, 485), (604, 326), 24100 + frame_index, strength * 0.75)
        frames.append(layer.filter(ImageFilter.GaussianBlur(0.42)))
    return frames


def stag_frames() -> list[Image.Image]:
    rng = random.Random(24054)
    motes = [(rng.uniform(0, WIDTH), rng.uniform(80, 500), rng.uniform(-0.35, 0.35), rng.uniform(-0.9, -0.18), rng.uniform(0.7, 2.2), rng.random() * math.tau) for _ in range(105)]
    frames: list[Image.Image] = []
    for frame_index in range(60):
        layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 255))
        draw = ImageDraw.Draw(layer, "RGBA")
        for x, y, vx, vy, size, phase in motes:
            px = (x + vx * frame_index + math.sin(frame_index * 0.12 + phase) * 2) % WIDTH
            py = 55 + ((y - 55 + vy * frame_index) % 455)
            alpha = round(40 + 95 * abs(math.sin(frame_index * 0.14 + phase)))
            draw.ellipse((px - size, py - size, px + size, py + size), fill=(151, 91, 255, alpha))

        # Thin translucent ground mist bands; never obscure the stag's torso or head.
        for band in range(4):
            phase = frame_index * 0.045 + band * 1.4
            y = 445 + band * 18
            points = []
            for x in range(-60, WIDTH + 61, 30):
                points.append((x + (frame_index * (1.2 + band * 0.15)) % 60, y + math.sin(x * 0.018 + phase) * (8 + band * 2)))
            draw.line(points, fill=(113, 79, 174, 24 + band * 5), width=7 + band * 2)

        pulse = 0.35 + 0.65 * abs(math.sin(frame_index * 0.13))
        # Restrained crystal glints: irregular short accents, never a circular UI-like shape.
        for x, y, dx, dy in ((420, 91, -7, -10), (476, 72, 4, -12), (553, 98, 8, -9), (615, 174, 10, 3), (680, 268, 8, 7)):
            draw.line((x, y, x + dx, y + dy), fill=(157, 103, 255, round(92 * pulse)), width=2)
        draw.ellipse((481, 190, 493, 202), fill=(199, 164, 255, round(135 * pulse)))
        frames.append(layer.filter(ImageFilter.GaussianBlur(0.65)))
    return frames


def main() -> None:
    output = Path.cwd() / "tmp" / "trailer" / "cinematic-v24"
    encode(oni_frames(), output / "oni-raid-fx-v24.mp4")
    encode(stag_frames(), output / "hollow-stag-fx-v24.mp4")
    print(f"Wrote V24 FX plates in {output}")


if __name__ == "__main__":
    main()
