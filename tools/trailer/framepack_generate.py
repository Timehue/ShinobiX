"""Submit a local FramePack image-to-video render and save the final MP4."""

from __future__ import annotations

import argparse
import shutil
import time
from pathlib import Path
from typing import Any

from gradio_client import Client, handle_file


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--negative-prompt", default="")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--server", default="http://127.0.0.1:7861")
    parser.add_argument("--seconds", type=float, default=2.4)
    parser.add_argument("--seed", type=int, default=31337)
    parser.add_argument("--steps", type=int, default=25)
    parser.add_argument("--cfg", type=float, default=1.0)
    parser.add_argument("--teacache", action="store_true")
    parser.add_argument(
        "--server-outputs",
        type=Path,
        default=Path(r"C:\Users\Tyler R\.cache\FramePack\outputs"),
    )
    return parser.parse_args()


def find_video_path(value: Any) -> Path | None:
    if isinstance(value, (str, Path)):
        candidate = Path(value)
        if candidate.suffix.lower() == ".mp4" and candidate.exists():
            return candidate
    if isinstance(value, dict):
        for nested in value.values():
            candidate = find_video_path(nested)
            if candidate is not None:
                return candidate
    if isinstance(value, (list, tuple)):
        for nested in value:
            candidate = find_video_path(nested)
            if candidate is not None:
                return candidate
    return None


def main() -> None:
    args = parse_args()
    image_path = args.image.resolve(strict=True)
    output_path = args.output.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    server_outputs = args.server_outputs.resolve(strict=True)
    started_wall_time = time.time()

    client = Client(args.server)
    job = client.submit(
        handle_file(str(image_path)),
        args.prompt,
        args.negative_prompt,
        args.seed,
        args.seconds,
        9,
        args.steps,
        args.cfg,
        10.0,
        0.0,
        6.0,
        args.teacache,
        16,
        api_name="/process",
    )

    started = time.monotonic()
    while not job.done():
        status = job.status()
        elapsed = time.monotonic() - started
        print(f"elapsed={elapsed:.0f}s status={status.code}", flush=True)
        time.sleep(20)

    result = job.result()
    print(f"result={result!r}", flush=True)
    rendered_path = find_video_path(result)
    if rendered_path is None:
        candidates = [
            path
            for path in server_outputs.glob("*.mp4")
            if path.stat().st_mtime >= started_wall_time
        ]
        if not candidates:
            raise RuntimeError("FramePack completed without returning or saving an MP4")
        rendered_path = max(candidates, key=lambda path: path.stat().st_mtime)
    rendered_path = rendered_path.resolve(strict=True)
    shutil.copy2(rendered_path, output_path)
    print(f"saved={output_path}", flush=True)


if __name__ == "__main__":
    main()
