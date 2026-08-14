"""Render animation-stable replacement coverage for the V7 trailer cut."""

from __future__ import annotations

import argparse
import shutil
import time
from pathlib import Path

from gradio_client import Client, handle_file

from framepack_generate import find_video_path


ROOT = Path(r"C:\Users\Tyler R\source\repos\NinjaK")
IMAGES = ROOT / "tmp" / "trailer" / "cinematic"
OUTPUTS = ROOT / "output" / "trailer" / "framepack-v7"
SERVER_OUTPUTS = Path(r"C:\Users\Tyler R\.cache\FramePack\outputs")


SCENES = [
    {
        "name": "26-four-armies-formation-v7",
        "seed": 7261,
        "prompt": (
            "Exactly four separated rectangular army formations advance slowly and uniformly toward the distant "
            "central fortress along the four empty lanes. Every formation keeps its straight edges and spacing; "
            "no soldier approaches the camera. Clan banners wave gently, snow drifts sideways, sunrise clouds "
            "separate, distant volcano embers glow, and one small violet lightning pulse stays in the far mountains. "
            "Premium hand-painted anime war establishing shot. Smooth very slow forward aerial dolly, no shake, no "
            "blurred foreground people, no chaotic crowd motion, no new formations, no morphing architecture."
        ),
    },
    {
        "name": "27-rill-rooftop-sentry-v7",
        "seed": 7272,
        "prompt": (
            "Rill remains standing on the roof ridge with both feet planted and both arms relaxed. He takes one quiet "
            "breath and turns his eyes slightly toward the distant lightning without moving his legs. His white hair "
            "and torn cloak stream gently in one consistent wind direction; rain falls and lanterns flicker below. "
            "The single sheathed sword, body, face, hands, and roof remain rigid and anatomically identical. Premium "
            "hand-drawn anime character acting. Locked low camera with an imperceptible push, no running, jumping, "
            "camera shake, extra limbs, bent sword, sliding feet, or morphing."
        ),
    },
    {
        "name": "28-hollow-hunt-overlook-v7",
        "seed": 7283,
        "prompt": (
            "Rill and the single golden fox remain perfectly still and hidden on the upper stone overlook. Far below, "
            "the single violet Hollow hound lowers its head slightly toward the glowing footprints while staying on "
            "the road and facing away from the heroes. Fog flows down the ravine, pine branches sway, and the footprints "
            "pulse faintly toward the distance. Preserve the exact human, fox, one tail, hound, and road geometry. "
            "Premium hand-painted anime suspense. Locked high wide camera, no running, no reverse movement, no extra "
            "animals or limbs, no glowing mouth, no body overlap, no shake, no morphing."
        ),
    },
    {
        "name": "29-four-clan-council-v7",
        "seed": 7294,
        "prompt": (
            "Exactly four masked clan leaders remain motionless at the four cardinal positions around the circular "
            "war table, hands hidden inside crossed sleeves. The miniature fortress map brightens gently, four banners "
            "move slightly, candle flames flicker, and separate elemental light glows in each alcove. Masks, cloaks, "
            "table, and architecture never change shape. Premium hand-drawn anime strategy scene. Smooth restrained "
            "forward dolly from the high camera, no extra people, no visible hands, no weapons, no body overlap, no "
            "shake, no morphing."
        ),
    },
    {
        "name": "30-ancient-seal-chamber-v7",
        "seed": 7305,
        "prompt": (
            "The central stone seal and chamber remain perfectly rigid while exactly four suspended stone rings rotate "
            "very slowly around their own centers. The four waterfalls continue downward, mist curls through the lower "
            "chamber, candles flicker, and restrained cyan, orange, white, and violet light pulses in separate quadrants. "
            "Premium hand-painted anime mystical environment. Smooth slow descent down the stairs, no shake, no people "
            "or creatures, no new rings, no floating debris, no bright explosion, no morphing stone."
        ),
    },
    {
        "name": "31-ice-clan-citadel-v7",
        "seed": 7316,
        "prompt": (
            "The frozen citadel, chain bridge, cliff, and ice formations remain rigid. Fine snow crosses the empty bridge, "
            "fortress banners move gently, waterfalls descend into the blue crevasse, and clouds reveal a little more "
            "moonlight. Premium hand-painted anime establishing shot. Smooth restrained forward dolly centered along "
            "the bridge, no shake, no people entering frame, no collapsing bridge, no cracking or growing ice, no "
            "white-out blizzard, no morphing architecture."
        ),
    },
    {
        "name": "32-fire-clan-forge-city-v7",
        "seed": 7327,
        "prompt": (
            "The volcanic forge city and monumental central furnace remain perfectly rigid. Lava moves slowly through "
            "the channels, restrained sparks rise from the forge, dark smoke drifts upward, banners move in the hot wind, "
            "and the distant volcano glows without erupting toward camera. Tiny workers remain unreadable silhouettes. "
            "Premium hand-painted anime establishing shot. Smooth slow forward dolly, no shake, no close people, no "
            "fireball, no white-out, no collapsing or morphing buildings."
        ),
    },
    {
        "name": "33-wind-clan-sky-monastery-v7",
        "seed": 7338,
        "prompt": (
            "The sky monastery, stone spires, and empty bridges remain perfectly rigid. A sea of clouds flows slowly "
            "between the cliffs, long prayer ribbons stream in one consistent direction, bronze bells sway only a few "
            "degrees, and distant birds glide across the sunrise. Premium hand-painted anime establishing shot. Smooth "
            "slow forward crane above the empty bridge, no shake, no people, no tornado, no warped bridge, no morphing "
            "architecture, no overexposure."
        ),
    },
    {
        "name": "34-lightning-clan-citadel-v7",
        "seed": 7349,
        "prompt": (
            "The storm citadel, canyon bridges, and exactly four main lightning towers remain rigid. Rain falls, clouds "
            "roll slowly, warm windows flicker, and the controlled violet arcs between neighboring towers pulse once "
            "without changing their path or filling the frame. Premium hand-painted anime establishing shot. Smooth "
            "restrained forward dolly from the empty overlook, no shake, no people, no new towers, no white-out lightning, "
            "no collapsing or morphing architecture."
        ),
    },
    {
        "name": "35-oni-shadow-gate-v7",
        "seed": 7360,
        "prompt": (
            "The sealed fortress gate and the single two-horned oni shadow remain monumental and readable. Firelight "
            "behind the unseen oni flickers so the shadow edges breathe subtly, but the two horns, shoulders, and one "
            "separate club keep their exact silhouette. Embers rise and tiny wall guards remain still. Premium hand-drawn "
            "anime villain omen. Locked symmetrical low camera with a very slow push, no visible oni body, no extra horns "
            "or clubs, no giant flame, no shake, no morphing gate or shadow."
        ),
    },
    {
        "name": "36-fallen-shinobi-memorial-v7",
        "seed": 7371,
        "prompt": (
            "Rill and the single golden fox remain side-by-side facing the memorial statue. Rill takes one quiet breath; "
            "his cloak edge moves gently. The seated fox stays planted and moves only one ear and the tip of its single "
            "tail. Snow falls through the broken roof and the central lantern flickers. Preserve all silhouettes, statue, "
            "tablets, paws, and feet exactly. Premium hand-drawn anime emotional scene. Stable slow camera push, no "
            "turning around, no visible hands, no extra people or animals, no body overlap, no shake, no morphing."
        ),
    },
    {
        "name": "37-fox-lantern-shrine-v7",
        "seed": 7382,
        "prompt": (
            "The single golden ninja fox stays standing on all four planted paws. It breathes subtly, blinks once, and "
            "raises both ears toward the distant violet glow while its red scarf moves behind the closed muzzle. Exactly "
            "one tail sways gently; fog slides along the stone path and lantern flames flicker. Preserve the fox face, "
            "four paws, two ears, one tail, forehead protector, and shrine geometry. Premium hand-drawn anime character "
            "acting. Locked low camera, no walking or running, no extra animals or limbs, no glowing mouth, no shake, no morphing."
        ),
    },
    {
        "name": "38-broken-bridge-standoff-v7",
        "seed": 7393,
        "prompt": (
            "Rill and the single masked rival remain planted on opposite ends of the broken bridge, separated by the large "
            "empty gap. Both lowered straight swords remain rigid and away from their bodies. Cloaks and banners move in "
            "one wind direction, canyon fog rises, and distant lightning pulses once. Premium hand-drawn anime duel setup. "
            "Smooth very slow lateral drift, no shake, no attack, no running or jumping, no crossed swords, no extra "
            "people or limbs, no sliding feet, no morphing characters or bridge."
        ),
    },
    {
        "name": "39-elemental-eclipse-v7",
        "seed": 7404,
        "prompt": (
            "The distant central fortress remains perfectly rigid beneath the elemental eclipse. The one circular sky seal "
            "rotates almost imperceptibly while exactly four separate elemental streams flow along their existing paths: "
            "orange fire, blue ice, pale wind, and restrained violet lightning. Clouds orbit slowly without covering the "
            "fortress. Premium hand-painted anime cosmic establishing shot. Smooth slow forward push, no shake, no people "
            "or creatures, no new symbols, no tangled energy, no white-out, no morphing architecture."
        ),
    },
    {
        "name": "40-rill-fox-summit-v7",
        "seed": 7415,
        "prompt": (
            "Rill and the single golden fox remain separated at the mountain shrine edge, facing the sunrise. Rill's planted "
            "feet and hidden arms do not move; his torn cloak streams gently. The fox stays on four planted paws while its "
            "red scarf and single tail tip move in the same wind. Storm clouds open gradually over the distant four villages "
            "and small birds cross the dawn. Premium hand-drawn anime final promise shot. Smooth restrained crane backward, "
            "no shake, no turning, no extra people or animals, no visible hands, no duplicated tails, no morphing."
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
