"""Render the remaining Shinobi Journey cinematic shots through local FramePack."""

from __future__ import annotations

import shutil
import time
from pathlib import Path

from gradio_client import Client, handle_file

from framepack_generate import find_video_path


ROOT = Path(r"C:\Users\Tyler R\source\repos\NinjaK")
IMAGES = ROOT / "tmp" / "trailer" / "cinematic"
OUTPUTS = ROOT / "output" / "trailer" / "framepack-scenes"
SERVER_OUTPUTS = Path(r"C:\Users\Tyler R\.cache\FramePack\outputs")


SCENES = [
    {
        "name": "01-rill-overlook",
        "seconds": 1.0,
        "seed": 1101,
        "prompt": (
            "The white-haired shinobi stands on the high cliff overlooking the hidden village. "
            "He slowly raises his head with quiet resolve and tightens his hand around the sword hilt. "
            "His long torn cloak and white hair stream naturally in the mountain wind while clouds roll "
            "through the valley, banners ripple below, and tiny birds cross the sunrise. Premium hand-drawn "
            "anime feature-film animation, coherent anatomy, restrained heroic acting. A very slow steady "
            "cinematic push-in with no shake, no jitter, and no sudden zoom."
        ),
    },
    {
        "name": "02-inferno-awakening",
        "seconds": 2.4,
        "seed": 2202,
        "prompt": (
            "The white-haired shinobi steps forward and snaps into a combat stance as a violent orange fire "
            "aura erupts around his body. He turns his shoulders, draws one arm back, and thrusts the other hand "
            "forward while burning embers spiral around him. Flames lash upward, hot wind drives his cloak and "
            "hair, and the ground cracks with molten light. Premium hand-drawn anime feature-film transformation "
            "scene, strong readable pose changes, coherent hands and limbs, continuous motion. Stable low-angle "
            "camera with a gentle push-in, no shake and no jitter."
        ),
    },
    {
        "name": "04-inferno-jutsu",
        "seconds": 2.4,
        "seed": 4404,
        "prompt": (
            "The white-haired shinobi completes a rapid hand sign, plants his forward foot, and forcefully casts "
            "a fire jutsu. The molten stone ring behind him rotates and bursts outward, flaming rocks arc through "
            "the air, nearby ice fractures, and sparks streak past camera. His arms and torso move through a clear "
            "attack sequence while his cloak whips from the blast. Premium hand-drawn anime feature-film combat "
            "animation, coherent anatomy, crisp silhouettes and continuous action. Smooth controlled arc camera, "
            "no shake, no jitter, no random zoom."
        ),
    },
    {
        "name": "05-four-village-war",
        "seconds": 2.4,
        "seed": 5505,
        "prompt": (
            "Four shinobi armies charge and collide across the battlefield in organized waves. Foreground fighters "
            "sprint, leap, block swords, and cast elemental techniques while banners snap in the storm. An ice wall "
            "surges from the left, a fire wave rolls from the rear, a wind vortex turns at center, and purple "
            "lightning strikes on the right. Premium hand-drawn anime war-film animation with layered continuous "
            "action and readable silhouettes. Smooth elevated tracking camera, controlled motion only, no shake, "
            "no jitter, and no chaotic camera spins."
        ),
    },
    {
        "name": "06-rill-lightning-fox",
        "seconds": 2.4,
        "seed": 6606,
        "prompt": (
            "The white-haired shinobi and the golden ninja fox explode forward together from their crouched stance. "
            "The hero drives into a fast sprint and draws his sword as the fox launches beside him with a complete "
            "galloping stride. Golden lightning races across the stone, debris lifts, cloak and scarf stream behind "
            "them, and both characters surge directly into battle. Premium hand-drawn anime feature-film hero shot, "
            "clear changing poses, coherent faces and limbs, continuous powerful motion. Smooth forward tracking "
            "camera at ground level with no shake, no jitter, and no sudden zoom."
        ),
    },
    {
        "name": "07-oni-confrontation",
        "seconds": 2.4,
        "seed": 7707,
        "prompt": (
            "The colossal red oni roars, raises its huge iron club over one shoulder, and swings downward with brutal "
            "weight. The white-haired shinobi pivots aside, slides under the strike, and brings his sword up into guard. "
            "The impact throws stone fragments, embers, and chains through the air while the oni hair and banners lash "
            "in the blast. Premium hand-drawn anime feature-film boss battle, readable attack and dodge, coherent scale "
            "and anatomy, continuous motion. Stable dramatic low camera with one smooth lateral move, no shake, no "
            "jitter, and no random reframing."
        ),
    },
    {
        "name": "08-worldstorm-tower",
        "seconds": 1.0,
        "seed": 8808,
        "prompt": (
            "A colossal supernatural storm awakens around the ancient shinobi tower. The tornado rotates steadily, "
            "storm clouds coil overhead, lightning branches across the sky, banners whip hard in the wind, waterfalls "
            "surge, and glowing energy travels up the tower. Tiny shinobi race across the bridge toward the entrance. "
            "Premium hand-drawn anime feature-film world reveal with continuous environmental animation. Slow stable "
            "aerial push toward the tower, no shake, no jitter, and no sudden zoom."
        ),
    },
    {
        "name": "09-hollow-gate-finale",
        "seconds": 2.4,
        "seed": 9909,
        "prompt": (
            "The enormous cursed gate grinds open and purple-black mist pours across the ground. Shadow creatures "
            "advance from the darkness as glowing runes ignite one after another. The white-haired shinobi steps forward, "
            "draws his sword in one clean motion, and braces against the incoming force while his cloak lashes backward. "
            "Premium hand-drawn anime feature-film finale, coherent hero anatomy, readable monster movement, continuous "
            "mist and debris. Slow controlled push toward the hero and gate, no shake, no jitter, no sudden zoom."
        ),
    },
]


def render_scene(client: Client, scene: dict[str, object]) -> None:
    name = str(scene["name"])
    image_path = (IMAGES / f"{name}.png").resolve(strict=True)
    output_path = OUTPUTS / f"{name}.mp4"
    if output_path.exists():
        print(f"skip={name} existing={output_path}", flush=True)
        return

    started_wall_time = time.time()
    job = client.submit(
        handle_file(str(image_path)),
        str(scene["prompt"]),
        "",
        int(scene["seed"]),
        float(scene["seconds"]),
        9,
        25,
        1.0,
        10.0,
        0.0,
        6.0,
        True,
        16,
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
            path
            for path in SERVER_OUTPUTS.glob("*.mp4")
            if path.stat().st_mtime >= started_wall_time
        ]
        if not candidates:
            raise RuntimeError(f"FramePack completed {name} without saving an MP4")
        rendered_path = max(candidates, key=lambda path: path.stat().st_mtime)

    OUTPUTS.mkdir(parents=True, exist_ok=True)
    shutil.copy2(rendered_path.resolve(strict=True), output_path)
    print(f"saved={output_path}", flush=True)


def main() -> None:
    OUTPUTS.mkdir(parents=True, exist_ok=True)
    client = Client("http://127.0.0.1:7861")
    for scene in SCENES:
        render_scene(client, scene)
    print("batch_complete=true", flush=True)


if __name__ == "__main__":
    main()
