"""Render the low-repetition 2:12 Shinobi Journey V8 anime promo."""

from __future__ import annotations

import argparse
import os
from collections import Counter
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
    v5 = root / "output" / "trailer" / "framepack-v5"
    v6 = root / "output" / "trailer" / "framepack-v6"
    v7 = root / "output" / "trailer" / "framepack-v7"
    v8 = root / "output" / "trailer" / "framepack-v8"
    safe_v8 = root / "output" / "trailer" / "safe-v8"
    work = root / "tmp" / "trailer" / "render-v8"
    clips_dir = work / "clips"
    overlays_dir = work / "overlays"
    output_dir = root / "output" / "trailer"
    for directory in (work, clips_dir, overlays_dir, output_dir):
        directory.mkdir(parents=True, exist_ok=True)

    disclosure = root / "tmp" / "trailer" / "render-v2" / "disclosure-v2.jpg"
    end_card = root / "tmp" / "trailer" / "render-v2" / "end-card-v2.jpg"
    full = lambda name: v5 / f"{name}-final.mp4"
    v5_proof = lambda name: v5 / f"{name}-proof.mp4"
    v6_proof = lambda name: v6 / f"{name}-proof.mp4"
    v7_proof = lambda name: v7 / f"{name}-proof.mp4"
    v8_proof = lambda name: v8 / f"{name}-proof.mp4"

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
        speed: float = 0.50,
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

    section(1.200, [s("disclosure", disclosure, 1.200, still=True, speed=1.0)])

    # Mythic prologue: four new images, no callbacks.
    section(
        8.545,
        [
            s("prophecy-mural", v8_proof("53-ancient-prophecy-mural-v8"), 1.850, caption="A WORLD DIVIDED", speed=0.58),
            s("mission-council", v8_proof("44-rill-council-mission-v8"), 1.850, speed=0.58),
            s("alliance-banners", v8_proof("51-four-banners-rise-v8"), 1.850, speed=0.58),
            s("united-wall", v8_proof("57-united-defenders-v8"), 1.795, caption="FOUR CLANS. ONE FATE.", speed=0.60),
        ],
    )

    # Establish the physical world with three clean location plates.
    section(
        14.303,
        [
            s("ice-capital", v7_proof("31-ice-clan-citadel-v7"), 1.900, speed=0.56),
            s("fire-capital", v7_proof("32-fire-clan-forge-city-v7"), 1.900, speed=0.56),
            s("wind-capital", v7_proof("33-wind-clan-sky-monastery-v7"), 1.958, speed=0.55),
        ],
    )

    # Inciting omen. No early-generation sources remain in the cut.
    section(
        27.121,
        [
            s("lightning-capital", v7_proof("34-lightning-clan-citadel-v7"), 2.100, speed=0.52),
            s("elemental-eclipse", v7_proof("39-elemental-eclipse-v7"), 2.100, speed=0.52),
            s("ancient-seal", v7_proof("30-ancient-seal-chamber-v7"), 2.100, speed=0.52),
            s("hollow-canyon", v8_proof("45-hollow-canyon-pack-v8"), 2.100, caption="THE HOLLOW AWAKENS", speed=0.52),
            s("rooftop-sentry", v7_proof("27-rill-rooftop-sentry-v7"), 2.100, speed=0.52),
            s("rill-focus", v8_proof("56-rill-oni-focus-v8"), 2.318, speed=0.50),
        ],
    )

    # The call to war: twelve distinct scenes, each used for the first time.
    section(
        54.242,
        [
            s("bridge-journey", v8_proof("50-rill-fox-bridge-journey-v8"), 2.300, speed=0.50),
            s("clan-council", v7_proof("29-four-clan-council-v7"), 2.200, caption="CHOOSE YOUR LEGACY", speed=0.52),
            s("ice-ancient-gate", v8_proof("47-ice-ancient-gate-v8"), 2.250, speed=0.51),
            s("fire-beacons", v8_proof("46-fire-beacons-v8"), 2.250, speed=0.51),
            s("wind-bell", v8_proof("48-wind-warning-bell-v8"), 2.250, speed=0.51),
            s("lightning-dais", v8_proof("49-lightning-defense-dais-v8"), 2.250, speed=0.51),
            s("four-armies", v7_proof("26-four-armies-formation-v7"), 2.200, speed=0.52),
            s("oni-army", v8_proof("52-oni-shadow-army-v8"), 2.300, speed=0.50),
            s("hollow-breach", v8_proof("42-hollow-breach-v8"), 2.300, caption="ENTER THE HOLLOW", speed=0.50),
            s("lantern-trail", safe_v8 / "43-rill-fox-lantern-trail-v8-safe.mp4", 2.200, speed=1.00),
            s("sword-reflection", v8_proof("58-sword-oni-reflection-v8"), 2.200, speed=0.52),
            s("oni-standoff", v8_proof("41-rill-oni-standoff-v8"), 2.421, speed=0.48),
        ],
    )

    # Emotional breath before the battle.
    section(
        65.016,
        [
            s("bond-before-war", full("11-rill-fox-bond-v5"), 2.200, speed=0.50),
            s("fallen-memorial", v7_proof("36-fallen-shinobi-memorial-v7"), 2.100, speed=0.52),
            s("quiet-aftermath-vision", v8_proof("55-rill-fox-aftermath-v8"), 2.200, speed=0.52),
            s("shared-resolve", v6_proof("25-rill-fox-resolve-v6"), 2.100, speed=0.52),
            s("empty-causeway", v6_proof("24-siege-banners-v6"), 2.174, speed=0.53),
        ],
    )

    # Battle escalation: first callbacks appear only after all 44 approved sources have been introduced.
    section(
        104.211,
        [
            s("elemental-impact", v6_proof("22-elemental-impact-v6"), 2.000, speed=0.56),
            s("rooftop-duel", full("12-rooftop-duel-v5"), 2.200, speed=0.72),
            s("ice-champion", v5_proof("14-ice-champion-v5"), 2.100, speed=0.52),
            s("fire-champion", v5_proof("15-fire-champion-v5"), 2.100, caption="MASTER YOUR BLOODLINE", speed=0.52),
            s("wind-champion", v5_proof("16-wind-champion-v5"), 2.100, speed=0.52),
            s("lightning-champion", v5_proof("17-lightning-champion-v5"), 2.100, speed=0.52),
            s("ice-gate-callback", v8_proof("47-ice-ancient-gate-v8"), 2.200, speed=0.52),
            s("fire-beacons-callback", v8_proof("46-fire-beacons-v8"), 2.200, speed=0.52),
            s("wind-bell-callback", v8_proof("48-wind-warning-bell-v8"), 2.200, speed=0.52),
            s("lightning-dais-callback", v8_proof("49-lightning-defense-dais-v8"), 2.200, speed=0.52),
            s("banners-callback", v8_proof("51-four-banners-rise-v8"), 2.200, speed=0.52),
            s("oni-shadow", v7_proof("35-oni-shadow-gate-v7"), 2.200, speed=0.52),
            s("oni-close", v6_proof("23-oni-threat-close-v6"), 2.000, speed=0.56),
            s("rill-focus-callback", v8_proof("56-rill-oni-focus-v8"), 2.100, speed=0.52),
            s("standoff-callback", v8_proof("41-rill-oni-standoff-v8"), 2.200, caption="FACE TITANS", speed=0.52),
            s("hollow-hunt", v7_proof("28-hollow-hunt-overlook-v7"), 2.200, speed=0.52),
            s("hollow-canyon-callback", v8_proof("45-hollow-canyon-pack-v8"), 2.200, speed=0.52),
            s("hollow-breach-callback", v8_proof("42-hollow-breach-v8"), 2.695, speed=0.44),
        ],
    )

    # Climax: faster cuts, still no source used more than twice.
    section(
        123.902,
        [
            s("final-launch", full("19-final-launch-v5"), 2.100, speed=0.70),
            s("blade-draw", v6_proof("20-hero-blade-draw-v6"), 1.900, speed=0.56),
            s("bridge-standoff", v7_proof("38-broken-bridge-standoff-v7"), 2.000, speed=0.55),
            s("duel-callback", full("12-rooftop-duel-v5"), 2.000, offset=0.120, speed=0.70),
            s("impact-callback", v6_proof("22-elemental-impact-v6"), 1.900, speed=0.56),
            s("armies-callback", v7_proof("26-four-armies-formation-v7"), 2.000, speed=0.55),
            s("seal-fracture", v8_proof("54-elemental-seal-fracture-v8"), 2.000, speed=0.55),
            s("seal-callback", v7_proof("30-ancient-seal-chamber-v7"), 2.000, speed=0.55),
            s("defenders-callback", v8_proof("57-united-defenders-v8"), 2.000, caption="BECOME THE LEGEND", speed=0.55),
            s("eclipse-callback", v7_proof("39-elemental-eclipse-v7"), 1.791, speed=0.60),
        ],
    )

    section(
        127.352,
        [
            s("aftermath-callback", v8_proof("55-rill-fox-aftermath-v8"), 1.700, speed=0.62),
            s("final-summit", v7_proof("40-rill-fox-summit-v7"), 1.750, caption="YOUR JOURNEY BEGINS", speed=0.60),
        ],
    )
    section(TRAILER_END, [s("end-card", end_card, 4.723, still=True, speed=1.0)])

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

    usage = Counter(str(shot.source) for shot in shots if not shot.still)
    most_used = max(usage.values(), default=0)
    if most_used > 2:
        raise ValueError(f"Source repetition cap exceeded: {most_used}")

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
        f"frame_duration={frame_duration:.3f} unique_sources={len(usage)} max_source_uses={most_used}",
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

    concat_file = work / "concat-v8.txt"
    concat_file.write_text("".join(f"file '{path.as_posix()}'\n" for path in clip_paths), encoding="utf-8")
    silent = work / "silent-v8.mp4"
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(silent)])

    music = work / "music-v8.wav"
    make_music_edit(ffmpeg, args.song.resolve(strict=True), music)
    sfx = root / "shinobij.client" / "public" / "sfx" / "production"
    events = [
        (sfx / "reveal.wav", 1.200, 0.07),
        (sfx / "battle-transition.wav", 8.545, 0.06),
        (sfx / "omen.wav", 14.303, 0.07),
        (sfx / "impact-heavy.wav", 27.121, 0.08),
        (sfx / "battle-transition.wav", 54.242, 0.06),
        (sfx / "omen.wav", 65.016, 0.06),
        (sfx / "mythic.wav", 104.211, 0.07),
        (sfx / "impact-heavy.wav", 123.902, 0.08),
        (sfx / "victory-seal.wav", 127.352, 0.09),
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

    trailer = output_dir / "shinobi-journey-epic-anime-promo-v8-1080p.mp4"
    temporary = work / "final-v8.tmp.mp4"
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
