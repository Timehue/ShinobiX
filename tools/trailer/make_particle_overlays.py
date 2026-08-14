"""Create deterministic looping particle plates for the V2 trailer."""

from __future__ import annotations

import argparse
import math
import os
import random
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


WIDTH = 960
HEIGHT = 540
FPS = 30
DURATION = 4


@dataclass
class Particle:
    x: float
    y: float
    vx: float
    vy: float
    size: float
    phase: float
    brightness: int


def ffmpeg_path() -> str:
    explicit = os.environ.get("SHINOBI_FFMPEG")
    if explicit:
        return explicit
    discovered = shutil.which("ffmpeg")
    if discovered:
        return discovered
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def make_particles(kind: str, rng: random.Random) -> list[Particle]:
    counts = {"embers": 75, "snow": 105, "rain": 120, "ash": 80}
    particles: list[Particle] = []
    for _ in range(counts[kind]):
        if kind == "embers":
            vx, vy, size = rng.uniform(-0.35, 0.35), rng.uniform(-2.9, -0.9), rng.uniform(1.0, 3.2)
        elif kind == "snow":
            vx, vy, size = rng.uniform(-0.45, 0.45), rng.uniform(0.7, 2.3), rng.uniform(0.7, 2.8)
        elif kind == "rain":
            vx, vy, size = rng.uniform(-2.7, -1.4), rng.uniform(9.0, 15.0), rng.uniform(0.6, 1.4)
        else:
            vx, vy, size = rng.uniform(-0.6, 0.6), rng.uniform(-0.7, 1.1), rng.uniform(0.8, 2.4)
        particles.append(
            Particle(
                rng.uniform(0, WIDTH),
                rng.uniform(0, HEIGHT),
                vx,
                vy,
                size,
                rng.uniform(0, math.tau),
                rng.randint(130, 255),
            )
        )
    return particles


def draw_frame(kind: str, particles: list[Particle], frame_index: int) -> Image.Image:
    frame = Image.new("RGB", (WIDTH, HEIGHT), "black")
    draw = ImageDraw.Draw(frame)
    for particle in particles:
        drift = math.sin(frame_index * 0.075 + particle.phase) * (1.8 if kind != "rain" else 0.4)
        x = (particle.x + frame_index * particle.vx + drift) % WIDTH
        y = (particle.y + frame_index * particle.vy) % HEIGHT
        flicker = 0.70 + 0.30 * math.sin(frame_index * 0.19 + particle.phase)
        value = max(40, min(255, int(particle.brightness * flicker)))
        if kind == "embers":
            radius = particle.size
            draw.ellipse((x - radius, y - radius * 1.7, x + radius, y + radius * 1.7), fill=(value, int(value * 0.46), 8))
        elif kind == "snow":
            radius = particle.size
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(int(value * 0.78), int(value * 0.90), value))
        elif kind == "rain":
            length = 12 + particle.size * 10
            draw.line((x, y, x + particle.vx * 0.9, y + length), fill=(int(value * 0.48), int(value * 0.62), value), width=max(1, int(particle.size)))
        else:
            radius = particle.size
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(int(value * 0.72),) * 3)
    if kind in {"embers", "snow"}:
        frame = frame.filter(ImageFilter.GaussianBlur(0.45))
    return frame


def render(kind: str, destination: Path) -> None:
    rng = random.Random({"embers": 11, "snow": 22, "rain": 33, "ash": 44}[kind])
    particles = make_particles(kind, rng)
    command = [
        ffmpeg_path(),
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        f"{WIDTH}x{HEIGHT}",
        "-r",
        str(FPS),
        "-i",
        "-",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        str(destination),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    assert process.stdin is not None
    for frame_index in range(FPS * DURATION):
        process.stdin.write(draw_frame(kind, particles, frame_index).tobytes())
    process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError(f"Failed to render {kind} plate")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for kind in ("embers", "snow", "rain", "ash"):
        destination = args.output_dir / f"particles-{kind}.mp4"
        print(f"Rendering {destination}")
        render(kind, destination)


if __name__ == "__main__":
    main()
