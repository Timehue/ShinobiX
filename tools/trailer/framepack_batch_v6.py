"""Render conservative, animation-stable inserts for the V6 trailer cut."""

from __future__ import annotations

import argparse
import shutil
import time
from pathlib import Path

from gradio_client import Client, handle_file

from framepack_generate import find_video_path


ROOT = Path(r"C:\Users\Tyler R\source\repos\NinjaK")
IMAGES = ROOT / "tmp" / "trailer" / "cinematic"
OUTPUTS = ROOT / "output" / "trailer" / "framepack-v6"
SERVER_OUTPUTS = Path(r"C:\Users\Tyler R\.cache\FramePack\outputs")


SCENES = [
    {
        "name": "20-hero-blade-draw-v6",
        "seed": 6201,
        "prompt": (
            "One black-gloved hand slowly pulls the single katana blade two inches farther from its rigid black "
            "scabbard, then stops. The hand, five fingers, guard, hilt, blade, and scabbard preserve their exact "
            "shape and position. One tiny steel spark fades at the guard. Rain falls diagonally and distant "
            "lantern bokeh flickers. Premium hand-drawn anime feature-film insert. Locked macro camera, no shake, "
            "no zoom, no extra hands, no extra weapons, no bending or melting metal, no morphing."
        ),
    },
    {
        "name": "21-fox-ready-close-v6",
        "seed": 6212,
        "prompt": (
            "The single golden ninja fox holds its battle crouch, breathes subtly, blinks once, and tips both ears "
            "forward while its red scarf moves gently behind its closed muzzle. The face, forehead protector, two "
            "eyes, two ears, four paws, and one tail remain identical and anatomically consistent. Rain falls and "
            "moonlit clouds drift slowly. Premium hand-drawn anime character acting. Locked low camera, no shake, "
            "no zoom, no glowing mouth, no extra animals or limbs, no running, no morphing."
        ),
    },
    {
        "name": "22-elemental-impact-v6",
        "seed": 6223,
        "prompt": (
            "The single orange fire wave and single blue-white ice wall press against each other at the clean center "
            "seam. Fire rolls forward in broad layers, small ice fragments shear away, and steam rises vertically "
            "without obscuring the fortress or filling the frame. The bridge and architecture remain rigid. Tiny "
            "distant banners move in the wind. Premium hand-drawn anime war effects animation. Stable very-wide "
            "camera with a barely perceptible forward push, no shake, no people in the foreground, no creature "
            "shapes, no white-out, no morphing architecture."
        ),
    },
    {
        "name": "23-oni-threat-close-v6",
        "seed": 6234,
        "prompt": (
            "The single red oni remains chest-up and motionless except for slow heavy breathing, one deliberate "
            "blink, and a slight narrowing of both eyes. Its mouth stays closed. The two gold horns, face, shoulders, "
            "armor, and one rigid iron club behind its shoulders never change shape. Black mane tips and a few "
            "embers move gently in the hot wind. Premium hand-drawn anime villain acting. Locked centered camera, "
            "no shake, no zoom, no roar, no extra heads, horns, limbs, teeth, or clubs, no morphing."
        ),
    },
    {
        "name": "24-siege-banners-v6",
        "seed": 6245,
        "prompt": (
            "The empty causeway and central fortress remain perfectly rigid while exactly four large clan banners "
            "wave slowly in the same wind. Clouds separate around the sunrise, one distant meteor crosses near the "
            "volcano, and violet lightning pulses once far behind the right mountains. Premium hand-painted anime "
            "establishing-shot animation. Smooth restrained forward dolly, no shake, no people entering frame, no "
            "new banners, no collapsing or morphing architecture, no white-out."
        ),
    },
    {
        "name": "25-rill-fox-resolve-v6",
        "seed": 6256,
        "prompt": (
            "Rill and the single golden ninja fox remain side-by-side in matching three-quarter profile. Rill takes "
            "one quiet breath and blinks once; the fox blinks once and raises one ear slightly. Rill's white hair, "
            "torn cloak edge, and the fox's red scarf drift gently toward the same side. Both closed mouths, faces, "
            "eyes, ears, clothing, and scale remain identical. Distant storm clouds open around the dawn. Premium "
            "hand-drawn anime character acting. Stable medium close camera with a very gentle push, no shake, no "
            "weapons or hands entering frame, no extra characters, no glowing mouths, no morphing."
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
