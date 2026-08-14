"""Render the unique replacement animations for the V9 trailer cut."""

from __future__ import annotations

import argparse
import shutil
import time
from pathlib import Path

from gradio_client import Client, handle_file

from framepack_generate import find_video_path


ROOT = Path(r"C:\Users\Tyler R\source\repos\NinjaK")
IMAGES = ROOT / "tmp" / "trailer" / "cinematic-v9"
OUTPUTS = ROOT / "output" / "trailer" / "framepack-v9"
SERVER_OUTPUTS = Path(r"C:\Users\Tyler R\.cache\FramePack\outputs")


QUALITY = (
    "Premium theatrical hand-drawn anime feature animation, restrained physically coherent motion, "
    "stable linework and lighting. Preserve the exact character identities, costume details, anatomy, "
    "body count, animal count, weapons, and environment from the source frame. No text, logos, symbols, "
    "new objects, duplicated bodies, extra limbs, extra tails, camera shake, flicker, warping, or morphing. "
)


SCENES = [
    {
        "name": "59-rill-fox-lantern-bare-v9",
        "seed": 9059,
        "prompt": QUALITY
        + (
            "Rill stays crouched at frame left and the one golden fox stays at frame right, both watching the "
            "distant violet light. Rill takes one quiet breath and blinks once; his hair moves slightly. The fox's "
            "ears tilt, red neck scarf and single tail tip move gently, while its forehead remains completely bare "
            "with no band, plate, strap, glyph, or marking. Lantern flames flicker and thin mist drifts uphill. "
            "Smooth slow forward push, no walking, no paw or hand movement."
        ),
    },
    {
        "name": "60-fox-battle-charge-v9",
        "seed": 9060,
        "prompt": QUALITY
        + (
            "The one golden fox continues its existing controlled leap a few inches from left to right toward the "
            "single Hollow hound. Rill follows with exactly one short forward step while keeping his sword silhouette "
            "rigid and safely separated. The hound lowers its stance without lunging. The fox keeps four legs, one tail, "
            "and a completely bare forehead with no headwear or mark. Energy trails, scarf, hair, embers, and ground mist "
            "move clearly. Smooth camera truck to the right; no collision, spinning, gait loop, or anatomy change."
        ),
    },
    {
        "name": "61-fox-golden-shield-v9",
        "seed": 9061,
        "prompt": QUALITY
        + (
            "The kneeling Rill remains wounded and still while the single golden fox holds its existing natural front paw "
            "in the same pose. The circular golden shield visibly brightens and sends two smooth ripples outward. Rain runs "
            "down the shield, sparks scatter, and the two distant allies steady their cloaks. The fox's forehead remains "
            "completely bare and its paw shape stays fixed. Rill breathes once. Smooth slow push toward the shield; no hand, "
            "paw, face, weapon, or body morphing."
        ),
    },
    {
        "name": "62-rooftop-duel-impact-v9",
        "seed": 9062,
        "prompt": QUALITY
        + (
            "Rill at left and the masked rival at right remain in their exact opposing stances with one sword each. Their "
            "two rigid blades stay locked at the single existing contact point while both fighters visibly push against it "
            "without changing foot placement. A strong burst of sparks travels outward; rain, hair, sashes, and coat hems "
            "move in consistent wind. Smooth shallow cinematic orbit around the contact point, no attack swing, no sliding, "
            "no extra blade, no hand or face deformation."
        ),
    },
    {
        "name": "63-squad-frost-titan-v9",
        "seed": 9063,
        "prompt": QUALITY
        + (
            "Exactly four heroes remain separated in the foreground facing the one colossal frost titan. The titan slowly "
            "raises its single ice hammer only a few degrees while keeping both feet planted. Frost falls from its shoulders, "
            "snow blows across the arena, and the four heroes' cloaks and elemental effects intensify. Smooth low push toward "
            "the titan; no strike, no running, no new characters, no hammer bending, no anatomy drift."
        ),
    },
    {
        "name": "64-fox-hollow-duel-v9",
        "seed": 9064,
        "prompt": QUALITY
        + (
            "The one golden fox at left and one purple Hollow wolf at right remain in clean opposing side profiles with all "
            "four paws readable. Each lowers its stance a fraction and shifts weight forward without stepping or colliding. "
            "Gold wisps orbit the fox and violet energy crawls backward along the wolf. The fox keeps one tail and a completely "
            "bare forehead with no band, plate, strap, spiral, or symbol. Smooth subtle camera creep between them; no duplicated "
            "animals, mouth distortion, limb change, or pounce."
        ),
    },
    {
        "name": "65-squad-sky-serpent-v9",
        "seed": 9065,
        "prompt": QUALITY
        + (
            "Exactly four heroes hold their positions on the separated floating platforms while the single colossal white-gold "
            "sky serpent glides its long coils slowly through the clouds. The serpent keeps one head and its face stays fixed; "
            "only the neck and distant coils shift subtly. Wind, clouds, fabric, and four restrained magic effects flow. Smooth "
            "cinematic crane upward and forward; no attack, no falling, no extra head or limb, no platform warping."
        ),
    },
    {
        "name": "66-five-shinobi-elemental-combo-v9",
        "seed": 9066,
        "prompt": QUALITY
        + (
            "Exactly five heroes stay anchored around the central geometric seal in their existing poses. The five distinct "
            "elemental streams pulse toward the center while the seal rotates only a few degrees and releases one controlled "
            "ring of light. Clothing and particles move, but hands, faces, feet, and weapons remain rigid. Smooth slow orbit "
            "around the formation; no extra hero, no body overlap, no tangled energy, no white-out."
        ),
    },
    {
        "name": "67-squad-loadout-armory-v9",
        "seed": 9067,
        "prompt": QUALITY
        + (
            "Exactly four heroes remain around the mission map while the single golden fox stays beside Rill. The miniature "
            "terrain on the table glows and rotates subtly, four armor displays shimmer one after another, and dust and banners "
            "move gently. The heroes breathe without moving their hands or weapons. The fox flicks one ear and its red neck scarf "
            "moves; its forehead stays completely bare. Smooth slow push toward the map; no new figures, gestures, headgear, or morphing."
        ),
    },
    {
        "name": "68-rill-bloodline-awakening-v9",
        "seed": 9068,
        "prompt": QUALITY
        + (
            "Rill remains centered and grounded while exactly four enormous elemental ancestor spirits tower behind him. Rill "
            "takes one breath and opens his eyes as restrained light rises around his body. Fire flows upward, ice crystals drift, "
            "wind ribbons circle, and violet lightning crawls across the four spirits without changing their silhouettes. Smooth "
            "slow push to Rill; no duplicate Rill, no attack, no facial drift, no extra spirit or limb, no overexposure."
        ),
    },
    {
        "name": "69-fox-howl-squad-charge-v9",
        "seed": 9069,
        "prompt": QUALITY
        + (
            "The one golden fox stays centered and releases one clearly visible golden shockwave that expands outward across the "
            "ground. Exactly four heroes behind it advance one controlled step together while exactly three Hollow hounds ahead "
            "recoil a fraction without changing formation. The fox keeps four paws, one tail, and a completely bare forehead; its "
            "red neck scarf streams backward. Smooth forward tracking camera; no gait loop, collision, extra creatures, or anatomy change."
        ),
    },
    {
        "name": "70-companion-roster-v9",
        "seed": 9070,
        "prompt": QUALITY
        + (
            "Rill and exactly four distinct companions remain in their clean lineup: one golden fox, one white ice owl, one ember "
            "cat, and one dark storm ram. Rill breathes and blinks once. The fox tilts one ear and moves its scarf and single tail "
            "tip while keeping a completely bare forehead; the owl blinks and settles feathers; embers drift from the cat; one "
            "small lightning arc moves along the ram. Smooth slow push, no walking, extra animals, anatomy changes, or overlap."
        ),
    },
    {
        "name": "71-dungeon-magma-ogre-v9",
        "seed": 9071,
        "prompt": QUALITY
        + (
            "Exactly four heroes remain separated in the foreground facing the one giant stone-and-magma ogre. The ogre shifts "
            "its weight forward slightly and lowers its single cleaver a few degrees while keeping the weapon shape and both feet "
            "fixed. Lava pulses through its cracks, dust and pebbles fall, and the heroes' cloaks and effects move. Smooth low "
            "camera push; no swing, no running, no extra limbs, no duplicated weapon, no rock or face morphing."
        ),
    },
    {
        "name": "72-rooftop-duel-separation-v9",
        "seed": 9072,
        "prompt": QUALITY
        + (
            "Rill remains airborne on the left facing right and the masked rival remains airborne on the right facing left. Both "
            "fighters drift a short distance farther apart laterally in their already established outward directions while keeping "
            "their torsos and faces turned toward each other. Each retains exactly one rigid sword. Sparks fade between them; rain, "
            "hair, sashes, and coats trail outward. Smooth camera pullback; no running cycle, backward-facing head, spin, extra blade, "
            "hand deformation, landing, or collision."
        ),
    },
    {
        "name": "73-squad-giant-oni-v9",
        "seed": 9073,
        "prompt": QUALITY
        + (
            "Exactly four heroes attack the one colossal red oni while maintaining the source composition. The oni shifts its "
            "single club only a few degrees and braces instead of swinging. The four heroes advance one controlled step along their "
            "existing paths as fire, ice, and lightning effects surge toward the oni. Dust and embers move strongly. Smooth forward "
            "push, no impact collision, no new fighter, no extra arm or club, no weapon or face morphing."
        ),
    },
    {
        "name": "74-four-clan-siege-v9",
        "seed": 9074,
        "prompt": QUALITY
        + (
            "The four color-coded armies stay confined to their four separate bridges as they advance subtly toward the central "
            "fortress. The enormous barrier ripples once, restrained projectiles arc toward it, smoke rises, banners stream, and "
            "fires flicker. Preserve the aerial geography, bridge count, army lanes, fortress, and color separation. Smooth slow "
            "aerial push toward the fortress; no close faces, no exploding camera, no extra bridge, no architecture morphing."
        ),
    },
    {
        "name": "75-squad-hollow-stag-v9",
        "seed": 9075,
        "prompt": QUALITY
        + (
            "Exactly four heroes and one golden fox remain in the foreground facing the single giant crystal Hollow stag. The "
            "stag slowly lifts its one head and exhales fog while violet crystal seams pulse without changing its antlers or body. "
            "The party's cloaks move; the fox moves its red scarf and single tail tip while keeping a completely bare forehead. "
            "Smooth low push toward the stag; no charge, no extra animal, antler, tail, or limb, no anatomy morphing."
        ),
    },
    {
        "name": "76-raid-treasure-portal-v9",
        "seed": 9076,
        "prompt": QUALITY
        + (
            "Exactly four heroes and one golden fox continue toward the single golden treasure portal. Everyone takes only one "
            "controlled half-step forward with all weapons remaining fully sheathed and rigid. Cloaks and the fox's red neck scarf "
            "move toward camera, a few stone fragments float slowly, and the portal brightens and sheds gold particles. The fox keeps "
            "a completely bare forehead. Smooth forward camera glide; no weapon draw, floating weapon, extra figure, gait loop, or morphing."
        ),
    },
    {
        "name": "77-world-event-leviathan-v9",
        "seed": 9077,
        "prompt": QUALITY
        + (
            "The single colossal winged Hollow leviathan remains beneath the elemental eclipse and makes one slow restrained wing "
            "flex while its distant tail and surrounding clouds drift. It keeps exactly one head and two wings. Multiple tiny rooftop "
            "squads remain planted as signal flares rise and distant elemental defenses pulse. Smooth dramatic aerial push toward the "
            "leviathan; no dive, attack, new monster, wing duplication, anatomy drift, or camera shake."
        ),
    },
    {
        "name": "78-rill-fox-victory-v9",
        "seed": 9078,
        "prompt": QUALITY
        + (
            "Rill's existing closed fist and the single golden fox's nose remain gently touching in the same position. Rill and "
            "the fox each blink once and breathe; neither hand nor muzzle changes shape. The fox's ears tilt, red neck scarf and one "
            "tail move in the sunrise wind, and its forehead remains completely bare with no band, plate, strap, symbol, glyph, or "
            "spiral. Distant banners and warm dust move. Smooth intimate push-in; no paw lift, face morph, extra fingers, or headgear."
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
