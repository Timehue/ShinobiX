"""Render the expanded-coverage 2:12 Shinobi Journey V7 anime promo."""

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
    v7 = root / "output" / "trailer" / "framepack-v7"
    work = root / "tmp" / "trailer" / "render-v7"
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
    v7_proof = lambda name: v7 / f"{name}-proof.mp4"

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

    section(1.200, [s("disclosure", disclosure, 1.200, still=True)])

    # A distinct seven-shot world reveal replaces the repeated opening montage.
    section(
        8.545,
        [
            s("summit-prologue", v7_proof("40-rill-fox-summit-v7"), 1.050, caption="A WORLD DIVIDED"),
            s("secret-council", v7_proof("29-four-clan-council-v7"), 1.050),
            s("ice-capital", v7_proof("31-ice-clan-citadel-v7"), 1.050),
            s("fire-capital", v7_proof("32-fire-clan-forge-city-v7"), 1.050),
            s("wind-capital", v7_proof("33-wind-clan-sky-monastery-v7"), 1.050),
            s("lightning-capital", v7_proof("34-lightning-clan-citadel-v7"), 1.050),
            s("eclipse-prophecy", v7_proof("39-elemental-eclipse-v7"), 1.045),
        ],
    )

    section(
        14.303,
        [
            s("four-armies", v7_proof("26-four-armies-formation-v7"), 1.150, caption="FOUR VILLAGES"),
            s("seal-below", v7_proof("30-ancient-seal-chamber-v7"), 1.150),
            s("bridge-standoff", v7_proof("38-broken-bridge-standoff-v7"), 1.150),
            s("oni-shadow", v7_proof("35-oni-shadow-gate-v7"), 1.150),
            s("elemental-war", v6_proof("22-elemental-impact-v6"), 1.158, caption="ONE WAR"),
        ],
    )

    # Inciting action uses planted poses and clean inserts instead of running cycles.
    section(
        27.121,
        [
            s("rooftop-sentry", v7_proof("27-rill-rooftop-sentry-v7"), 1.100),
            s("blade-draw", v6_proof("20-hero-blade-draw-v6"), 1.100),
            s("rival-waits", v7_proof("38-broken-bridge-standoff-v7"), 1.100),
            s("bloodline-eyes", scene("02-inferno-awakening"), 0.900),
            s("bloodline-fire", v5_proof("15-fire-champion-v5"), 1.100, caption="ONE BLOODLINE AWAKENED"),
            s("fox-senses-hollow", v7_proof("37-fox-lantern-shrine-v7"), 1.100),
            s("elements-collide", v6_proof("22-elemental-impact-v6"), 1.100),
            s("first-duel", full("12-rooftop-duel-v5"), 1.400),
            s("gate-shadow", v7_proof("35-oni-shadow-gate-v7"), 1.100),
            s("ice-response", v5_proof("14-ice-champion-v5"), 1.018),
            s("heroes-launch", full("19-final-launch-v5"), 1.800),
        ],
    )

    # Each village receives both a location and champion beat before the conflict expands.
    section(
        54.242,
        [
            s("ice-champion", v5_proof("14-ice-champion-v5"), 1.100),
            s("fire-champion", v5_proof("15-fire-champion-v5"), 1.100),
            s("wind-champion", v5_proof("16-wind-champion-v5"), 1.100),
            s("lightning-champion", v5_proof("17-lightning-champion-v5"), 1.100),
            s("ice-stronghold", v7_proof("31-ice-clan-citadel-v7"), 1.100),
            s("fire-forges", v7_proof("32-fire-clan-forge-city-v7"), 1.100),
            s("wind-temples", v7_proof("33-wind-clan-sky-monastery-v7"), 1.100),
            s("lightning-towers", v7_proof("34-lightning-clan-citadel-v7"), 1.100),
            s("armies-advance", v7_proof("26-four-armies-formation-v7"), 1.100),
            s("council-decision", v7_proof("29-four-clan-council-v7"), 1.100, caption="CHOOSE YOUR LEGACY"),
            s("duel-returns", full("12-rooftop-duel-v5"), 1.400),
            s("sentry-returns", v7_proof("27-rill-rooftop-sentry-v7"), 1.100),
            s("hollow-tracks", v7_proof("28-hollow-hunt-overlook-v7"), 1.100),
            s("hollow-gate", scene("09-hollow-gate-finale"), 1.600, offset=0.300, caption="ENTER THE HOLLOW"),
            s("oni-reveal", v6_proof("23-oni-threat-close-v6"), 1.100),
            s("oni-strike", full("13-oni-dodge-v5"), 1.500, caption="FACE TITANS"),
            s("fallen-memory", v7_proof("36-fallen-shinobi-memorial-v7"), 1.100),
            s("seal-awakens", v7_proof("30-ancient-seal-chamber-v7"), 1.100),
            s("eclipse-rises", v7_proof("39-elemental-eclipse-v7"), 1.100),
            s("shared-resolve", v6_proof("25-rill-fox-resolve-v6"), 1.100),
            s("steel-oath", v6_proof("20-hero-blade-draw-v6"), 1.100),
            s("summit-oath", v7_proof("40-rill-fox-summit-v7"), 1.100),
            s("launch-into-war", full("19-final-launch-v5"), 1.721),
        ],
    )

    # A quiet dramatic breath replaces the long chase loop.
    section(
        65.016,
        [
            s("bond-before-war", full("11-rill-fox-bond-v5"), 2.000, speed=0.95),
            s("memorial-silence", v7_proof("36-fallen-shinobi-memorial-v7"), 1.150),
            s("fox-listens", v7_proof("37-fox-lantern-shrine-v7"), 1.150),
            s("empty-causeway", v6_proof("24-siege-banners-v6"), 1.150),
            s("tower-omen", scene("08-worldstorm-tower"), 1.150),
            s("predator-below", v7_proof("28-hollow-hunt-overlook-v7"), 1.150),
            s("eclipse-deepens", v7_proof("39-elemental-eclipse-v7"), 1.150),
            s("gate-approach", scene("09-hollow-gate-finale"), 1.874, offset=0.300),
        ],
    )

    # Main battle alternates threat, characters, clan locations, and world scale.
    section(
        104.211,
        [
            s("gate-breach", scene("09-hollow-gate-finale"), 1.800, offset=0.300, caption="THE HOLLOW BROKE THROUGH"),
            s("hollow-searches", v7_proof("28-hollow-hunt-overlook-v7"), 1.150),
            s("oni-shadow-advances", v7_proof("35-oni-shadow-gate-v7"), 1.150),
            s("oni-eyes", v6_proof("23-oni-threat-close-v6"), 1.150),
            s("oni-swing", full("13-oni-dodge-v5"), 1.600),
            s("steel-ready", v6_proof("20-hero-blade-draw-v6"), 1.100),
            s("roofline-watch", v7_proof("27-rill-rooftop-sentry-v7"), 1.150),
            s("rivals-across-void", v7_proof("38-broken-bridge-standoff-v7"), 1.150),
            s("blade-lock", full("12-rooftop-duel-v5"), 1.500),
            s("ice-strike", v5_proof("14-ice-champion-v5"), 1.100),
            s("ice-home", v7_proof("31-ice-clan-citadel-v7"), 1.100),
            s("impact-wide", v6_proof("22-elemental-impact-v6"), 1.100),
            s("fire-strike", v5_proof("15-fire-champion-v5"), 1.100, caption="MASTER YOUR BLOODLINE"),
            s("fire-home", v7_proof("32-fire-clan-forge-city-v7"), 1.100),
            s("wind-strike", v5_proof("16-wind-champion-v5"), 1.100),
            s("wind-home", v7_proof("33-wind-clan-sky-monastery-v7"), 1.100),
            s("tower-break", scene("08-worldstorm-tower"), 1.100),
            s("lightning-strike", v5_proof("17-lightning-champion-v5"), 1.100),
            s("lightning-home", v7_proof("34-lightning-clan-citadel-v7"), 1.100),
            s("formations-hold", v7_proof("26-four-armies-formation-v7"), 1.100),
            s("war-front", scene("05-four-village-war"), 1.150),
            s("leaders-unite", v7_proof("29-four-clan-council-v7"), 1.100),
            s("honor-the-fallen", v7_proof("36-fallen-shinobi-memorial-v7"), 1.100),
            s("fox-stands-guard", v7_proof("37-fox-lantern-shrine-v7"), 1.100),
            s("gate-holds", scene("09-hollow-gate-finale"), 1.800, offset=0.300),
            s("sky-seal", v7_proof("39-elemental-eclipse-v7"), 1.100),
            s("chamber-answer", v7_proof("30-ancient-seal-chamber-v7"), 1.100),
            s("sunrise-promise", v7_proof("40-rill-fox-summit-v7"), 1.100),
            s("hero-fox-close", v6_proof("25-rill-fox-resolve-v6"), 1.100),
            s("final-drive", full("19-final-launch-v5"), 1.600),
            s("ice-aftershock", v5_proof("14-ice-champion-v5"), 1.000),
            s("fire-aftershock", v5_proof("15-fire-champion-v5"), 1.000),
            s("oni-aftershock", v6_proof("23-oni-threat-close-v6"), 1.095),
        ],
    )

    # Native-speed climax: nineteen distinct beats, no rejected motion sources.
    section(
        123.902,
        [
            s("rush-sentry", v7_proof("27-rill-rooftop-sentry-v7"), 1.050),
            s("rush-blade", v6_proof("20-hero-blade-draw-v6"), 1.050),
            s("rush-standoff", v7_proof("38-broken-bridge-standoff-v7"), 1.050),
            s("rush-duel", full("12-rooftop-duel-v5"), 1.150, offset=0.200),
            s("rush-ice-home", v7_proof("31-ice-clan-citadel-v7"), 1.000),
            s("rush-ice", v5_proof("14-ice-champion-v5"), 1.000),
            s("rush-fire-home", v7_proof("32-fire-clan-forge-city-v7"), 1.000),
            s("rush-fire", v5_proof("15-fire-champion-v5"), 1.000),
            s("rush-wind-home", v7_proof("33-wind-clan-sky-monastery-v7"), 1.000),
            s("rush-wind", v5_proof("16-wind-champion-v5"), 1.000),
            s("rush-lightning-home", v7_proof("34-lightning-clan-citadel-v7"), 1.000),
            s("rush-lightning", v5_proof("17-lightning-champion-v5"), 1.000),
            s("rush-elements", v6_proof("22-elemental-impact-v6"), 1.000),
            s("rush-oni-shadow", v7_proof("35-oni-shadow-gate-v7"), 1.000),
            s("rush-oni-eyes", v6_proof("23-oni-threat-close-v6"), 1.000),
            s("rush-oni-dodge", full("13-oni-dodge-v5"), 1.150, offset=0.250),
            s("rush-hollow-hunt", v7_proof("28-hollow-hunt-overlook-v7"), 1.000),
            s("rush-formations", v7_proof("26-four-armies-formation-v7"), 1.000),
            s("rush-eclipse", v7_proof("39-elemental-eclipse-v7"), 1.241, caption="BECOME THE LEGEND", speed=0.98),
        ],
    )

    section(
        TRAILER_END,
        [
            s("final-memorial", v7_proof("36-fallen-shinobi-memorial-v7"), 1.150),
            s("final-summit", v7_proof("40-rill-fox-summit-v7"), 1.150, caption="YOUR JOURNEY BEGINS"),
            s("final-resolve", v6_proof("25-rill-fox-resolve-v6"), 1.150),
            s("end-card", end_card, 4.723, still=True),
        ],
    )

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

    concat_file = work / "concat-v7.txt"
    concat_file.write_text("".join(f"file '{path.as_posix()}'\n" for path in clip_paths), encoding="utf-8")
    silent = work / "silent-v7.mp4"
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(silent)])

    music = work / "music-v7.wav"
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

    trailer = output_dir / "shinobi-journey-epic-anime-promo-v7-1080p.mp4"
    temporary = work / "final-v7.tmp.mp4"
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
