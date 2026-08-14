"""Render animation-stable variety coverage for the V8 trailer cut."""

from __future__ import annotations

import argparse
import shutil
import time
from pathlib import Path

from gradio_client import Client, handle_file

from framepack_generate import find_video_path


ROOT = Path(r"C:\Users\Tyler R\source\repos\NinjaK")
IMAGES = ROOT / "tmp" / "trailer" / "cinematic"
OUTPUTS = ROOT / "output" / "trailer" / "framepack-v8"
SERVER_OUTPUTS = Path(r"C:\Users\Tyler R\.cache\FramePack\outputs")


SCENES = [
    {
        "name": "41-rill-oni-standoff-v8",
        "seed": 8411,
        "prompt": (
            "The single red oni at far left and Rill at far right remain planted and look directly at each other "
            "across the empty courtyard. Rill's straight sword and the oni's single club remain rigid and separate. "
            "Only cloak edges, hair, smoke, and restrained embers move. Premium theatrical hand-drawn anime. Smooth "
            "slow push through the empty center gap, no attack, no turning away, no sliding feet, no extra limbs, no "
            "weapon bending, no body overlap, no camera shake, no morphing."
        ),
    },
    {
        "name": "42-hollow-breach-v8",
        "seed": 8422,
        "prompt": (
            "Rill and the single golden fox remain separated and motionless in the lower foreground, both facing the "
            "single distant violet Hollow hound beyond the broken gate. The hound lowers its head a few degrees while "
            "keeping all four paws planted. Rain falls, low fog crosses the plaza, the fracture pulses faintly, and the "
            "cloak and one fox tail move gently. Preserve every body and gate silhouette exactly. Premium feature-film "
            "anime. Smooth slow forward dolly, no running, no extra animals or limbs, no glowing blob, no shake, no morphing."
        ),
    },
    {
        "name": "43-rill-fox-lantern-trail-v8",
        "seed": 8433,
        "prompt": (
            "Rill remains kneeling on one knee and the single golden fox remains standing beside him, both looking uphill "
            "toward the distant violet omen. The fox keeps four readable paws and only raises its existing front paw a "
            "fraction while its two ears tilt forward. Rill takes one quiet breath without moving his planted legs or "
            "visible hand. Mist slides up the steps and lanterns flicker. Premium hand-drawn anime acting. Locked camera "
            "with a subtle push, no walking, no touching, no extra limbs or tails, no body overlap, no shake, no morphing."
        ),
    },
    {
        "name": "44-rill-council-mission-v8",
        "seed": 8444,
        "prompt": (
            "Rill remains at the chamber threshold facing exactly four masked leaders around the rigid circular map table. "
            "All hands stay hidden and every figure keeps its exact silhouette and position. The map brightens gently, four "
            "banners move a little, candle flames flicker, and fine dust falls. Premium theatrical anime strategy scene. "
            "Smooth restrained push toward the table, no extra people, no turning, no visible hands or weapons, no body "
            "overlap, no camera shake, no morphing architecture."
        ),
    },
    {
        "name": "45-hollow-canyon-pack-v8",
        "seed": 8455,
        "prompt": (
            "Exactly seven small violet Hollow hounds remain evenly separated on the far ridge and continue facing the "
            "fortress across the canyon. Their energy outlines pulse subtly while their planted four-legged silhouettes "
            "stay rigid. Canyon fog descends, dead branches move slightly, clouds orbit the eclipse, and distant windows "
            "flicker. Premium hand-painted anime establishing shot. Very slow aerial drift, no running, no new hounds, no "
            "overlapping pack, no bright mouths, no camera shake, no morphing cliffs or fortress."
        ),
    },
    {
        "name": "46-fire-beacons-v8",
        "seed": 8466,
        "prompt": (
            "The single Fire champion remains standing at the left battlement with both hands concealed behind his back, "
            "watching the city. Distant war beacons ignite one by one from foreground to volcano while the central forge "
            "flows steadily. Smoke and cloak hems drift in one direction. Preserve the champion, wall, and city geometry. "
            "Premium feature-film anime. Smooth slow push over the shoulder, no turning around, no fire aura, no visible "
            "hands, no extra people, no camera shake, no morphing."
        ),
    },
    {
        "name": "47-ice-ancient-gate-v8",
        "seed": 8477,
        "prompt": (
            "The single Ice champion remains planted at frame right with arms hidden beneath the cloak, looking left at "
            "the ancient frozen gate. The last snow from the avalanche settles downward, fine snow crosses the bridge, the "
            "gate's cyan seal pulses once, and cloak ribbons move gently. Preserve body, gate, bridge, and mountain geometry. "
            "Premium theatrical anime. Smooth slow forward dolly, no attack, no visible hands, no extra people, no cracking "
            "foreground ice, no white-out, no shake, no morphing."
        ),
    },
    {
        "name": "48-wind-warning-bell-v8",
        "seed": 8488,
        "prompt": (
            "The single Wind champion remains motionless at frame left with hands hidden inside joined sleeves. The enormous "
            "bronze bell swings only a few degrees and settles; prayer ribbons stream in one consistent direction and clouds "
            "flow below the rigid monastery bridges. Premium feature-film anime establishing shot. Smooth restrained crane "
            "back, no figure movement, no visible hands, no extra people, no tornado, no warped bell or architecture, no "
            "camera shake, no morphing."
        ),
    },
    {
        "name": "49-lightning-defense-dais-v8",
        "seed": 8499,
        "prompt": (
            "The single Lightning champion remains planted at the circular dais with both existing gloved hands resting on "
            "the stone edge. Rain falls and the one thin defensive arc connecting the four distant towers pulses once along "
            "its exact path. Cloak edges move gently and city windows flicker. Preserve hands, body, dais, towers, and bridge "
            "geometry. Premium theatrical anime. Slow push toward the citadel, no extra fingers or limbs, no energy touching "
            "the body, no white-out, no shake, no morphing."
        ),
    },
    {
        "name": "50-rill-fox-bridge-journey-v8",
        "seed": 8510,
        "prompt": (
            "Rill and the single golden fox keep their readable forward-facing-away silhouettes on the bridge and do not "
            "run. Their planted feet and four paws stay stable while cloak, scarf, and one tail tip move in the same wind. "
            "Clouds flow below, banners move, and dawn grows slightly behind the distant fortress. Premium hand-painted anime "
            "journey shot. Smooth slow camera glide forward past them to imply travel, no backward motion, no stepping cycle, "
            "no extra figures or limbs, no camera shake, no morphing bridge."
        ),
    },
    {
        "name": "51-four-banners-rise-v8",
        "seed": 8521,
        "prompt": (
            "Exactly four enormous separated clan banners lift slowly and evenly on their four towers while the central "
            "fortress remains rigid. Storm clouds open to restrained dawn light, tiny wall fires flicker, and distant army "
            "camps remain still. Preserve banner colors, symbols, spacing, towers, and causeway. Premium feature-film anime "
            "alliance reveal. Smooth low forward dolly, no extra banners, no close people, no tangled cloth, no overexposure, "
            "no camera shake, no morphing architecture."
        ),
    },
    {
        "name": "52-oni-shadow-army-v8",
        "seed": 8532,
        "prompt": (
            "The one distant two-horned oni and exactly twelve smaller soldiers remain in their disciplined formation inside "
            "the volcanic gate. The single club stays resting on the oni's shoulder. Smoke columns rise, embers drift toward "
            "camera, banners move slightly, and lava at the far edges glows. Preserve every silhouette and the monumental gate. "
            "Premium hand-painted anime threat reveal. Slow camera pullback along the empty road, no marching, no swinging, "
            "no extra soldiers, horns, clubs, or limbs, no shake, no morphing."
        ),
    },
    {
        "name": "53-ancient-prophecy-mural-v8",
        "seed": 8543,
        "prompt": (
            "The enormous carved prophecy mural remains perfectly rigid. Four separate clan medallions glow in a slow sequence, "
            "then a restrained warm line reaches the carved human and fox at the center while the horned upper relief stays dark. "
            "Braziers flicker, dust falls, and roots move barely perceptibly. Premium hand-painted anime environment. Smooth slow "
            "push toward the center carving, no living figures, no new symbols, no readable text, no bright energy, no shake, no morphing stone."
        ),
    },
    {
        "name": "54-elemental-seal-fracture-v8",
        "seed": 8554,
        "prompt": (
            "The one hairline crack advances slowly across the central floor seal while exactly four suspended stone rings "
            "remain aligned and rotate almost imperceptibly. Four separate colored light paths stay confined to their quadrants, "
            "waterfalls descend, candles flicker, and fine dust lifts from the floor. Premium theatrical anime environment. "
            "Smooth slow descent, no people or creatures, no explosion, no flying debris, no new cracks, no white-out, no camera shake, no morphing."
        ),
    },
    {
        "name": "55-rill-fox-aftermath-v8",
        "seed": 8565,
        "prompt": (
            "Rill and the single golden fox remain seated separately on the fortress steps and both continue looking toward "
            "the dawn. Rill breathes once without moving his two hands from his knees. The fox keeps one tail curled and moves "
            "only one ear and the tail tip. Ash falls, torn banners move, and dawn brightens slightly. Preserve anatomy and all "
            "silhouettes exactly. Premium hand-drawn anime aftermath. Stable slow pullback, no touching, turning, extra limbs "
            "or animals, no shake, no morphing."
        ),
    },
    {
        "name": "56-rill-oni-focus-v8",
        "seed": 8576,
        "prompt": (
            "Rill remains in the exact chest-up profile at frame right and keeps his eyes directed firmly to frame left toward "
            "the unseen oni. He blinks once and takes a small controlled breath while white hair and cloak edges move gently to "
            "the right. Embers drift through the left negative space. Preserve face, eyes, mouth, shoulders, and identity exactly. "
            "Premium theatrical hand-drawn anime close-up. Locked camera with an imperceptible push, no head turn, no looking at "
            "camera, no visible hands or weapon, no glowing eyes, no facial morphing, no shake."
        ),
    },
    {
        "name": "57-united-defenders-v8",
        "seed": 8587,
        "prompt": (
            "Exactly five adult defenders and one golden fox remain evenly separated on the battlement, all facing away toward "
            "the siege horizon. Every human keeps both feet planted and hands hidden; the fox keeps four paws planted and one tail. "
            "Exactly four banners move in the same wind, cloak hems shift slightly, smoke rises from distant fires, and dawn grows. "
            "Premium feature-film anime finale. Smooth slow crane backward, no turning, no weapons, no extra people or animals, "
            "no overlapping silhouettes, no duplicated tails or limbs, no camera shake, no morphing."
        ),
    },
    {
        "name": "58-sword-oni-reflection-v8",
        "seed": 8598,
        "prompt": (
            "The single perfectly straight sword remains motionless across the black-stone altar. The reflected two-horned oni "
            "silhouette and single club stay simple and centered while the distant doorway fire flickers. Fine ash drifts, cool "
            "light moves subtly along the blade, and the reflection shimmers by less than a pixel without changing shape. Premium "
            "theatrical anime insert. Smooth restrained focus shift from blade edge to reflection, no hands, no living figure entering, "
            "no extra weapon, no bent blade, no distorted silhouette, no camera shake, no morphing."
        ),
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=float, default=1.0)
    parser.add_argument("--steps", type=int, default=28)
    parser.add_argument("--teacache", action="store_true")
    parser.add_argument("--suffix", default="proof")
    parser.add_argument("--names", nargs="*")
    return parser.parse_args()


def render_scene(client: Client, scene: dict[str, object], args: argparse.Namespace) -> None:
    name = str(scene["name"])
    image_path = (IMAGES / f"{name}.png").resolve(strict=True)
    output_path = OUTPUTS / f"{name}-{args.suffix}.mp4"
    if output_path.exists():
        print(f"skip={name} existing={output_path}", flush=True)
        return

    started_wall_time = time.time()
    job = client.submit(
        handle_file(str(image_path)),
        str(scene["prompt"]),
        "",
        int(scene["seed"]),
        args.seconds,
        9,
        args.steps,
        1.0,
        10.0,
        0.0,
        6.0,
        args.teacache,
        14,
        api_name="/process",
    )

    started = time.monotonic()
    while not job.done():
        status = job.status()
        elapsed = time.monotonic() - started
        print(f"scene={name} elapsed={elapsed:.0f}s status={status.code}", flush=True)
        time.sleep(20)

    result = job.result()
    rendered_path = find_video_path(result)
    if rendered_path is None:
        candidates = [
            path for path in SERVER_OUTPUTS.glob("*.mp4") if path.stat().st_mtime >= started_wall_time
        ]
        if not candidates:
            raise RuntimeError(f"FramePack completed {name} without saving an MP4")
        rendered_path = max(candidates, key=lambda path: path.stat().st_mtime)

    OUTPUTS.mkdir(parents=True, exist_ok=True)
    shutil.copy2(rendered_path.resolve(strict=True), output_path)
    print(f"saved={output_path}", flush=True)


def main() -> None:
    args = parse_args()
    selected = set(args.names or [])
    scenes = [scene for scene in SCENES if not selected or str(scene["name"]) in selected]
    if not scenes:
        raise SystemExit("No scene names matched")
    OUTPUTS.mkdir(parents=True, exist_ok=True)
    client = Client("http://127.0.0.1:7861")
    for scene in scenes:
        render_scene(client, scene, args)
    print("batch_complete=true", flush=True)


if __name__ == "__main__":
    main()
