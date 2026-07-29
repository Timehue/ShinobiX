"""Measure generated VN music candidates without changing the source audio.

The report deliberately focuses on game-use risks: clipping, crowded high
frequencies, unstable loudness, and hard head/tail boundaries. It is not a
replacement for musical taste, but it prevents a pleasant generation from
becoming an unpleasant in-game mix.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
from pathlib import Path

import numpy as np


SAMPLE_RATE = 22_050
SUPPORTED_SUFFIXES = {".mp3", ".wav", ".ogg"}


def db(value: float) -> float:
    return 20 * math.log10(max(value, 1e-9))


def decode_mono(ffmpeg: Path, source: Path) -> np.ndarray:
    command = [
        str(ffmpeg),
        "-v",
        "error",
        "-i",
        str(source),
        "-f",
        "f32le",
        "-acodec",
        "pcm_f32le",
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-",
    ]
    result = subprocess.run(command, check=True, stdout=subprocess.PIPE)
    return np.frombuffer(result.stdout, dtype=np.float32)


def window_rms(samples: np.ndarray, seconds: float = 0.4) -> np.ndarray:
    width = max(1, int(SAMPLE_RATE * seconds))
    usable = samples[: len(samples) - len(samples) % width]
    if not len(usable):
        return np.array([0.0], dtype=np.float32)
    windows = usable.reshape(-1, width)
    return np.sqrt(np.mean(np.square(windows, dtype=np.float64), axis=1))


def spectral_summary(samples: np.ndarray) -> tuple[float, float]:
    segment_size = SAMPLE_RATE * 2
    hop = SAMPLE_RATE * 8
    centroids: list[float] = []
    high_ratios: list[float] = []
    window = np.hanning(segment_size)
    frequencies = np.fft.rfftfreq(segment_size, 1 / SAMPLE_RATE)
    for start in range(0, max(1, len(samples) - segment_size + 1), hop):
        segment = samples[start : start + segment_size]
        if len(segment) < segment_size:
            break
        spectrum = np.abs(np.fft.rfft(segment * window))
        total = float(np.sum(spectrum))
        if total <= 1e-9:
            continue
        centroids.append(float(np.sum(frequencies * spectrum) / total))
        high_ratios.append(float(np.sum(spectrum[frequencies >= 4_000]) / total))
    return (
        float(np.median(centroids)) if centroids else 0.0,
        float(np.median(high_ratios)) if high_ratios else 0.0,
    )


def analyze(ffmpeg: Path, source: Path) -> dict[str, float | str]:
    samples = decode_mono(ffmpeg, source)
    rms = float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))
    peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
    windows = window_rms(samples)
    active = windows[windows > 10 ** (-55 / 20)]
    if not len(active):
        active = windows
    p10, p95 = np.percentile(active, [10, 95])
    edge_width = min(len(samples), SAMPLE_RATE * 2)
    head_rms = float(np.sqrt(np.mean(np.square(samples[:edge_width], dtype=np.float64))))
    tail_rms = float(np.sqrt(np.mean(np.square(samples[-edge_width:], dtype=np.float64))))
    centroid, high_ratio = spectral_summary(samples)
    clipped = float(np.mean(np.abs(samples) >= 0.995)) if len(samples) else 0.0
    boundary_jump = float(abs(float(samples[-1]) - float(samples[0]))) if len(samples) >= 2 else 0.0
    boundary_slope_jump = (
        float(abs(float(samples[1] - samples[0]) - float(samples[-1] - samples[-2])))
        if len(samples) >= 4
        else 0.0
    )

    return {
        "file": source.name,
        "duration_seconds": round(len(samples) / SAMPLE_RATE, 2),
        "rms_dbfs": round(db(rms), 2),
        "peak_dbfs": round(db(peak), 2),
        "crest_db": round(db(peak) - db(rms), 2),
        "window_dynamic_range_db": round(db(float(p95)) - db(float(p10)), 2),
        "head_rms_dbfs": round(db(head_rms), 2),
        "tail_rms_dbfs": round(db(tail_rms), 2),
        "head_tail_delta_db": round(abs(db(head_rms) - db(tail_rms)), 2),
        "boundary_jump_dbfs": round(db(boundary_jump), 2),
        "boundary_slope_jump_dbfs": round(db(boundary_slope_jump), 2),
        "clipped_sample_percent": round(clipped * 100, 5),
        "spectral_centroid_hz": round(centroid, 1),
        "energy_above_4khz_percent": round(high_ratio * 100, 2),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate_dir", type=Path)
    parser.add_argument("--ffmpeg", required=True, type=Path)
    parser.add_argument("--json", dest="json_path", type=Path)
    args = parser.parse_args()

    sources = sorted(
        path
        for path in args.candidate_dir.iterdir()
        if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
    )
    results = [analyze(args.ffmpeg, source) for source in sources]
    if args.json_path:
        args.json_path.parent.mkdir(parents=True, exist_ok=True)
        args.json_path.write_text(json.dumps(results, indent=2), encoding="utf-8")

    columns = (
        "file",
        "duration_seconds",
        "rms_dbfs",
        "peak_dbfs",
        "crest_db",
        "window_dynamic_range_db",
        "head_tail_delta_db",
        "boundary_jump_dbfs",
        "boundary_slope_jump_dbfs",
        "clipped_sample_percent",
        "spectral_centroid_hz",
        "energy_above_4khz_percent",
    )
    print("\t".join(columns))
    for result in results:
        print("\t".join(str(result[column]) for column in columns))


if __name__ == "__main__":
    main()
