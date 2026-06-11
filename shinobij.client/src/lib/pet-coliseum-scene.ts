/*
 * Pet COLISEUM scene math — PURE helpers for the HD-2D react-three-fiber
 * renderer (PetColiseum.tsx). Two jobs:
 *   1. tileToWorld()  — map a sim grid tile (14×7) to 3D floor coordinates, so
 *      pet positions still come straight from the deterministic simulator.
 *   2. poseMotion()   — map a PetVisualState (resolved by the existing
 *      petPoseForAvatar) to a target billboard transform: the 3D analogue of
 *      the CSS pose classes (lunge forward, recoil back, guard hunker, KO
 *      topple…). The renderer eases the live billboard toward this target.
 *
 * Like pet-battle-anim.ts / pet-battle-camera.ts, this imports ONLY types and
 * does NO randomness / clock read, so it is node-testable and can never affect
 * the deterministic battle outcome — it is a cosmetic derive of sim frames.
 */
import type { PetVisualState } from "../types/pet-battle";

// The sim's arena grid (mirrors constants/pet-arena.ts; duplicated as plain
// numbers so this stays a zero-dependency pure module).
export const COLISEUM_COLS = 14;
export const COLISEUM_ROWS = 7;

// World footprint (in three.js units) the grid maps onto. Wide and shallow so
// the two sides face off across the pit at the angled camera. Sized generously
// (a tile step ≈ 0.86 units) so walks/lunges read as real movement and a 2v2's
// four pets have room to spread instead of stacking behind each other.
const ARENA_HALF_W = 5.6; // x extent (left ↔ right)
const ARENA_HALF_D = 3.2; // z extent (depth: back rows far, front rows near)

/** Map a tile index on the COLISEUM_COLS×COLISEUM_ROWS grid to floor (x,z).
 *  col → x (left→right), row → z (back→front). Out-of-range tiles clamp via
 *  modulo so a stray index can never NaN the scene. */
export function tileToWorld(
    tile: number,
    cols = COLISEUM_COLS,
    rows = COLISEUM_ROWS,
): { x: number; z: number } {
    const safe = Number.isFinite(tile) ? Math.trunc(tile) : 0;
    const c = ((safe % cols) + cols) % cols;
    const r = Math.min(rows - 1, Math.max(0, Math.floor(safe / cols)));
    const u = cols > 1 ? c / (cols - 1) : 0.5; // 0..1 left→right
    const v = rows > 1 ? r / (rows - 1) : 0.5; // 0..1 back→front
    return {
        x: (u - 0.5) * 2 * ARENA_HALF_W,
        z: (v - 0.5) * 2 * ARENA_HALF_D,
    };
}

// ── Face-off spacing ─────────────────────────────────────────────────────────
// Billboards are ~2.3 world units wide but adjacent grid columns are only
// ~0.65 apart, so raw tile positions let melee combatants overlap ("go into
// each other"). MIN_SEP pushes the two apart to a readable rest distance;
// CONTACT_GAP is where a lunge STOPS — close enough to read as a hit, never
// through the target.
const MIN_SEP = 1.9;
const CONTACT_GAP = 0.95;
const MAX_LUNGE = 2.2;
// Screen-visibility floor: two pets separated mostly along DEPTH (z) satisfy
// MIN_SEP yet still hide one behind the other at the camera angle. Nearby
// pairs therefore also get a minimum HORIZONTAL (x) gap so both sprites stay
// visibly side-by-side on screen.
const MIN_X_SEP = 1.4;
const X_SEP_RANGE = 3.2; // only enforce on pairs this close overall

/** Enforce a minimum pairwise separation over N floor positions (2 for 1v1,
 *  4 for 2v2). Symmetric pairwise pushes over a few relaxation iterations —
 *  deterministic (fixed order, no RNG), preserves each crowded pair's midpoint,
 *  leaves well-spaced pets untouched. Coincident points split along +x. */
export function spreadPositions(
    points: ReadonlyArray<{ x: number; z: number }>,
    minSep = MIN_SEP,
    iterations = 3,
): { x: number; z: number }[] {
    const out = points.map((p) => ({ x: p.x, z: p.z }));
    for (let it = 0; it < iterations; it++) {
        for (let i = 0; i < out.length; i++) {
            for (let j = i + 1; j < out.length; j++) {
                let dx = out[j].x - out[i].x, dz = out[j].z - out[i].z;
                let d = Math.hypot(dx, dz);
                if (d < 1e-6) { dx = 1; dz = 0; d = 1e-6; }
                if (d < minSep) {
                    const push = (minSep - d) / 2;
                    const ux = dx / d, uz = dz / d;
                    out[i].x -= ux * push; out[i].z -= uz * push;
                    out[j].x += ux * push; out[j].z += uz * push;
                    dx = out[j].x - out[i].x; dz = out[j].z - out[i].z;
                    d = Math.hypot(dx, dz);
                }
                // Screen-visibility: a nearby pair separated mostly along depth
                // still stacks one-behind-the-other on screen — give it a
                // minimum horizontal gap too (deterministic tie-break right).
                if (d < X_SEP_RANGE && Math.abs(dx) < MIN_X_SEP) {
                    const dir = dx >= 0 ? 1 : -1;
                    const need = (MIN_X_SEP - Math.abs(dx)) / 2;
                    out[i].x -= dir * need;
                    out[j].x += dir * need;
                }
            }
        }
    }
    return out;
}

/** World positions for two combatants with the minimum separation enforced —
 *  the 1v1 convenience wrapper over spreadPositions. */
export function faceOffPositions(
    aTile: number,
    bTile: number,
): { a: { x: number; z: number }; b: { x: number; z: number } } {
    const [a, b] = spreadPositions([tileToWorld(aTile), tileToWorld(bTile)]);
    return { a, b };
}

/** How far a lunge may advance given the current gap to the target: close the
 *  distance down to CONTACT_GAP, never past it, never more than MAX_LUNGE, and
 *  always at least a small hop so the attack beat reads. */
export function lungeReach(gap: number): number {
    return Math.max(0.25, Math.min(MAX_LUNGE, gap - CONTACT_GAP));
}

/** A billboard's target transform for a given pose, relative to its base tile
 *  position. The renderer lerps the live sprite toward this each frame. */
export type PoseTransform = {
    dx: number;      // world-x offset (toward/away from the opponent)
    dy: number;      // world-y offset (lift / sink)
    dz: number;      // world-z offset (sidestep toward/away from camera)
    sx: number;      // x scale multiplier (squash/stretch)
    sy: number;      // y scale multiplier
    rot: number;     // z tilt in radians (KO topple)
    hurt: number;    // 0..1 damage tint (red flash on the sprite)
    opacity: number; // 1 normal, <1 fading (dodge afterimage / KO)
};

const IDLE: PoseTransform = { dx: 0, dy: 0, dz: 0, sx: 1, sy: 1, rot: 0, hurt: 0, opacity: 1 };

/**
 * Pose → target billboard transform. `toward` is +1 if the pet faces +x (the
 * player side, with its foe on the right) or -1 for the mirrored enemy side, so
 * "lunge" always drives toward the opponent and "recoil" always away. `reach`
 * is the gap-aware lunge distance (see lungeReach) so a melee lunge stops at
 * contact instead of passing through an adjacent target.
 */
export function poseMotion(state: PetVisualState, toward: number, reach = 1.25): PoseTransform {
    const t = toward >= 0 ? 1 : -1;
    switch (state) {
        case "windup":          return { ...IDLE, dx: -0.4 * t, sx: 0.96, sy: 1.06 };
        case "lunge":           return { ...IDLE, dx: reach * t, sx: 1.07, sy: 0.94 };
        case "charge":
        case "rangedCast":
        case "projectileFire":  return { ...IDLE, dx: -0.18 * t, dy: 0.07, sx: 1.0, sy: 1.07 };
        case "hit":
        case "recoil":          return { ...IDLE, dx: -0.85 * t, rot: -0.13 * t, hurt: 1, sx: 1.03, sy: 0.98 };
        case "guard":           return { ...IDLE, dy: -0.04, sx: 1.08, sy: 0.9 };
        case "dodge":           return { ...IDLE, dz: 0.75, sx: 0.94, opacity: 0.72 };
        case "ko":              return { ...IDLE, dx: -0.3 * t, dy: -0.28, rot: 1.3 * t, sx: 1.02, sy: 0.8, opacity: 0.4 };
        case "victory":         return { ...IDLE, dy: 0.14, sy: 1.05 };
        case "idle":
        default:                return { ...IDLE };
    }
}

/** Linear interpolate — small helper so the renderer eases toward a target. */
export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/** Camera-shake amplitude for the current beat, by severity. 0 = no shake.
 *  Mirrors the camera director's shake-beat set (impact / ko / screenShake). */
export function shakeAmpForBeat(
    beat: string | undefined,
    opts: { isKO: boolean; crit: boolean; signature: boolean; heavyHit: boolean },
): number {
    if (opts.isKO || beat === "ko") return 0.36;
    if (beat !== "impact" && beat !== "screenShake") return 0;
    if (opts.crit || opts.signature) return 0.22;
    if (opts.heavyHit) return 0.12;
    return 0;
}
