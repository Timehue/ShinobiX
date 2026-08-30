"""Build stable 2.5D anime scene clips from the trailer key art.

Unlike diffusion video, this renderer never redraws a character between
frames.  It uses monocular depth for restrained parallax and deterministic
anime effects, keeping faces, hands, weapons, and costumes locked.
"""

from __future__ import annotations

import argparse
import math
import os
import random
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image, ImageOps
from transformers import DPTForDepthEstimation, DPTImageProcessor


WIDTH = 1920
HEIGHT = 1080
FPS = 30


@dataclass(frozen=True)
class SceneSpec:
    name: str
    source: str
    duration: float
    camera: str
    effect: str
    particles: str
    seed: int


SCENES = [
    SceneSpec("rill-overlook", "cinematic/01-rill-overlook.png", 5.0, "drift", "cold", "snow", 101),
    SceneSpec("inferno-awakening", "cinematic/02-inferno-awakening.png", 4.0, "push", "fire", "embers", 202),
    SceneSpec("rooftop-pursuit", "cinematic/03-rooftop-pursuit.png", 4.0, "track", "storm", "rain", 303),
    SceneSpec("inferno-jutsu", "cinematic/04-inferno-jutsu.png", 4.0, "arc", "fire", "embers", 404),
    SceneSpec("four-village-war", "cinematic/05-four-village-war.png", 5.0, "push", "mixed", "ash", 505),
    SceneSpec("rill-lightning-fox", "cinematic/06-rill-lightning-fox.png", 4.0, "track", "lightning", "ash", 606),
    SceneSpec("oni-confrontation", "cinematic/07-oni-confrontation.png", 4.0, "push", "fire", "embers", 707),
    SceneSpec("worldstorm-tower", "cinematic/08-worldstorm-tower.png", 5.0, "rise", "storm", "rain", 808),
    SceneSpec("hollow-gate-finale", "cinematic/09-hollow-gate-finale.png", 4.0, "arc", "magic", "embers", 909),
    SceneSpec("four-clan-charge", "cinematic/10-four-clan-charge-v3.png", 5.0, "charge", "mixed", "ash", 1010),
    SceneSpec("landing-hero", "public/landing-hero-keyart.webp", 4.0, "drift", "cold", "snow", 1111),
    SceneSpec("world-map", "assets/Maps/world_map-v2.webp", 4.0, "map", "neutral", "ash", 1212),
    SceneSpec("inferno-world", "public/bloodline-inferno-cataclysm.webp", 4.0, "push", "fire", "embers", 1313),
    SceneSpec("companion-bond", "assets/pet-home/home-hero.webp", 4.0, "drift", "warm", "ash", 1414),
    SceneSpec("hollow-hound", "public/hollow-gate/hollow-hound-alpha-cinematic.webp", 4.0, "charge", "magic", "ash", 1515),
]


def ffmpeg_path() -> str:
    explicit = os.environ.get("SHINOBI_FFMPEG")
    if explicit:
        return explicit
    discovered = shutil.which("ffmpeg")
    if discovered:
        return discovered
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def load_fitted(path: Path) -> np.ndarray:
    with Image.open(path) as loaded:
        fitted = ImageOps.fit(loaded.convert("RGB"), (WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    return cv2.cvtColor(np.asarray(fitted), cv2.COLOR_RGB2BGR)


class DepthEstimator:
    def __init__(self) -> None:
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.processor = DPTImageProcessor.from_pretrained("Intel/dpt-hybrid-midas")
        self.model = DPTForDepthEstimation.from_pretrained(
            "Intel/dpt-hybrid-midas",
            low_cpu_mem_usage=True,
        ).to(self.device)
        self.model.eval()

    def estimate(self, bgr: np.ndarray) -> np.ndarray:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        inputs = self.processor(images=Image.fromarray(rgb), return_tensors="pt")
        inputs = {name: tensor.to(self.device) for name, tensor in inputs.items()}
        with torch.inference_mode():
            predicted = self.model(**inputs).predicted_depth
        resized = torch.nn.functional.interpolate(
            predicted.unsqueeze(1),
            size=(HEIGHT, WIDTH),
            mode="bicubic",
            align_corners=False,
        ).squeeze()
        depth = resized.float().cpu().numpy()
        low, high = np.percentile(depth, (2.0, 98.0))
        depth = np.clip((depth - low) / max(1e-6, high - low), 0.0, 1.0)
        depth = cv2.bilateralFilter(depth.astype(np.float32), 9, 0.10, 13)
        return depth


def load_or_make_depth(estimator: DepthEstimator, image: np.ndarray, path: Path) -> np.ndarray:
    if path.exists():
        loaded = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        if loaded is not None:
            return loaded.astype(np.float32) / 255.0
    depth = estimator.estimate(image)
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), np.round(depth * 255.0).astype(np.uint8))
    return depth


def particle_seed(kind: str, rng: random.Random) -> list[tuple[float, float, float, float, float, float]]:
    counts = {"snow": 95, "rain": 100, "embers": 70, "ash": 65}
    particles = []
    for _ in range(counts.get(kind, 0)):
        x, y = rng.uniform(0, WIDTH), rng.uniform(0, HEIGHT)
        if kind == "snow":
            vx, vy, size = rng.uniform(-0.25, 0.25), rng.uniform(0.45, 1.5), rng.uniform(0.8, 2.4)
        elif kind == "rain":
            vx, vy, size = rng.uniform(-2.2, -1.1), rng.uniform(7.0, 12.0), rng.uniform(0.6, 1.3)
        elif kind == "embers":
            vx, vy, size = rng.uniform(-0.4, 0.4), rng.uniform(-2.2, -0.7), rng.uniform(0.8, 2.6)
        else:
            vx, vy, size = rng.uniform(-0.45, 0.45), rng.uniform(-0.4, 0.8), rng.uniform(0.7, 2.0)
        particles.append((x, y, vx, vy, size, rng.uniform(0, math.tau)))
    return particles


def add_particles(
    frame: np.ndarray,
    particles: list[tuple[float, float, float, float, float, float]],
    kind: str,
    frame_index: int,
) -> np.ndarray:
    if not particles:
        return frame
    layer = np.zeros_like(frame)
    for x0, y0, vx, vy, size, phase in particles:
        drift = math.sin(frame_index * 0.055 + phase) * (2.0 if kind != "rain" else 0.3)
        x = int((x0 + vx * frame_index + drift) % WIDTH)
        y = int((y0 + vy * frame_index) % HEIGHT)
        if kind == "rain":
            cv2.line(layer, (x, y), (x - 5, y + int(13 + size * 7)), (190, 160, 115), max(1, int(size)), cv2.LINE_AA)
        elif kind == "embers":
            value = int(155 + 90 * (0.5 + 0.5 * math.sin(frame_index * 0.14 + phase)))
            cv2.circle(layer, (x, y), max(1, int(size)), (5, int(value * 0.46), value), -1, cv2.LINE_AA)
        elif kind == "snow":
            value = int(145 + 95 * (0.5 + 0.5 * math.sin(frame_index * 0.08 + phase)))
            cv2.circle(layer, (x, y), max(1, int(size)), (value, value, value), -1, cv2.LINE_AA)
        else:
            value = int(90 + 75 * (0.5 + 0.5 * math.sin(frame_index * 0.08 + phase)))
            cv2.circle(layer, (x, y), max(1, int(size)), (value, value, value), -1, cv2.LINE_AA)
    if kind in {"snow", "embers"}:
        layer = cv2.GaussianBlur(layer, (0, 0), 0.55)
    return cv2.addWeighted(frame, 1.0, layer, 0.58 if kind == "embers" else 0.42, 0)


def camera_values(camera: str, progress: float) -> tuple[float, float, float, float, float]:
    eased = smoothstep(progress)
    centered = eased - 0.5
    if camera == "push":
        return 1.00 + 0.075 * eased, 0.0, -4.0 * eased, 18.0 * centered, 5.0 * centered
    if camera == "track":
        return 1.035 + 0.035 * eased, 24.0 * centered, -5.0 * eased, 28.0 * centered, 5.0 * centered
    if camera == "arc":
        return 1.02 + 0.05 * eased, 14.0 * math.sin(progress * math.pi), -6.0 * eased, 23.0 * centered, 9.0 * math.sin(progress * math.pi)
    if camera == "rise":
        return 1.035 + 0.035 * eased, 0.0, 18.0 * centered, 10.0 * centered, 26.0 * centered
    if camera == "charge":
        return 1.00 + 0.105 * eased, 7.0 * centered, -7.0 * eased, 24.0 * centered, 8.0 * centered
    if camera == "map":
        return 1.02 + 0.025 * eased, 20.0 * centered, 9.0 * math.sin(progress * math.pi), 12.0 * centered, 8.0 * centered
    return 1.02 + 0.025 * eased, 18.0 * centered, -4.0 * eased, 16.0 * centered, 4.0 * centered


def effect_mask(frame: np.ndarray, effect: str) -> tuple[np.ndarray, tuple[int, int, int]]:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    hue, saturation, value = cv2.split(hsv)
    if effect == "fire":
        mask = (((hue < 28) | (hue > 172)) & (saturation > 105) & (value > 105)).astype(np.float32)
        color = (12, 78, 255)
    elif effect == "lightning":
        mask = (((hue < 38) | ((hue > 125) & (hue < 170))) & (saturation > 65) & (value > 135)).astype(np.float32)
        color = (28, 208, 255)
    elif effect == "magic":
        mask = (((hue > 128) & (hue < 174)) & (saturation > 85) & (value > 105)).astype(np.float32)
        color = (255, 48, 196)
    elif effect == "storm":
        mask = (((hue > 85) & (hue < 145)) & (saturation > 45) & (value > 135)).astype(np.float32)
        color = (255, 188, 120)
    elif effect == "mixed":
        mask = ((saturation > 95) & (value > 140)).astype(np.float32)
        color = (120, 155, 255)
    elif effect == "warm":
        mask = ((hue < 38) & (saturation > 55) & (value > 150)).astype(np.float32)
        color = (40, 145, 255)
    else:
        return np.zeros((HEIGHT, WIDTH), dtype=np.float32), (0, 0, 0)
    mask = cv2.GaussianBlur(mask, (0, 0), 8.0)
    return np.clip(mask, 0.0, 1.0), color


def add_energy(frame: np.ndarray, effect: str, time_seconds: float) -> np.ndarray:
    mask, color = effect_mask(frame, effect)
    if not np.any(mask):
        return frame
    pulse = 0.52 + 0.30 * math.sin(time_seconds * (8.5 if effect in {"fire", "magic"} else 5.5))
    glow = cv2.GaussianBlur(mask, (0, 0), 16.0) * pulse
    color_array = np.array(color, dtype=np.float32)[None, None, :]
    result = frame.astype(np.float32) + glow[:, :, None] * color_array * 0.28
    return np.clip(result, 0, 255).astype(np.uint8)


def add_speed_lines(frame: np.ndarray, progress: float, camera: str) -> np.ndarray:
    if camera not in {"charge", "track"} or progress < 0.66:
        return frame
    amount = smoothstep((progress - 0.66) / 0.34)
    layer = np.zeros_like(frame)
    rng = random.Random(991)
    center = (int(WIDTH * 0.50), int(HEIGHT * 0.48))
    for _ in range(42):
        angle = rng.uniform(0, math.tau)
        inner = rng.uniform(310, 640)
        length = rng.uniform(90, 320) * amount
        p1 = (int(center[0] + math.cos(angle) * inner), int(center[1] + math.sin(angle) * inner))
        p2 = (int(center[0] + math.cos(angle) * (inner + length)), int(center[1] + math.sin(angle) * (inner + length)))
        cv2.line(layer, p1, p2, (220, 226, 238), rng.choice((1, 1, 2)), cv2.LINE_AA)
    return cv2.addWeighted(frame, 1.0, layer, 0.28 * amount, 0)


def render_scene(
    spec: SceneSpec,
    source: Path,
    depth: np.ndarray,
    destination: Path,
) -> None:
    base = load_fitted(source)
    grid_x, grid_y = np.meshgrid(np.arange(WIDTH, dtype=np.float32), np.arange(HEIGHT, dtype=np.float32))
    relative_depth = (depth - 0.5) * 2.0
    frame_count = round(spec.duration * FPS)
    particles = particle_seed(spec.particles, random.Random(spec.seed))
    command = [
        ffmpeg_path(),
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "bgr24",
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
        "17",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(destination),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    assert process.stdin is not None
    for frame_index in range(frame_count):
        progress = frame_index / max(1, frame_count - 1)
        scale, pan_x, pan_y, parallax_x, parallax_y = camera_values(spec.camera, progress)
        map_x = grid_x - relative_depth * parallax_x
        map_y = grid_y - relative_depth * parallax_y
        frame = cv2.remap(base, map_x, map_y, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT_101)
        matrix = cv2.getRotationMatrix2D((WIDTH / 2, HEIGHT / 2), 0.0, scale)
        matrix[0, 2] += pan_x
        matrix[1, 2] += pan_y
        frame = cv2.warpAffine(frame, matrix, (WIDTH, HEIGHT), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT_101)
        frame = add_energy(frame, spec.effect, frame_index / FPS)
        frame = add_particles(frame, particles, spec.particles, frame_index)
        frame = add_speed_lines(frame, progress, spec.camera)
        if spec.effect == "storm":
            flash_phase = frame_index % 73
            if flash_phase in {0, 1}:
                frame = cv2.convertScaleAbs(frame, alpha=1.0, beta=22 if flash_phase == 0 else 10)
        process.stdin.write(frame.tobytes())
    process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError(f"Scene render failed: {spec.name}")


def resolve_source(root: Path, relative: str) -> Path:
    if relative.startswith("cinematic/"):
        return root / "tmp" / "trailer" / relative
    if relative.startswith("public/"):
        return root / "shinobij.client" / relative
    if relative.startswith("assets/"):
        return root / "shinobij.client" / "src" / relative
    raise ValueError(relative)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--only")
    args = parser.parse_args()
    root = args.root.resolve()
    output_dir = root / "tmp" / "trailer" / "anime-scenes-v3"
    depth_dir = output_dir / "depth"
    output_dir.mkdir(parents=True, exist_ok=True)
    selected = [spec for spec in SCENES if not args.only or spec.name == args.only]
    if not selected:
        raise ValueError(f"Unknown scene: {args.only}")
    estimator: DepthEstimator | None = None
    for index, spec in enumerate(selected, start=1):
        source = resolve_source(root, spec.source)
        destination = output_dir / f"{spec.name}.mp4"
        depth_path = depth_dir / f"{spec.name}.png"
        print(f"[{index}/{len(selected)}] {spec.name}", flush=True)
        if destination.exists() and destination.stat().st_size > 200_000 and not args.force:
            print(f"  reusing {destination.name}", flush=True)
            continue
        if not source.exists():
            raise FileNotFoundError(source)
        image = load_fitted(source)
        if not depth_path.exists():
            if estimator is None:
                print("  loading DPT depth estimator", flush=True)
                estimator = DepthEstimator()
            depth = load_or_make_depth(estimator, image, depth_path)
        else:
            depth = load_or_make_depth(estimator, image, depth_path)  # type: ignore[arg-type]
        print("  rendering stable 2.5D scene", flush=True)
        render_scene(spec, source, depth, destination)
        print(f"  wrote {destination}", flush=True)


if __name__ == "__main__":
    main()
