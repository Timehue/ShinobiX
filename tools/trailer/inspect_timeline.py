"""Print exact frame and time boundaries for a trailer concat manifest."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

import cv2


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    cursor = 0
    for line in args.manifest.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"file '(.+)'", line.strip())
        if not match:
            continue
        path = Path(match.group(1))
        capture = cv2.VideoCapture(str(path))
        frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        capture.release()
        index = int(path.name[:3])
        print(
            f"{index:03d} {cursor:04d}-{cursor + frames - 1:04d} "
            f"{cursor / 30:07.3f}-{(cursor + frames) / 30:07.3f} {path.name}"
        )
        cursor += frames
    print(f"total_frames={cursor} total_seconds={cursor / 30:.3f}")


if __name__ == "__main__":
    main()
