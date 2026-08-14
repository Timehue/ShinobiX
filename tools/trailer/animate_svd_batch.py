"""Animate the cinematic key art as a batch with one SVD model load."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import torch
from diffusers import StableVideoDiffusionPipeline
from diffusers.utils import export_to_video
from PIL import Image, ImageOps


@dataclass(frozen=True)
class ClipSpec:
    filename: str
    motion: int
    noise: float
    seed: int


CLIPS = [
    ClipSpec("01-rill-overlook.png", 125, 0.018, 1001),
    ClipSpec("02-inferno-awakening.png", 165, 0.024, 2002),
    ClipSpec("04-inferno-jutsu.png", 205, 0.032, 4004),
    ClipSpec("05-four-village-war.png", 190, 0.028, 5005),
    ClipSpec("06-rill-lightning-fox.png", 180, 0.024, 6006),
    ClipSpec("07-oni-confrontation.png", 150, 0.020, 7007),
    ClipSpec("08-worldstorm-tower.png", 175, 0.024, 8008),
    ClipSpec("09-hollow-gate-finale.png", 210, 0.030, 9009),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--model", default="stabilityai/stable-video-diffusion-img2vid")
    parser.add_argument("--frames", type=int, default=14)
    parser.add_argument("--fps", type=int, default=7)
    parser.add_argument("--steps", type=int, default=14)
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=576)
    args = parser.parse_args()

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for this image-to-video pass")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading {args.model} once for {len(CLIPS)} clips", flush=True)
    pipe = StableVideoDiffusionPipeline.from_pretrained(
        args.model,
        torch_dtype=torch.float16,
        variant="fp16",
        low_cpu_mem_usage=True,
    )
    pipe.enable_model_cpu_offload()
    pipe.unet.enable_forward_chunking()

    for index, spec in enumerate(CLIPS, start=1):
        source = args.input_dir / spec.filename
        output = args.output_dir / f"svd-{source.stem}.mp4"
        if output.exists() and output.stat().st_size > 100_000:
            print(f"[{index}/{len(CLIPS)}] Reusing {output.name}", flush=True)
            continue
        if not source.exists():
            raise FileNotFoundError(source)
        with Image.open(source) as loaded:
            image = ImageOps.fit(
                loaded.convert("RGB"),
                (args.width, args.height),
                method=Image.Resampling.LANCZOS,
            )
        print(
            f"[{index}/{len(CLIPS)}] {source.name}: motion={spec.motion}, "
            f"noise={spec.noise}, seed={spec.seed}",
            flush=True,
        )
        frames = pipe(
            image,
            width=args.width,
            height=args.height,
            num_frames=args.frames,
            num_inference_steps=args.steps,
            motion_bucket_id=spec.motion,
            noise_aug_strength=spec.noise,
            decode_chunk_size=1,
            generator=torch.Generator(device="cpu").manual_seed(spec.seed),
        ).frames[0]
        export_to_video(frames, str(output), fps=args.fps)
        print(f"[{index}/{len(CLIPS)}] Wrote {output}", flush=True)


if __name__ == "__main__":
    main()
