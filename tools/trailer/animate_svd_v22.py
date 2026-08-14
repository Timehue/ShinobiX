"""Animate the V22 two-sided Village versus Village elemental war."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import torch
from diffusers import StableVideoDiffusionPipeline
from diffusers.utils import export_to_video
from PIL import Image, ImageOps


STEM = "114-village-elemental-war-v22"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--steps", type=int, default=14)
    args = parser.parse_args()

    root = args.root.resolve()
    source = root / "tmp" / "trailer" / "cinematic-v22" / f"{STEM}.png"
    output_dir = root / "output" / "trailer" / "framepack-v22"
    destination = output_dir / f"{STEM}-svd.mp4"
    model = args.model.resolve(strict=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not source.exists():
        raise FileNotFoundError(source)
    if destination.exists() and destination.stat().st_size >= 100_000 and not args.force:
        print(f"Existing V22 motion pass: {destination}", flush=True)
        return

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("DIFFUSERS_OFFLINE", "1")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for the V22 motion pass")

    print("Loading the local SVD model for the V22 elemental war", flush=True)
    pipe = StableVideoDiffusionPipeline.from_pretrained(
        str(model),
        torch_dtype=torch.float16,
        variant="fp16",
        low_cpu_mem_usage=True,
    )
    pipe.enable_model_cpu_offload()
    pipe.unet.enable_forward_chunking()

    with Image.open(source) as loaded:
        image = ImageOps.fit(
            loaded.convert("RGB"),
            (1024, 576),
            method=Image.Resampling.LANCZOS,
        )

    frames = pipe(
        image,
        width=1024,
        height=576,
        num_frames=14,
        num_inference_steps=args.steps,
        motion_bucket_id=124,
        noise_aug_strength=0.009,
        decode_chunk_size=1,
        generator=torch.Generator(device="cpu").manual_seed(22114),
    ).frames[0]
    export_to_video(frames, str(destination), fps=7)
    print(f"Wrote {destination}", flush=True)


if __name__ == "__main__":
    main()
