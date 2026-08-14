"""Render the quality-controlled 2:12 Shinobi Journey V6 anime promo."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from render_trailer_v5 import (
    FPS,
    TRAILER_END,
    Shot,
    ffmpeg_path,
    make_caption,
    make_music_edit,
    render_shot,
    run,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--song",
        type=Path,
        default=Path(r"C:\Users\Tyler R\Downloads\SHINOBI ROASTED RICE 2.wav"),
    )
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    root = args.root.resolve()
    old = root / "output" / "trailer" / "framepack-scenes"
    v5 = root / "output" / "trailer" / "framepack-v5"
    v6 = root / "output" / "trailer" / "framepack-v6"
    charge = root / "output" / "trailer" / "proof-clan-charge-framepack.mp4"
    rooftop = root / "output" / "trailer" / "framepack-03-rooftop-pursuit.mp4"
    work = root / "tmp" / "trailer" / "render-v6"
    clips_dir = work / "clips"
    overlays_dir = work / "overlays"
    output_dir = root / "output" / "trailer"
    for directory in (work, clips_dir, overlays_dir, output_dir):
        directory.mkdir(parents=True, exist_ok=True)

    disclosure = root / "tmp" / "trailer" / "render-v2" / "disclosure-v2.jpg"
    end_card = root / "tmp" / "trailer" / "render-v2" / "end-card-v2.jpg"
    scene = lambda name: old / f"{name}.mp4"
    full = lambda name: v5 / f"{name}-final.mp4"
    v5_proof = lambda name: v5 / f"{name}-proof.mp4"
    v6_proof = lambda name: v6 / f"{name}-proof.mp4"

    shots: list[Shot] = []
    elapsed = 0.0

    def s(
        name: str,
        source: Path,
        seconds: float,
        offset: float = 0.0,
        crop: str = "wide",
        caption: str | None = None,
        still: bool = False,
        speed: float = 1.0,
    ) -> tuple:
        return (name, source, seconds, offset, crop, caption, False, still, speed)

    def section(end: float, specs: list[tuple]) -> None:
        nonlocal elapsed
        requested = sum(float(spec[2]) for spec in specs)
        available = end - elapsed
        if abs(requested - available) > 0.002:
            raise ValueError(
                f"Section ending {end:.3f} requests {requested:.3f}s but has {available:.3f}s"
            )
        for spec in specs:
            name, source, duration, offset, crop, caption, flash, still, speed = spec
            shots.append(Shot(name, source, duration, offset, crop, caption, flash, still, speed))
            elapsed += duration
        elapsed = end

    # Opening: restrained character acting and environmental scale.
    section(1.200, [s("disclosure", disclosure, 1.200, still=True)])
    section(
        8.545,
        [
            s("resolve-open", v6_proof("25-rill-fox-resolve-v6"), 1.150, caption="A WORLD DIVIDED", speed=0.95),
            s("quiet-oath", full("11-rill-fox-bond-v5"), 2.150, speed=0.90),
            s("village-overlook", scene("01-rill-overlook"), 1.150, speed=0.95),
            s("siege-gate", v6_proof("24-siege-banners-v6"), 1.150, speed=0.95),
            s("world-storm", scene("08-worldstorm-tower"), 1.150, speed=0.95),
            s("elements-awaken", v6_proof("22-elemental-impact-v6"), 0.595, speed=1.05),
        ],
    )
    section(
        14.303,
        [
            s("four-village-war", scene("05-four-village-war"), 1.250, caption="FOUR VILLAGES", speed=1.00),
            s("clan-charge", charge, 2.250, speed=0.95),
            s("ice-reveal", v5_proof("14-ice-champion-v5"), 1.129, speed=1.00),
            s("lightning-reveal", v5_proof("17-lightning-champion-v5"), 1.129, caption="ONE WAR", speed=1.00),
        ],
    )

    # Inciting action: every clip stays near native speed.
    section(
        27.121,
        [
            s("rooftop-sprint", rooftop, 2.150, speed=1.00),
            s("blade-draw", v6_proof("20-hero-blade-draw-v6"), 1.150, speed=1.00),
            s("rooftop-duel", full("12-rooftop-duel-v5"), 1.850, speed=1.00),
            s("bloodline-eyes", scene("02-inferno-awakening"), 0.900, speed=1.00),
            s("bloodline-fire", v5_proof("15-fire-champion-v5"), 1.300, caption="ONE BLOODLINE AWAKENED", speed=0.95),
            s("fire-champion", v5_proof("15-fire-champion-v5"), 1.150, speed=1.00),
            s("fox-ready", v6_proof("21-fox-ready-close-v6"), 1.150, speed=1.00),
            s("elemental-collision", v6_proof("22-elemental-impact-v6"), 1.150, speed=1.00),
            s("launch-first", full("19-final-launch-v5"), 2.018, speed=0.95),
        ],
    )

    # The four villages and the widening war.
    section(
        54.242,
        [
            s("ice-champion", v5_proof("14-ice-champion-v5"), 1.150),
            s("fire-champion-return", v5_proof("15-fire-champion-v5"), 1.150),
            s("wind-champion", v5_proof("16-wind-champion-v5"), 1.150),
            s("lightning-champion", v5_proof("17-lightning-champion-v5"), 1.150),
            s("elements-clash-return", v6_proof("22-elemental-impact-v6"), 1.150),
            s("fortress-banners", v6_proof("24-siege-banners-v6"), 1.150),
            s("charge-wide", charge, 2.200, caption="CHOOSE YOUR LEGACY", speed=0.95),
            s("duel-return", full("12-rooftop-duel-v5"), 1.800),
            s("rooftop-return", rooftop, 2.150),
            s("awakening-eyes-return", scene("02-inferno-awakening"), 0.900),
            s("awakening-fire-return", v5_proof("15-fire-champion-v5"), 1.300, speed=0.95),
            s("hollow-gate", scene("09-hollow-gate-finale"), 2.200, offset=0.300, caption="ENTER THE HOLLOW"),
            s("oni-threat", v6_proof("23-oni-threat-close-v6"), 1.150),
            s("oni-dodge", full("13-oni-dodge-v5"), 1.700, caption="FACE TITANS"),
            s("hollow-chase", full("18-hollow-chase-v5"), 2.150),
            s("storm-tower", scene("08-worldstorm-tower"), 1.150),
            s("resolve-return", v6_proof("25-rill-fox-resolve-v6"), 1.150),
            s("blade-return", v6_proof("20-hero-blade-draw-v6"), 1.100),
            s("launch-return", full("19-final-launch-v5"), 1.271),
        ],
    )

    # Quiet breath before the second musical build.
    section(
        65.016,
        [
            s("bond-before-war", full("11-rill-fox-bond-v5"), 2.300, speed=0.95),
            s("shared-resolve", v6_proof("25-rill-fox-resolve-v6"), 1.150),
            s("empty-causeway", v6_proof("24-siege-banners-v6"), 1.150),
            s("tower-omen", scene("08-worldstorm-tower"), 1.150),
            s("hollow-approaches", scene("09-hollow-gate-finale"), 2.150, offset=0.300),
            s("chase-long", full("18-hollow-chase-v5"), 2.874, speed=0.80),
        ],
    )

    # Main battle: alternate human action, monsters, elements, and scale.
    section(
        104.211,
        [
            s("gate-breach", scene("09-hollow-gate-finale"), 2.200, offset=0.300, caption="THE HOLLOW BROKE THROUGH"),
            s("chase-drive", full("18-hollow-chase-v5"), 2.200),
            s("oni-eyes", v6_proof("23-oni-threat-close-v6"), 1.150),
            s("oni-swing", full("13-oni-dodge-v5"), 1.700),
            s("steel-ready", v6_proof("20-hero-blade-draw-v6"), 1.150),
            s("rain-sprint", rooftop, 2.150),
            s("blade-lock", full("12-rooftop-duel-v5"), 1.800),
            s("ice-strike", v5_proof("14-ice-champion-v5"), 1.150),
            s("impact-wide", v6_proof("22-elemental-impact-v6"), 1.150),
            s("fire-strike", v5_proof("15-fire-champion-v5"), 1.150),
            s("bloodline-rise-eyes", scene("02-inferno-awakening"), 0.900),
            s("bloodline-rise-fire", v5_proof("15-fire-champion-v5"), 1.300, caption="MASTER YOUR BLOODLINE", speed=0.95),
            s("wind-strike", v5_proof("16-wind-champion-v5"), 1.150),
            s("tower-break", scene("08-worldstorm-tower"), 1.150),
            s("lightning-strike", v5_proof("17-lightning-champion-v5"), 1.150),
            s("armies-charge", charge, 2.200),
            s("war-front", scene("05-four-village-war"), 1.250),
            s("hero-resolve", v6_proof("25-rill-fox-resolve-v6"), 1.150),
            s("fox-resolve", v6_proof("21-fox-ready-close-v6"), 1.150),
            s("gate-close", scene("09-hollow-gate-finale"), 2.000, offset=0.300),
            s("hound-close", full("18-hollow-chase-v5"), 2.000, offset=0.300),
            s("duel-close", full("12-rooftop-duel-v5"), 1.500, offset=0.300),
            s("final-drive", full("19-final-launch-v5"), 2.100),
            s("fortress-return", v6_proof("24-siege-banners-v6"), 1.150),
            s("tower-aftershock", scene("08-worldstorm-tower"), 1.150),
            s("oni-aftershock", v6_proof("23-oni-threat-close-v6"), 1.150),
            s("elements-aftershock", v6_proof("22-elemental-impact-v6"), 0.945),
        ],
    )

    # Beat-matched climax with no frame holds or full-white flashes.
    section(
        123.902,
        [
            s("rush-rooftop", rooftop, 1.100, offset=0.400),
            s("rush-blade", v6_proof("20-hero-blade-draw-v6"), 1.050),
            s("rush-duel", full("12-rooftop-duel-v5"), 1.250, offset=0.200),
            s("rush-ice", v5_proof("14-ice-champion-v5"), 1.050),
            s("rush-fire", v5_proof("15-fire-champion-v5"), 1.050),
            s("rush-lightning", v5_proof("17-lightning-champion-v5"), 1.050),
            s("rush-elements", v6_proof("22-elemental-impact-v6"), 1.050),
            s("rush-oni-eyes", v6_proof("23-oni-threat-close-v6"), 1.050),
            s("rush-oni-dodge", full("13-oni-dodge-v5"), 1.250, offset=0.250),
            s("rush-chase", full("18-hollow-chase-v5"), 1.250, offset=0.250),
            s("rush-gate", scene("09-hollow-gate-finale"), 1.250, offset=0.250),
            s("rush-tower", scene("08-worldstorm-tower"), 1.050),
            s("rush-armies", charge, 1.250, offset=0.350),
            s("rush-awakening", v5_proof("15-fire-champion-v5"), 1.250, speed=0.98),
            s("rush-fox", v6_proof("21-fox-ready-close-v6"), 1.050),
            s("rush-resolve", v6_proof("25-rill-fox-resolve-v6"), 1.050, caption="BECOME THE LEGEND"),
            s("rush-final", full("19-final-launch-v5"), 1.641),
        ],
    )

    section(
        TRAILER_END,
        [
            s("final-resolve", v6_proof("25-rill-fox-resolve-v6"), 1.150),
            s("journey-begins", full("19-final-launch-v5"), 2.000, caption="YOUR JOURNEY BEGINS"),
            s("end-card", end_card, 5.023, still=True),
        ],
    )

    # Individual clips are encoded as whole 30 fps frames. Absorb cumulative
    # rounding into the static CTA so picture and music finish together.
    target_frames = round(TRAILER_END * FPS)
    current_frames = sum(max(1, round(shot.duration * FPS)) for shot in shots)
    frame_delta = target_frames - current_frames
    if frame_delta:
        end = shots[-1]
        shots[-1] = Shot(
            end.name,
            end.source,
            end.duration + frame_delta / FPS,
            end.offset,
            end.crop,
            end.caption,
            end.flash,
            end.still,
            end.speed,
        )

    captions: dict[str, Path] = {}
    for shot in shots:
        if shot.caption and shot.caption not in captions:
            path = overlays_dir / f"caption-{len(captions):02d}.png"
            make_caption(path, shot.caption)
            captions[shot.caption] = path

    nominal_duration = sum(shot.duration for shot in shots)
    frame_duration = sum(max(1, round(shot.duration * FPS)) for shot in shots) / FPS
    print(
        f"timeline_shots={len(shots)} nominal_duration={nominal_duration:.3f} "
        f"frame_duration={frame_duration:.3f}",
        flush=True,
    )
    if args.dry_run:
        cursor = 0.0
        for index, shot in enumerate(shots):
            source_end = shot.offset + shot.duration * shot.speed
            print(
                f"{index:03d} {cursor:07.3f}-{cursor + shot.duration:07.3f} {shot.name} "
                f"duration={shot.duration:.3f} source_end={source_end:.3f} speed={shot.speed:.2f} "
                f"source={shot.source}",
                flush=True,
            )
            cursor += shot.duration
        return

    ffmpeg = ffmpeg_path()
    clip_paths: list[Path] = []
    for index, shot in enumerate(shots):
        if not shot.source.exists():
            raise FileNotFoundError(shot.source)
        destination = clips_dir / f"{index:03d}-{shot.name}.mp4"
        print(f"[{index + 1:03d}/{len(shots):03d}] {shot.name} ({shot.duration:.3f}s)", flush=True)
        if args.force or not destination.exists() or destination.stat().st_size < 80_000:
            render_shot(ffmpeg, shot, captions.get(shot.caption), destination)
        clip_paths.append(destination)

    concat_file = work / "concat-v6.txt"
    concat_file.write_text("".join(f"file '{path.as_posix()}'\n" for path in clip_paths), encoding="utf-8")
    silent = work / "silent-v6.mp4"
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(silent)])

    music = work / "music-v6.wav"
    make_music_edit(ffmpeg, args.song.resolve(strict=True), music)
    sfx = root / "shinobij.client" / "public" / "sfx" / "production"
    events = [
        (sfx / "reveal.wav", 1.200, 0.07),
        (sfx / "battle-transition.wav", 8.545, 0.06),
        (sfx / "impact-heavy.wav", 14.303, 0.08),
        (sfx / "chakra-positive.wav", 18.603, 0.06),
        (sfx / "impact-heavy.wav", 27.121, 0.08),
        (sfx / "omen.wav", 54.242, 0.07),
        (sfx / "battle-transition.wav", 65.016, 0.07),
        (sfx / "impact-heavy.wav", 83.476, 0.08),
        (sfx / "mythic.wav", 104.211, 0.07),
        (sfx / "impact-heavy.wav", 123.902, 0.08),
        (sfx / "victory-seal.wav", 127.052, 0.09),
    ]
    command = [ffmpeg, "-y", "-i", str(silent), "-i", str(music)]
    for path, _, _ in events:
        command += ["-i", str(path)]
    filters = ["[1:a]volume=1.0[music]"]
    labels = ["[music]"]
    for index, (_, timestamp, volume) in enumerate(events):
        label = f"sfx{index}"
        filters.append(f"[{index + 2}:a]adelay={round(timestamp * 1000)}:all=1,volume={volume}[{label}]")
        labels.append(f"[{label}]")
    filters.append(
        "".join(labels)
        + f"amix=inputs={len(labels)}:duration=first:dropout_transition=0:normalize=0,"
        "alimiter=limit=0.96[aout]"
    )

    trailer = output_dir / "shinobi-journey-epic-anime-promo-v6-1080p.mp4"
    temporary = work / "final-v6.tmp.mp4"
    command += [
        "-filter_complex",
        ";".join(filters),
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "320k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(temporary),
    ]
    run(command)
    os.replace(temporary, trailer)
    print(f"Rendered {trailer}", flush=True)


if __name__ == "__main__":
    main()
