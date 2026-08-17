/*
 * A resting pet on the player's line must never show the camera its back.
 *
 * The lens sits BEHIND the player's line (WIDE_POS is on +Z, the player's slots
 * are on +Z, the enemy's on -Z). So "face the enemy" and "face the camera" are
 * opposites, and a stance squared down the lane is simultaneously correct and
 * unwatchable: it parks your own pet tail-on to the viewer for the entire
 * fight while the enemy shows a face. That shipped, and it reads as a pet
 * modelled facing the wrong way — the reason this guard exists is that the
 * complaint arrives as "the 3D model is backwards" when the asset is fine.
 *
 * Pinned in BOTH directions, because either extreme is a bug:
 *   - too little turn and the pet is tail-on to the lens again;
 *   - too much and it has its back to the fight it is supposed to be in.
 *
 * This is a SOURCE-SHAPE guard in the same spirit as pet-showdown-warmup
 * .test.ts: the values live in a component that pulls in three/r3f, so it is
 * read as text rather than imported, and the geometry is recomputed here from
 * the very constants the renderer uses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "PetShowdownBattle.tsx"), "utf8");

/** Pull a bare `const NAME = <number>;` out of the component source. */
function num(name: string): number {
    const m = source.match(new RegExp(`const ${name} = (-?[\\d.]+);`));
    assert.ok(m, `${name} not found in PetShowdownBattle.tsx`);
    return Number(m![1]);
}

function wideCameraXZ(): [number, number] {
    const m = source.match(/const WIDE_POS: readonly \[number, number, number\] = \[([^\]]+)\]/);
    assert.ok(m, "WIDE_POS not found in PetShowdownBattle.tsx");
    const parts = m![1].split(",").map((p) => Number(p.trim()));
    assert.equal(parts.length, 3, "WIDE_POS should be a 3-tuple");
    return [parts[0], parts[2]];
}

/** Degrees the resting turn is authored at. */
function restingTurnDeg(): number {
    const m = source.match(/const RESTING_TURN = \((-?[\d.]+) \* Math\.PI\) \/ 180;/);
    assert.ok(m, "RESTING_TURN not found — the player's resting stance is what keeps its face to the lens");
    return Number(m![1]);
}

/** Angle between the way the camera looks at the pet and the way the pet faces.
 *  0 = dead astern (we see its back), 180 = we see its face. */
function viewVsFacing(): number {
    const turn = (restingTurnDeg() * Math.PI) / 180;
    const face: [number, number] = [Math.sin(turn), -Math.cos(turn)];
    const [camX, camZ] = wideCameraXZ();
    const playerZ = num("PLAYER_Z");
    const vx = 0 - camX;
    const vz = playerZ - camZ;
    const len = Math.hypot(vx, vz);
    const dot = (vx / len) * face[0] + (vz / len) * face[1];
    return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

test("the player's resting pet is not tail-on to the broadcast camera", () => {
    const angle = viewVsFacing();
    assert.ok(
        angle > 45,
        `resting player pet sits ${angle.toFixed(1)}deg off dead-astern — at 45deg or less the viewer spends the whole fight looking at its back`,
    );
});

test("the resting turn still keeps the pet oriented into the fight", () => {
    const deg = restingTurnDeg();
    assert.ok(deg > 0, "a zero turn is the squared-down-the-lane stance this guard exists to prevent");
    assert.ok(
        deg < 90,
        `resting turn is ${deg}deg — at 90deg or more the pet is no longer facing the enemy line it is fighting`,
    );
    // The enemy line is at -Z, so the resting facing must still carry the pet
    // that way; a positive Z component would have it idling up the wrong lane.
    const turn = (deg * Math.PI) / 180;
    assert.ok(-Math.cos(turn) < 0, "resting facing must still point down-lane toward the enemy");
});

test("the enemy line is left face-on and is not turned away", () => {
    // Only the player's side is turned; the enemy already reads as a face and
    // must keep doing so, or the fix trades one blank silhouette for another.
    const m = source.match(/function restingFacing\(side: "player" \| "enemy"\)[\s\S]*?\n\}/);
    assert.ok(m, "restingFacing() not found");
    assert.match(m![0], /: \[0, 1\];/, "the enemy's resting facing should stay square-on toward the camera");
});
