"""Create anatomy-stable motion passes for the V20 earth-jutsu keyframes."""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from pathlib import Path

import torch
from diffusers import StableVideoDiffusionPipeline
from diffusers.utils import export_to_video
from PIL import Image, ImageOps


@dataclass(frozen=True)
class ClipSpec:
    stem: str
    seed: int
    motion: int
    noise: float


SPECS = (
    ClipSpec("107-earth-wall-eruption-v20", 20107, 116, 0.010),
    ClipSpec("108-earth-boulder-lift-v20", 20108, 112, 0.009),
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--steps", type=int, default=12)
    args = parser.parse_args()

    root = args.root.resolve()
    source_dir = root / "tmp" / "trailer" / "cinematic-v20"
    output_dir = root / "output" / "trailer" / "framepack-v20"
    model = args.model.resolve(strict=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("DIFFUSERS_OFFLINE", "1")

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for the V20 motion pass")

    pending = [
        spec
        for spec in SPECS
        if args.force
        or not (output_dir / f"{spec.stem}-svd.mp4").exists()
        or (output_dir / f"{spec.stem}-svd.mp4").stat().st_size < 100_000
    ]
    if not pending:
        print("All V20 SVD clips already exist.", flush=True)
        return

    print(f"Loading local SVD model once for {len(pending)} V20 clips", flush=True)
    pipe = StableVideoDiffusionPipeline.from_pretrained(
        str(model),
        torch_dtype=torch.float16,
        variant="fp16",
        low_cpu_mem_usage=True,
    )
    pipe.enable_model_cpu_offload()
    pipe.unet.enable_forward_chunking()

    for index, spec in enumerate(pending, start=1):
        source = source_dir / f"{spec.stem}.png"
        destination = output_dir / f"{spec.stem}-svd.mp4"
        if not source.exists():
            raise FileNotFoundError(source)

        with Image.open(source) as loaded:
            image = ImageOps.fit(
                loaded.convert("RGB"),
                (1024, 576),
                method=Image.Resampling.LANCZOS,
            )

        print(
            f"[{index}/{len(pending)}] {spec.stem}: "
            f"motion={spec.motion} noise={spec.noise:.3f} seed={spec.seed}",
            flush=True,
        )
        frames = pipe(
            image,
            width=1024,
            height=576,
            num_frames=14,
            num_inference_steps=args.steps,
            motion_bucket_id=spec.motion,
            noise_aug_strength=spec.noise,
            decode_chunk_size=1,
            generator=torch.Generator(device="cpu").manual_seed(spec.seed),
        ).frames[0]
        export_to_video(frames, str(destination), fps=7)
        print(f"[{index}/{len(pending)}] Wrote {destination}", flush=True)


if __name__ == "__main__":
    main()
