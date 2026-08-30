"""Generate the accepted V26 one-window Rill animation coverage with FramePack."""

from __future__ import annotations

import argparse
import shutil
import time
from dataclasses import dataclass
from pathlib import Path

from gradio_client import Client, handle_file

from framepack_generate import find_video_path


QUALITY = (
    "Premium theatrical hand-drawn anime feature animation with clear continuous subject motion. "
    "Preserve exact character identities, faces, white hair, ice-blue eyes, costume shapes, anatomy, "
    "body count, environment geometry, and lighting from the source frame. Stable linework. "
    "No text, logos, extra characters, duplicate bodies, extra limbs, face drift, costume change, "
    "flicker, camera shake, melting, warping, morphing, or anatomy overlap. "
)


@dataclass(frozen=True)
class Scene:
    name: str
    image: str
    seed: int
    action: str


SCENES = [
    Scene(
        "001-meter-awakening-v26",
        "tmp/trailer/cinematic-v25/002-rill-meter-discovery-v25.png",
        26101,
        (
            "Rill presses his existing palm firmly into the frozen identity meter. Its main needle snaps from zero "
            "and rotates clockwise, inner rings turn, and one crack races across the glass. Rill braces against a "
            "blue pulse; white hair, coat tails, and black fur mantle whip backward. The spectral ice wolf reflection "
            "opens its eyes. Snow and loose frost burst toward camera. Restrained clockwise camera arc around Rill."
        ),
    ),
    Scene(
        "002-rill-wolf-step-v26",
        "tmp/trailer/cinematic-v25/001-rill-character-anchor-v25.png",
        26102,
        (
            "Rill takes one deliberate full step toward camera, shoulders settling into a combat-ready posture. "
            "His white coat tails, black fur mantle, hair, and drifting snow move with the step. The single spectral "
            "ice wolf behind him coils from left to right and lowers its head beside his shoulder. Smooth low tracking "
            "push toward Rill; his face remains focused and unchanged."
        ),
    ),
    Scene(
        "003-sunken-court-awakens-v26",
        "tmp/trailer/cinematic-v25/003-sunken-court-reveal-v25.png",
        26103,
        (
            "The immense Sunken Court machinery visibly activates: four monumental outer intake rings rotate in "
            "different directions, their blue, orange, violet, and white energy streams accelerate into the central "
            "verdict engine, and the central iris opens. Rill and his one spectral wolf remain readable on the bridge "
            "as coat and fur react to the energy wind. Strong controlled camera descent toward the engine; falling "
            "water, sparks, steam, and snow crystals move throughout the depth."
        ),
    ),
    Scene(
        "004-rill-close-resolve-v26",
        "tmp/trailer/cinematic-v25/005-rill-final-close-v25.png",
        26104,
        (
            "Rill begins looking slightly downward, then lifts his chin and fixes his ice-blue eyes directly past "
            "camera with controlled resolve. He blinks once and exhales a visible cold breath. Fine white hair and "
            "black fur move in a steady wind; frost fractures creep subtly across his cheek and the spectral wolf eye "
            "brightens behind him. Slow intimate camera push, natural facial acting, no smile or rage."
        ),
    ),
    Scene(
        "005-rill-dash-v26",
        "tmp/trailer/framepack-v26/001-rill-kael-frames/00.png",
        26105,
        (
            "Rill drives explosively out of his low stance and dashes two steps toward Hollow Kael. His planted rear "
            "foot pushes off, torso leans forward, arms balance the acceleration, and his coat tails and hair stream "
            "backward. Kael tightens his guard and shifts weight onto the rear foot. The single ice wolf chakra arc "
            "follows Rill. Fast lateral tracking camera with strong parallax and blowing snow."
        ),
    ),
    Scene(
        "006-rill-kick-impact-v26",
        "tmp/trailer/framepack-v26/001-rill-kael-frames/01.png",
        26106,
        (
            "Rill completes the existing airborne side kick with a visible hip extension and then begins retracting "
            "the leg. Hollow Kael's crossed guard absorbs the strike and his upper body recoils backward. The contact "
            "point emits one expanding circular ice-water shockwave; ice shards, hair, white coat tails, black fur, and "
            "Kael's robes move violently. Fast push into impact, exactly one Rill and one Kael."
        ),
    ),
    Scene(
        "007-rill-landing-rise-v26",
        "tmp/trailer/framepack-v26/001-rill-kael-frames/03.png",
        26107,
        (
            "Rill rises from the existing three-point landing into a low ready stance, sliding his forward boot a few "
            "inches across wet stone. Hollow Kael remains down behind him and pushes backward on one hand. Rill's coat "
            "tails settle, his hair moves, the ice wolf chakra coils around his shoulders, and broken ice skitters "
            "across the floor. Smooth low orbit from Rill's planted hand toward his face."
        ),
    ),
]


def render_scene(
    client: Client,
    scene: Scene,
    root: Path,
    server_outputs: Path,
    output_dir: Path,
    seconds: float,
    steps: int,
    teacache: bool,
    force: bool,
) -> None:
    source = (root / scene.image).resolve(strict=True)
    destination = output_dir / f"{scene.name}.mp4"
    if destination.exists() and destination.stat().st_size > 100_000 and not force:
        print(f"skip={scene.name} existing={destination}", flush=True)
        return

    started_wall_time = time.time()
    job = client.submit(
        handle_file(str(source)),
        QUALITY + scene.action,
        "",
        scene.seed,
        seconds,
        9,
        steps,
        1.0,
        10.0,
        0.0,
        6.0,
        teacache,
        14,
        api_name="/process",
    )
    started = time.monotonic()
    while not job.done():
        print(
            f"scene={scene.name} elapsed={time.monotonic() - started:.0f}s status={job.status().code}",
            flush=True,
        )
        time.sleep(20)

    result = job.result()
    rendered = find_video_path(result)
    if rendered is None:
        candidates = [
            path for path in server_outputs.glob("*.mp4") if path.stat().st_mtime >= started_wall_time
        ]
        if not candidates:
            raise RuntimeError(f"FramePack completed {scene.name} without an MP4")
        rendered = max(candidates, key=lambda path: path.stat().st_mtime)
    shutil.copy2(rendered.resolve(strict=True), destination)
    print(f"saved={destination}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--server", default="http://127.0.0.1:7861")
    parser.add_argument("--seconds", type=float, default=1.0)
    parser.add_argument("--steps", type=int, default=18)
    parser.add_argument("--teacache", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--names", nargs="*")
    parser.add_argument(
        "--server-outputs",
        type=Path,
        default=Path(r"C:\Users\Tyler R\.cache\FramePack\outputs"),
    )
    args = parser.parse_args()

    root = args.root.resolve()
    output_dir = root / "output" / "trailer" / "framepack-v26"
    output_dir.mkdir(parents=True, exist_ok=True)
    server_outputs = args.server_outputs.resolve(strict=True)
    selected = set(args.names or [])
    scenes = [scene for scene in SCENES if not selected or scene.name in selected]
    if not scenes:
        raise SystemExit("No scene names matched")

    client = Client(args.server)
    for index, scene in enumerate(scenes, start=1):
        print(f"batch={index}/{len(scenes)} scene={scene.name}", flush=True)
        render_scene(
            client,
            scene,
            root,
            server_outputs,
            output_dir,
            args.seconds,
            args.steps,
            args.teacache,
            args.force,
        )
    print("batch_complete=true", flush=True)


if __name__ == "__main__":
    main()
