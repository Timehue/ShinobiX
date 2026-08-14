"""Analyze a music track for trailer editing landmarks.

Produces a compact JSON report and a waveform/energy overview image. This is
intended for editorial timing, not musicological analysis.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import librosa
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def spaced_peaks(values: np.ndarray, times: np.ndarray, count: int, spacing: float) -> list[int]:
    ranked = np.argsort(values)[::-1]
    picked: list[int] = []
    for index in ranked:
        if all(abs(float(times[index] - times[other])) >= spacing for other in picked):
            picked.append(int(index))
            if len(picked) == count:
                break
    return sorted(picked, key=lambda index: float(times[index]))


def format_time(seconds: float) -> str:
    minutes = int(seconds // 60)
    remainder = seconds - minutes * 60
    return f"{minutes}:{remainder:05.2f}"


def draw_report(
    output_path: Path,
    waveform: np.ndarray,
    sample_rate: int,
    rms: np.ndarray,
    rms_times: np.ndarray,
    beats: np.ndarray,
    peaks: list[int],
    boundaries: np.ndarray,
    duration: float,
    tempo: float,
) -> None:
    width, height = 1800, 900
    margin_x, top, bottom = 90, 120, 100
    chart_width = width - 2 * margin_x
    chart_height = height - top - bottom
    center = top + chart_height // 2

    image = Image.new("RGB", (width, height), "#070a10")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=24)
    small = ImageFont.load_default(size=17)
    title = ImageFont.load_default(size=34)

    draw.text((margin_x, 35), "SHINOBI JOURNEY — MUSIC EDIT MAP", fill="#f3d98b", font=title)
    draw.text(
        (margin_x, 78),
        f"Duration {format_time(duration)}   •   Estimated tempo {tempo:.1f} BPM",
        fill="#aab5ca",
        font=small,
    )

    for second in np.arange(0, duration + 0.001, 10):
        x = margin_x + int((second / duration) * chart_width)
        draw.line((x, top, x, top + chart_height), fill="#182234", width=1)
        draw.text((x - 18, top + chart_height + 18), format_time(float(second)), fill="#738099", font=small)

    # Draw a decimated waveform envelope.
    samples_per_column = max(1, len(waveform) // chart_width)
    for column in range(chart_width):
        start = column * samples_per_column
        end = min(len(waveform), start + samples_per_column)
        if start >= len(waveform):
            break
        amplitude = float(np.max(np.abs(waveform[start:end]))) if end > start else 0.0
        half_height = int(amplitude * chart_height * 0.42)
        x = margin_x + column
        draw.line((x, center - half_height, x, center + half_height), fill="#3d6d9e", width=1)

    # RMS energy curve.
    rms_norm = rms / max(float(np.max(rms)), 1e-8)
    points = []
    for time_value, energy in zip(rms_times, rms_norm):
        x = margin_x + int((float(time_value) / duration) * chart_width)
        y = top + chart_height - int(float(energy) * chart_height * 0.92)
        points.append((x, y))
    if len(points) > 1:
        draw.line(points, fill="#f0a23b", width=4)

    # Major structural changes.
    for boundary in boundaries:
        x = margin_x + int((float(boundary) / duration) * chart_width)
        draw.line((x, top, x, top + chart_height), fill="#a970d6", width=2)

    # Beat ticks are intentionally subtle.
    for beat in beats:
        x = margin_x + int((float(beat) / duration) * chart_width)
        draw.line((x, center - 10, x, center + 10), fill="#b4cee6", width=1)

    # Strongest spaced impact points.
    for rank, peak_index in enumerate(peaks, start=1):
        time_value = float(rms_times[peak_index])
        x = margin_x + int((time_value / duration) * chart_width)
        y = top + chart_height - int(float(rms_norm[peak_index]) * chart_height * 0.92)
        draw.ellipse((x - 8, y - 8, x + 8, y + 8), fill="#f4e3a2")
        draw.text((x + 10, max(top, y - 30)), f"{rank} · {format_time(time_value)}", fill="#f4e3a2", font=small)

    draw.text((margin_x, height - 45), "Blue: waveform   Orange: energy   Purple: structural change   Gold: impact peak", fill="#8d9ab2", font=small)
    image.save(output_path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    y, sample_rate = librosa.load(args.input, sr=22050, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sample_rate))
    hop_length = 512

    onset = librosa.onset.onset_strength(y=y, sr=sample_rate, hop_length=hop_length)
    tempo_values, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset,
        sr=sample_rate,
        hop_length=hop_length,
    )
    tempo = float(np.atleast_1d(tempo_values)[0])
    beat_times = librosa.frames_to_time(beat_frames, sr=sample_rate, hop_length=hop_length)

    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop_length)[0]
    rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sample_rate, hop_length=hop_length)
    peak_indexes = spaced_peaks(rms, rms_times, count=18, spacing=4.0)

    mfcc = librosa.feature.mfcc(y=y, sr=sample_rate, n_mfcc=13, hop_length=hop_length)
    # Agglomerative segmentation scales poorly with every analysis frame. A
    # one-point-per-eight-frames feature map remains far more precise than an
    # editor needs while keeping a three-minute track quick to analyze.
    segment_stride = 8
    segment_features = mfcc[:, ::segment_stride]
    segment_frames = librosa.segment.agglomerative(segment_features, k=14) * segment_stride
    segment_times = librosa.frames_to_time(segment_frames, sr=sample_rate, hop_length=hop_length)
    segment_times = np.unique(np.clip(segment_times, 0, duration))

    # Candidate trailer endings: structural boundaries or strong beat-adjacent
    # valleys between 1:45 and 3:00. Editors can choose a nearby impact and
    # create a short music tail if the source song continues.
    candidate_endings: list[dict[str, float | str]] = []
    for boundary in segment_times:
        if 105 <= boundary <= min(180, duration):
            index = int(np.argmin(np.abs(rms_times - boundary)))
            candidate_endings.append(
                {
                    "time_seconds": round(float(boundary), 3),
                    "timecode": format_time(float(boundary)),
                    "normalized_energy": round(float(rms[index] / max(np.max(rms), 1e-8)), 4),
                    "kind": "structural_change",
                }
            )

    report = {
        "input": str(args.input),
        "duration_seconds": round(duration, 3),
        "duration_timecode": format_time(duration),
        "sample_rate": sample_rate,
        "estimated_tempo_bpm": round(tempo, 3),
        "beat_times_seconds": [round(float(value), 3) for value in beat_times],
        "structural_boundaries_seconds": [round(float(value), 3) for value in segment_times],
        "spaced_impact_peaks": [
            {
                "time_seconds": round(float(rms_times[index]), 3),
                "timecode": format_time(float(rms_times[index])),
                "normalized_energy": round(float(rms[index] / max(np.max(rms), 1e-8)), 4),
            }
            for index in peak_indexes
        ],
        "candidate_trailer_endings": candidate_endings,
    }

    json_path = args.output_dir / "track-analysis.json"
    image_path = args.output_dir / "track-edit-map.png"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    draw_report(
        image_path,
        y,
        sample_rate,
        rms,
        rms_times,
        beat_times,
        peak_indexes,
        segment_times,
        duration,
        tempo,
    )
    print(json.dumps(report, indent=2))
    print(f"Wrote {json_path}")
    print(f"Wrote {image_path}")


if __name__ == "__main__":
    main()
