"""Render and quality-gate the new Shinobi Journey V5 cinematic shots."""

from __future__ import annotations

import argparse
import shutil
import time
from pathlib import Path

from gradio_client import Client, handle_file

from framepack_generate import find_video_path


ROOT = Path(r"C:\Users\Tyler R\source\repos\NinjaK")
IMAGES = ROOT / "tmp" / "trailer" / "cinematic"
OUTPUTS = ROOT / "output" / "trailer" / "framepack-v5"
SERVER_OUTPUTS = Path(r"C:\Users\Tyler R\.cache\FramePack\outputs")


SCENES = [
    {
        "name": "11-rill-fox-bond-v5",
        "seed": 5111,
        "prompt": (
            "At the snowy mountain shrine, the white-haired shinobi slowly lowers his forehead to the golden "
            "fox companion. The fox closes its eyes and gently leans into both of his hands. His cloak and the "
            "fox scarf move softly in the dawn wind while a few snowflakes drift past. Exactly one human and one "
            "fox remain anatomically consistent. Premium hand-drawn anime feature-film acting, subtle breathing "
            "and emotional character motion. Locked stable medium-wide camera, no shake, no zoom, no morphing."
        ),
    },
    {
        "name": "12-rooftop-duel-v5",
        "seed": 5122,
        "prompt": (
            "Two shinobi strain against a single locked sword clash on the rainy rooftop. The white-haired hero "
            "steps forward and pushes while the one masked rival slides one foot back, then both cleanly separate "
            "their blades by a few inches and hold guard. Each fighter keeps exactly one complete katana held in "
            "both hands; faces, hands, bodies, and swords remain consistent. Rain falls and one lightning flash "
            "lights the clouds. Premium hand-drawn anime duel animation. Stable lateral camera, no shake, no spin, "
            "no extra people, no extra weapons, no morphing."
        ),
    },
    {
        "name": "13-oni-dodge-v5",
        "seed": 5133,
        "prompt": (
            "The colossal red oni completes one powerful horizontal swing with its single two-handed iron club "
            "while the white-haired shinobi slides cleanly under the weapon and turns his one katana into guard. "
            "The entire club remains visible from handle to spiked tip and never changes shape; the oni keeps two "
            "hands on it. Both characters preserve their bodies, faces, clothing, limbs, and scale. A small trail "
            "of embers and dust follows the swing without hiding either subject. Premium hand-drawn anime boss "
            "fight animation. Stable wide side camera, no shake, no zoom, no extra limbs, no extra weapons."
        ),
    },
    {
        "name": "14-ice-champion-v5",
        "seed": 5144,
        "prompt": (
            "The lone ice champion drives her open palm firmly into the cracked courtyard and the single blue-white "
            "ice wave grows forward in one clean line. Her free arm counterbalances, braid and cloth move in the cold "
            "wind, and small ice fragments slide away from the impact. Exactly one character remains anatomically "
            "consistent with both hands visible. Premium hand-drawn anime elemental combat animation. Stable low "
            "camera, no shake, no zoom, no extra people, no morphing, no ice covering her face or body."
        ),
    },
    {
        "name": "15-fire-champion-v5",
        "seed": 5155,
        "prompt": (
            "The lone fire champion rotates his shoulders, draws his flaming fist back, and throws one controlled "
            "forward punch. The single fire ring behind him rotates and sheds embers while remaining behind his body. "
            "Exactly one character stays anatomically consistent with both hands, face, and full body readable. "
            "Premium hand-drawn anime elemental combat animation. Stable medium-wide camera, no shake, no zoom, no "
            "extra people, no morphing, and no flame covering his face."
        ),
    },
    {
        "name": "16-wind-champion-v5",
        "seed": 5166,
        "prompt": (
            "The lone wind champion slowly sweeps both open hands outward as the one pale-gold tornado behind him "
            "turns steadily. His layered cloth and the distant banners flow in one consistent direction while he "
            "plants both feet and lifts his gaze. Exactly one character remains anatomically consistent with both "
            "hands visible. Premium hand-drawn anime elemental mastery animation. Locked stable medium-wide camera, "
            "no shake, no zoom, no extra people, no morphing, and no tornado crossing his body."
        ),
    },
    {
        "name": "17-lightning-champion-v5",
        "seed": 5177,
        "prompt": (
            "The lone lightning assassin lifts her head from the three-point landing and rises smoothly into guard "
            "with her single short blade. The one violet lightning bolt behind her pulses once while rain splashes "
            "on the terrace. Her body, hands, face, ponytail, and weapon remain consistent and fully readable. Premium "
            "hand-drawn anime arrival animation. Stable low camera, no shake, no zoom, no extra people, no extra "
            "weapons, no morphing, and no lightning crossing her body."
        ),
    },
    {
        "name": "18-hollow-chase-v5",
        "seed": 5188,
        "prompt": (
            "The white-haired shinobi and the small golden ninja fox sprint left together in clear running cycles "
            "across the stone bridge while one giant spectral purple hound gallops behind them. Exactly one human, "
            "one fox, and one four-legged spectral hound remain separated and anatomically consistent. Cloak, scarf, "
            "fur, and purple energy trail backward; low fog stays below their feet. Premium hand-drawn anime chase "
            "animation. Smooth stable side-tracking camera, no shake, no zoom, no extra animals, no morphing."
        ),
    },
    {
        "name": "19-final-launch-v5",
        "seed": 5199,
        "prompt": (
            "At the fortress edge, the white-haired shinobi and golden ninja fox lower into a launch stance, exchange "
            "one determined glance, and drive one step forward together. The hero keeps exactly one complete katana "
            "low at his side; the fox stays on four readable paws. Their faces, bodies, clothing, weapon, and scale "
            "remain consistent while the four distant elemental regions move only in the far background. Premium "
            "hand-drawn anime finale animation. Stable heroic low camera with a gentle push, no shake, no sudden zoom, "
            "no overexposure, no extra characters, no morphing."
        ),
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=float, default=1.0)
    parser.add_argument("--steps", type=int, default=25)
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
