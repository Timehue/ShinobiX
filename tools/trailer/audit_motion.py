"""Rank trailer clips by measured frame-to-frame motion."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

import cv2
import numpy as np


def parse_manifest(path: Path) -> list[Path]:
    clips: list[Path] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"file '(.+)'", line.strip())
        if match:
            clips.append(Path(match.group(1)))
    return clips


def measure(path: Path) -> tuple[float, float, int]:
    capture = cv2.VideoCapture(str(path))
    previous: np.ndarray | None = None
    deltas: list[float] = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        gray = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2GRAY)
        if previous is not None:
            deltas.append(float(cv2.absdiff(previous, gray).mean()))
        previous = gray
    capture.release()
    if not deltas:
        return 0.0, 0.0, 0
    return float(np.mean(deltas)), float(np.percentile(deltas, 25)), len(deltas) + 1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    rows = []
    for index, clip in enumerate(parse_manifest(args.manifest)):
        mean, lower_quartile, frames = measure(clip)
        rows.append((mean, lower_quartile, index, frames, clip.name))
    for mean, lower_quartile, index, frames, name in sorted(rows):
        print(f"{index:03d} mean={mean:6.3f} p25={lower_quartile:6.3f} frames={frames:3d} {name}")


if __name__ == "__main__":
    main()
