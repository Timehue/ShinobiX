"""Render the unique-source 2:12 Shinobi Journey V9-V19 anime promo."""

from __future__ import annotations

import argparse
import os
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw

from render_trailer_v2 import draw_tracked, font, make_end_card, tracked_width
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


def make_logo_opener(
    ffmpeg: str,
    logo: Path,
    destination: Path,
    disclaimer: str | None = None,
) -> None:
    """Create a clean logo-only opening card from the real site logo asset."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            ffmpeg,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x020309:s=1920x1080:r=30",
            "-i",
            str(logo.resolve(strict=True)),
            "-filter_complex",
            (
                "[0:v]vignette=PI/5[bg];"
                "[1:v]scale=1180:-1:flags=lanczos,split=2[sharp][glow];"
                "[glow]gblur=sigma=34,colorchannelmixer=aa=0.28[halo];"
                "[bg][halo]overlay=(W-w)/2:(H-h)/2[lit];"
                "[lit][sharp]overlay=(W-w)/2:(H-h)/2,format=rgb24[out]"
            ),
            "-map",
            "[out]",
            "-frames:v",
            "1",
            str(destination),
        ]
    )
    if disclaimer:
        with Image.open(destination) as loaded:
            image = loaded.convert("RGB")
        draw = ImageDraw.Draw(image)
        face = font(25, bold=False)
        tracking = 5
        width = tracked_width(draw, disclaimer, face, tracking)
        draw_tracked(
            draw,
            ((image.width - width) // 2, 905),
            disclaimer,
            face,
            "#8f99a8",
            tracking,
        )
        image.save(destination)


def make_music_edit_v14(ffmpeg: str, source: Path, destination: Path) -> None:
    """End the score 0.5 seconds earlier, then pad silence to preserve runtime."""
    music_end = TRAILER_END - 0.500
    fade_start = music_end - 0.900
    graph = (
        f"[0:a]atrim=start=0:end={music_end:.3f},asetpts=PTS-STARTPTS,"
        f"afade=t=in:st=0:d=0.08,afade=t=out:st={fade_start:.3f}:d=0.900,"
        "apad=pad_dur=0.500[out]"
    )
    run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(source),
            "-filter_complex",
            graph,
            "-map",
            "[out]",
            "-ar",
            "48000",
            "-c:a",
            "pcm_s16le",
            str(destination),
        ]
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
    edition = os.environ.get("SHINOBI_TRAILER_EDITION", "v9").lower()
    if edition not in {"v9", "v10", "v11", "v12", "v13", "v14", "v15", "v16", "v17", "v18", "v19"}:
        raise ValueError(f"Unsupported trailer edition: {edition}")
    aaa_copy = edition in {"v10", "v11", "v12", "v13", "v14", "v15", "v16", "v17", "v18", "v19"}
    v11_polish = edition in {"v11", "v12", "v13", "v14", "v15", "v16", "v17", "v18", "v19"}
    combat_focus = edition in {"v12", "v13", "v14", "v15", "v16", "v17", "v18", "v19"}

    def copy(v9_text: str, v10_text: str) -> str:
        return v10_text if aaa_copy else v9_text

    v5 = root / "output" / "trailer" / "framepack-v5"
    v6 = root / "output" / "trailer" / "framepack-v6"
    v7 = root / "output" / "trailer" / "framepack-v7"
    v8 = root / "output" / "trailer" / "framepack-v8"
    v9 = root / "output" / "trailer" / "framepack-v9"
    v11 = root / "output" / "trailer" / "framepack-v11"
    v12 = root / "output" / "trailer" / "framepack-v12"
    v14 = root / "output" / "trailer" / "framepack-v14"
    v15 = root / "output" / "trailer" / "framepack-v15"
    v16 = root / "output" / "trailer" / "framepack-v16"
    v17 = root / "output" / "trailer" / "framepack-v17"
    v18 = root / "output" / "trailer" / "framepack-v18"
    v19 = root / "output" / "trailer" / "framepack-v19"
    work = root / "tmp" / "trailer" / f"render-{edition}"
    clips_dir = work / "clips"
    overlays_dir = work / "overlays"
    output_dir = root / "output" / "trailer"
    for directory in (work, clips_dir, overlays_dir, output_dir):
        directory.mkdir(parents=True, exist_ok=True)

    ffmpeg = ffmpeg_path()
    opener = work / "shinobi-journey-logo-opener.png"
    logo = root / "shinobij.client" / "public" / "shinobi-journey-logo-wide.webp"
    complete_logo = root / "shinobij.client" / "public" / "shinobi-journey-title-art.webp"
    opener_logo = (
        complete_logo
        if edition in {"v13", "v14", "v15", "v16", "v17", "v18", "v19"}
        else logo
    )
    if args.force or not opener.exists():
        make_logo_opener(
            ffmpeg,
            opener_logo,
            opener,
            "CINEMATIC TRAILER  |  NOT ACTUAL GAMEPLAY" if aaa_copy else None,
        )
    if aaa_copy:
        end_card = work / f"end-card-{edition}.jpg"
        if args.force or not end_card.exists():
            make_end_card(
                root / "tmp" / "trailer" / "cinematic" / "09-hollow-gate-finale.png",
                complete_logo if edition in {"v15", "v16", "v17", "v18", "v19"} else logo,
                end_card,
                cta="JOIN THE BETA",
                url="SHINOBIJOURNEY.COM",
                small="FREE TO START  |  PLAYS IN YOUR BROWSER  |  NO DOWNLOAD",
                logo_width=2100 if edition in {"v15", "v16", "v17", "v18", "v19"} else 2680,
                logo_y=70 if edition in {"v15", "v16", "v17", "v18", "v19"} else 220,
            )
    else:
        end_card = root / "tmp" / "trailer" / "render-v2" / "end-card-v2.jpg"
    full = lambda name: v5 / f"{name}-final.mp4"
    v5_proof = lambda name: v5 / f"{name}-proof.mp4"
    v6_proof = lambda name: v6 / f"{name}-proof.mp4"
    v7_proof = lambda name: v7 / f"{name}-proof.mp4"
    v8_proof = lambda name: v8 / f"{name}-proof.mp4"
    v9_proof = lambda name: v9 / f"{name}-proof.mp4"
    v11_proof = lambda name: v11 / f"{name}-proof.mp4"
    v12_proof = lambda name: v12 / f"{name}-proof.mp4"
    v14_proof = lambda name: v14 / f"{name}-proof.mp4"
    v15_proof = lambda name: v15 / f"{name}-proof.mp4"

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

    # Logo only; the old generic "Cinematic Trailer" card is deliberately gone.
    section(1.200, [s("brand-logo", opener, 1.200, still=True, speed=1.0)])

    section(
        8.545,
        [
            s("prophecy-mural", v8_proof("53-ancient-prophecy-mural-v8"), 1.850, caption=copy("A WORLD DIVIDED", "A WORLD ON THE BRINK"), speed=0.58),
            s("mission-council", v8_proof("44-rill-council-mission-v8"), 1.850, speed=0.58),
            s("alliance-banners", v8_proof("51-four-banners-rise-v8"), 1.850, speed=0.58),
            s("united-wall", v8_proof("57-united-defenders-v8"), 1.795, caption=copy("FOUR CLANS. ONE FATE.", "FOUR VILLAGES. ONE FATE."), speed=0.60),
        ],
    )

    section(
        14.303,
        [
            s("ice-capital", v7_proof("31-ice-clan-citadel-v7"), 1.900, speed=0.56),
            s("fire-capital", v7_proof("32-fire-clan-forge-city-v7"), 1.900, speed=0.56),
            s("wind-capital", v7_proof("33-wind-clan-sky-monastery-v7"), 1.958, speed=0.55),
        ],
    )

    section(
        27.121,
        [
            s("lightning-capital", v7_proof("34-lightning-clan-citadel-v7"), 2.100, speed=0.52),
            s("elemental-eclipse", v7_proof("39-elemental-eclipse-v7"), 2.100, speed=0.52),
            s("ancient-seal", v7_proof("30-ancient-seal-chamber-v7"), 2.100, speed=0.52),
            s("hollow-canyon", v8_proof("45-hollow-canyon-pack-v8"), 2.100, caption=copy("THE HOLLOW AWAKENS", "THE HOLLOW GATE AWAKENS"), speed=0.52),
            s("rooftop-sentry", v7_proof("27-rill-rooftop-sentry-v7"), 2.100, speed=0.52),
            s("rill-focus", v8_proof("56-rill-oni-focus-v8"), 2.318, speed=0.50),
        ],
    )

    section(
        54.242,
        [
            s("bridge-journey", v8_proof("50-rill-fox-bridge-journey-v8"), 2.300, speed=0.50),
            s("clan-council", v7_proof("29-four-clan-council-v7"), 2.200, caption=copy("CHOOSE YOUR LEGACY", "CHOOSE YOUR VILLAGE"), speed=0.52),
            s("ice-ancient-gate", v8_proof("47-ice-ancient-gate-v8"), 2.250, speed=0.51),
            s("fire-beacons", v8_proof("46-fire-beacons-v8"), 2.250, speed=0.51),
            s("wind-bell", v8_proof("48-wind-warning-bell-v8"), 2.250, speed=0.51),
            s("lightning-dais", v8_proof("49-lightning-defense-dais-v8"), 2.250, speed=0.51),
            s("four-armies", v7_proof("26-four-armies-formation-v7"), 2.200, speed=0.52),
            s("oni-army", v8_proof("52-oni-shadow-army-v8"), 2.300, speed=0.50),
            s("hollow-breach", v8_proof("42-hollow-breach-v8"), 2.300, caption=copy("ENTER THE HOLLOW", "ENTER THE HOLLOW GATE"), speed=0.50),
            s("bare-forehead-lantern", v9_proof("59-rill-fox-lantern-bare-v9"), 2.200, speed=0.55),
            s("sword-reflection", v8_proof("58-sword-oni-reflection-v8"), 2.200, speed=0.52),
            s("oni-standoff", v8_proof("41-rill-oni-standoff-v8"), 2.421, speed=0.48),
        ],
    )

    section(
        65.016,
        [
            s(
                "lightning-companion-assault" if edition in {"v17", "v18", "v19"} else "companion-battle",
                v17 / "93-lightning-companion-assault-v17-clean-smooth.mp4"
                if edition in {"v17", "v18", "v19"}
                else v9_proof("60-fox-battle-charge-v9"),
                2.200,
                caption=copy("BATTLE WITH COMPANIONS", "FIGHT BESIDE YOUR COMPANIONS"),
                speed=1.00 if edition in {"v17", "v18", "v19"} else 0.55,
            ),
            s(
                "fallen-memorial-bare-fox" if v11_polish else "fallen-memorial",
                v11_proof("81-fallen-memorial-bare-fox-v11")
                if v11_polish
                else v7_proof("36-fallen-shinobi-memorial-v7"),
                2.100,
                speed=0.52,
            ),
            s(
                "quiet-forehead-bond" if v11_polish else "quiet-aftermath-vision",
                v11_proof("79-rill-fox-forehead-bond-bare-v11")
                if v11_polish
                else v8_proof("55-rill-fox-aftermath-v8"),
                2.200,
                speed=0.52,
            ),
            s(
                "lightning-fox-power" if edition in {"v15", "v16", "v17", "v18", "v19"} else "fox-golden-shield",
                v15_proof("88-lightning-fox-v15")
                if edition in {"v15", "v16", "v17", "v18", "v19"}
                else v9_proof("61-fox-golden-shield-v9"),
                2.100,
                speed=0.50 if edition in {"v15", "v16", "v17", "v18", "v19"} else 0.56,
            ),
            s("empty-causeway", v6_proof("24-siege-banners-v6"), 2.174, speed=0.53),
        ],
    )

    section(
        104.211,
        [
            s(
                "elemental-impact-animated" if edition == "v19" else "elemental-impact",
                v19 / "103-low-kick-water-evade-v19-final.mp4"
                if edition == "v19"
                else v6_proof("22-elemental-impact-v6"),
                2.000,
                speed=1.00 if edition == "v19" else 0.56,
            ),
            s(
                "rooftop-duel-impact-animated" if edition == "v19" else "rooftop-duel-impact",
                v19 / "104-rising-knee-lightning-guard-v19-final.mp4"
                if edition == "v19"
                else v9_proof("62-rooftop-duel-impact-v9"),
                2.200,
                caption="1V1 PVP DUELS" if edition == "v13" else (
                    "MASTER 1V1 COMBAT" if edition == "v12" else None
                ),
                speed=1.00 if edition == "v19" else 0.55,
            ),
            s("ice-champion", v5_proof("14-ice-champion-v5"), 2.100, speed=0.52),
            s(
                "fire-champion",
                v5_proof("15-fire-champion-v5"),
                2.100,
                caption="LEARN JUTSU" if edition in {"v15", "v16", "v17", "v18", "v19"} else None,
                speed=0.52,
            ),
            s(
                "wind-champion",
                v5_proof("16-wind-champion-v5"),
                2.100,
                caption="MASTER YOUR ELEMENT" if edition in {"v15", "v16", "v17", "v18", "v19"} else None,
                speed=0.52,
            ),
            s(
                "lightning-champion",
                v5_proof("17-lightning-champion-v5"),
                2.100,
                caption="EMBRACE YOUR LEGACY" if edition in {"v18", "v19"} else None,
                speed=0.52,
            ),
            s("frost-titan-squad", v9_proof("63-squad-frost-titan-v9"), 2.200, caption="ASSEMBLE YOUR SQUAD", speed=0.55),
            s(
                "fox-hollow-duel",
                v9_proof("64-fox-hollow-duel-v9"),
                2.200,
                caption="COMPANION BATTLES" if edition in {"v14", "v15", "v16", "v17", "v18", "v19"} else None,
                speed=0.55,
            ),
            s("sky-serpent-raid", v9_proof("65-squad-sky-serpent-v9"), 2.200, speed=0.55),
            s("elemental-combo", v9_proof("66-five-shinobi-elemental-combo-v9"), 2.200, speed=0.55),
            s(
                "clan-war-2v2" if combat_focus else "squad-loadout",
                v12_proof("82-clan-war-2v2-v12")
                if combat_focus
                else v9_proof("67-squad-loadout-armory-v9"),
                2.200,
                caption=(
                    "CLAN VS CLAN BATTLE"
                    if edition in {"v14", "v15", "v16", "v17", "v18", "v19"}
                    else "CLAN VS CLAN WAR" if edition == "v13"
                    else "CLAN AGAINST CLAN" if edition == "v12" else None
                ),
                speed=0.55,
            ),
            s("oni-shadow", v7_proof("35-oni-shadow-gate-v7"), 2.200, speed=0.52),
            s("oni-close", v6_proof("23-oni-threat-close-v6"), 2.000, speed=0.56),
            s("bloodline-awakening", v9_proof("68-rill-bloodline-awakening-v9"), 2.100, caption="AWAKEN YOUR BLOODLINE", speed=0.55),
            s("fox-howl-charge", v9_proof("69-fox-howl-squad-charge-v9"), 2.200, speed=0.55),
            s("hollow-hunt", v7_proof("28-hollow-hunt-overlook-v7"), 2.200, speed=0.52),
            s(
                "companion-roster",
                v9_proof("70-companion-roster-v9"),
                2.200,
                caption="150+ COMPANIONS TO DISCOVER" if edition in {"v16", "v17", "v18", "v19"} else None,
                speed=0.55,
            ),
            s("magma-ogre", v9_proof("71-dungeon-magma-ogre-v9"), 2.695, caption=copy("FACE WORLD BOSSES", "CHALLENGE LEGENDARY BOSSES"), speed=0.45),
        ],
    )

    section(
        123.902,
        [
            s(
                "tactical-1v1-jutsu"
                if edition in {"v14", "v15", "v16", "v17", "v18", "v19"}
                else "final-launch-bare-fox" if v11_polish else "final-launch",
                v19 / "106-lightning-dive-water-dodge-v19-final.mp4"
                if edition == "v19"
                else v17 / "94-tactical-1v1-smooth-v17-proof.mp4"
                if edition in {"v17", "v18"}
                else v15 / "89-tactical-1v1-jutsu-v15-stable.mp4"
                if edition in {"v15", "v16"}
                else v14_proof("85-tactical-1v1-jutsu-v14")
                if edition == "v14"
                else v11_proof("80-final-launch-bare-fox-v11")
                if v11_polish
                else full("19-final-launch-v5"),
                2.100,
                caption="TACTICAL 1V1 JUTSU BATTLES" if edition in {"v14", "v15", "v16", "v17", "v18", "v19"} else None,
                speed=1.00 if edition in {"v17", "v18", "v19"} else 0.045 if edition in {"v15", "v16"} else 0.16 if edition == "v14" else 0.70,
            ),
            *(
                [
                    s(
                        "animated-jutsu-fight-sequence",
                        v19 / "102-jutsu-fight-sequence-v19-final.mp4",
                        5.900,
                        speed=1.00,
                    )
                ]
                if edition == "v19"
                else [
                    s(
                        "jutsu-duel-escalation" if edition == "v18" else "blade-draw",
                        v18 / "95-jutsu-duel-escalation-v18-final.mp4"
                        if edition == "v18"
                        else v6_proof("20-hero-blade-draw-v6"),
                        2.850 if edition == "v18" else 1.900,
                        speed=1.00 if edition == "v18" else 0.56,
                    ),
                    s(
                        "jutsu-duel-climax" if edition == "v18" else "bridge-standoff",
                        v18 / "96-jutsu-duel-climax-v18-final.mp4"
                        if edition == "v18"
                        else v7_proof("38-broken-bridge-standoff-v7"),
                        3.050 if edition == "v18" else 2.000,
                        speed=1.00 if edition == "v18" else 0.55,
                    ),
                ]
            ),
            *([] if edition in {"v18", "v19"} else [s(
                "rain-bridge-duel" if edition in {"v14", "v15", "v16", "v17"} else "duel-separation",
                v17 / "92-rain-duel-counter-v17-clean-smooth.mp4"
                if edition == "v17"
                else v16 / "91-rain-bridge-duel-smooth-v16-proof-reversed.mp4"
                if edition == "v16"
                else v14_proof("87-rain-bridge-duel-v14")
                if edition in {"v14", "v15"}
                else v9_proof("72-rooftop-duel-separation-v9"),
                2.000,
                speed=1.00 if edition in {"v16", "v17"} else 0.12 if edition in {"v14", "v15"} else 0.55,
            )]),
            s("giant-oni-raid", v9_proof("73-squad-giant-oni-v9"), 1.900, caption=copy("CONQUER THE RAID", "CONQUER EPIC RAIDS"), speed=0.58),
            s("four-clan-siege", v9_proof("74-four-clan-siege-v9"), 2.000, speed=0.55),
            s("seal-fracture", v8_proof("54-elemental-seal-fracture-v8"), 2.000, speed=0.55),
            s("hollow-stag", v9_proof("75-squad-hollow-stag-v9"), 2.000, speed=0.55),
            s(
                "village-war-battle" if combat_focus else "treasure-portal",
                v15 / "90-village-elemental-front-v15-stable.mp4"
                if edition in {"v15", "v16", "v17", "v18", "v19"}
                else v14_proof("86-village-war-capture-v14")
                if edition == "v14"
                else v12 / "83-village-war-battle-v12-proof-reversed.mp4"
                if combat_focus
                else v9_proof("76-raid-treasure-portal-v9"),
                2.000,
                caption=(
                    "VILLAGE VS VILLAGE WAR"
                    if edition in {"v13", "v14", "v15", "v16", "v17", "v18", "v19"}
                    else "VILLAGE AGAINST VILLAGE" if edition == "v12" else None
                ),
                speed=0.50 if edition in {"v15", "v16", "v17", "v18", "v19"} else 0.18 if edition == "v14" else 0.55,
            ),
            s(
                "world-event-leviathan",
                v9_proof("77-world-event-leviathan-v9"),
                1.791,
                caption=None
                if combat_focus
                else copy("BECOME THE LEGEND", "FORGE YOUR LEGEND"),
                speed=0.60,
            ),
        ],
    )

    section(
        127.352,
        [
            s(
                "final-1v1-climax" if combat_focus else "rill-fox-victory",
                v19 / "101-vault-over-lightning-sweep-v19-final.mp4"
                if edition == "v19"
                else v12_proof("84-final-1v1-climax-v12")
                if combat_focus
                else v9_proof("78-rill-fox-victory-v9"),
                1.700,
                speed=1.00 if edition == "v19" else 0.62,
            ),
            s("final-summit", v7_proof("40-rill-fox-summit-v7"), 1.750, caption=copy("YOUR JOURNEY BEGINS", "BEGIN YOUR SHINOBI JOURNEY"), speed=0.60),
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
    if most_used > 1:
        repeats = [source for source, count in usage.items() if count > 1]
        raise ValueError(f"{edition.upper()} requires unique moving sources; repeated: {repeats}")

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

    clip_paths: list[Path] = []
    for index, shot in enumerate(shots):
        if not shot.source.exists():
            raise FileNotFoundError(shot.source)
        destination = clips_dir / f"{index:03d}-{shot.name}.mp4"
        print(f"[{index + 1:03d}/{len(shots):03d}] {shot.name} ({shot.duration:.3f}s)", flush=True)
        if args.force or not destination.exists() or destination.stat().st_size < 80_000:
            render_shot(ffmpeg, shot, captions.get(shot.caption), destination)
        clip_paths.append(destination)

    concat_file = work / f"concat-{edition}.txt"
    concat_file.write_text("".join(f"file '{path.as_posix()}'\n" for path in clip_paths), encoding="utf-8")
    silent = work / f"silent-{edition}.mp4"
    run([ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(silent)])

    music = work / f"music-{edition}.wav"
    if edition in {"v14", "v15", "v16", "v17", "v18", "v19"}:
        make_music_edit_v14(ffmpeg, args.song.resolve(strict=True), music)
    else:
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
    if edition == "v19":
        events.extend(
            [
                (sfx / "battle-transition.wav", 106.311, 0.045),
                (sfx / "impact-heavy.wav", 109.211, 0.055),
            ]
        )
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

    trailer = output_dir / f"shinobi-journey-epic-anime-promo-{edition}-1080p.mp4"
    temporary = work / f"final-{edition}.tmp.mp4"
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
