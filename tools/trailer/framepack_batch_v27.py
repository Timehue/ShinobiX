"""Generate the Frostfang story shots for the V27 Rill trailer."""

from __future__ import annotations

import argparse
from pathlib import Path

from gradio_client import Client

from framepack_batch_v26 import Scene, render_scene


SCENES = [
    Scene(
        "001-rill-plate-name-v27",
        "tmp/trailer/cinematic-v27/001-rill-plate-v27.png",
        27101,
        (
            "Rill keeps his palm pressed firmly against the existing identity plate. Frost races outward from beneath "
            "his hand in branching lines and the single ghostly old figure inside the glass becomes clearer, then turns "
            "its head toward him. Rill's eyes track the reflection and his breath catches. Captain Yura recoils half a "
            "step and raises her existing open hand in a sharp stop signal. Their faces, costumes, hands, body count and "
            "positions remain exact. Snow crosses the frame, lanterns sway, hair and fur respond to the wind. Slow "
            "controlled push toward the hand and reflection; no attack and no new character."
        ),
    ),
    Scene(
        "002-kael-carries-shepherd-v27",
        "tmp/trailer/cinematic-v27/002-kael-rescue-v27.png",
        27102,
        (
            "Kael takes two heavy deliberate steps forward through the existing whiteout while securely carrying the "
            "one unconscious shepherd. His shoulders rise with effort, the shepherd's cold breath appears once, and "
            "the trailing rescue rope drags and tightens through snow. Kael's hat, long white hair, fur mantle and robes "
            "whip in the wind while his face stays exhausted and determined. The gate lantern flickers warmer as they "
            "approach and the great bell moves slightly. Smooth camera retreat matching his steps; exact two people, "
            "stable carrying anatomy, no magic or transformation."
        ),
    ),
    Scene(
        "003-white-silence-reveal-v27",
        "tmp/trailer/cinematic-v27/003-white-silence-v27.png",
        27103,
        (
            "The camera slowly advances between Rill and Captain Yura toward the frozen rows. Rill's existing left fist "
            "tightens once at his side and his shoulders lower in shock. Yura turns her head a few degrees toward the "
            "teenage boy, then becomes still. The single spectral wolf pulls its ears back and dims. All frozen citizens "
            "remain rigid prisoners with distinct faces and bodies while fresh frost creeps subtly over their clothing. "
            "Snow falls, the aurora moves slowly, and the fallen lantern flame dies completely. Preserve every foreground "
            "identity and body count; quiet horror, no crowd walking, no morphing."
        ),
    ),
    Scene(
        "004-yura-breaks-mark-v27",
        "tmp/trailer/cinematic-v27/004-yura-removes-mark-v27.png",
        27104,
        (
            "Captain Yura steadily pulls the existing translucent frost-script band the last few inches away from her "
            "bandaged wrist. The strip cracks into a few small ice motes and dissolves above the table. She flexes the "
            "bare wrist once, controls a flash of pain, and lifts her eyes to Rill with calm defiance. Rill watches her "
            "hand, then meets her eyes and gives one restrained nod. The oil lamp flickers, cold breath enters through "
            "the doorway, hair and fur move slightly. Intimate locked camera with a very slow push; exact two people, "
            "stable hands, no wound growth, no romance."
        ),
    ),
    Scene(
        "005-meter-zero-faceoff-v27",
        "tmp/trailer/cinematic-v27/005-rill-kael-meter-zero-v27.png",
        27105,
        (
            "The great existing meter needle shudders through its final fraction and stops hard at zero. Kael's open "
            "hand lowers slightly toward the meter as the existing ice oath script advances one inch along his jaw and "
            "crystalline arm; his human face remains exhausted and recognizable. Rill raises Dren's one warm relay "
            "lantern between them, and its flame grows brighter without changing shape. Rill's coat, Kael's robes, vapor "
            "and the single wolf reflection move in the pressure draft. Slow low camera creep inward, exact one Rill and "
            "one Kael, no attack yet, stable faces and costumes."
        ),
    ),
    Scene(
        "006-rill-keeps-flame-v27",
        "tmp/trailer/cinematic-v27/006-rill-protects-flame-v27.png",
        27106,
        (
            "The existing jagged ice wave surges forcefully from Kael across the floor toward Rill. Rill completes one "
            "fast low lateral wolf-step around its leading edge while keeping both arms tight around the single warm "
            "relay lantern; the flame bends violently but does not go out. His planted hand pushes off the floor, coat "
            "and black fur snap with acceleration, and the single ice-wolf chakra form lunges with him. Kael drives his "
            "crystalline arm forward and braces behind the wave while remaining separate and recognizable. Strong "
            "sideways tracking camera, ice shards and floor spray, exact two humans, no duplicates or anatomy overlap."
        ),
    ),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--server", default="http://127.0.0.1:7861")
    parser.add_argument("--seconds", type=float, default=1.5)
    parser.add_argument("--steps", type=int, default=20)
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
    output_dir = root / "output" / "trailer" / "framepack-v27"
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
