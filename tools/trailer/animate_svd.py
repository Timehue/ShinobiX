"""Generate a short image-to-video proof clip with Stable Video Diffusion.

This is deliberately a small, low-memory wrapper for the local RTX 3080.
Model files are cached outside the repository by Hugging Face.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch
from diffusers import StableVideoDiffusionPipeline
from diffusers.utils import export_to_video
from PIL import Image, ImageOps


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", default="stabilityai/stable-video-diffusion-img2vid")
    parser.add_argument("--frames", type=int, default=14)
    parser.add_argument("--fps", type=int, default=7)
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=576)
    parser.add_argument("--steps", type=int, default=25)
    parser.add_argument("--motion", type=int, default=190)
    parser.add_argument("--noise", type=float, default=0.045)
    parser.add_argument("--seed", type=int, default=4711)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for this image-to-video pass")
    if not args.input.exists():
        raise FileNotFoundError(args.input)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(args.input) as loaded:
        image = ImageOps.fit(
            loaded.convert("RGB"),
            (args.width, args.height),
            method=Image.Resampling.LANCZOS,
        )

    print(f"Loading {args.model} with model CPU offload", flush=True)
    pipe = StableVideoDiffusionPipeline.from_pretrained(
        args.model,
        torch_dtype=torch.float16,
        variant="fp16",
        low_cpu_mem_usage=True,
    )
    pipe.enable_model_cpu_offload()
    pipe.unet.enable_forward_chunking()

    generator = torch.Generator(device="cpu").manual_seed(args.seed)
    print(
        f"Generating {args.frames} frames at {args.width}x{args.height}; "
        f"motion={args.motion}, steps={args.steps}",
        flush=True,
    )
    frames = pipe(
        image,
        width=args.width,
        height=args.height,
        num_frames=args.frames,
        num_inference_steps=args.steps,
        motion_bucket_id=args.motion,
        noise_aug_strength=args.noise,
        decode_chunk_size=1,
        generator=generator,
    ).frames[0]
    export_to_video(frames, str(args.output), fps=args.fps)
    print(f"Wrote {args.output}", flush=True)


if __name__ == "__main__":
    main()
