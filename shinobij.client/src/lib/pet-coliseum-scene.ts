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
// Formation lanes sit the leads ~5 units apart, so a melee strike needs to
// cross most of that to read as a pounce-into-contact (the leap arc + impact
// VFX bridge the last CONTACT_GAP — flat billboards never actually touch).
const MAX_LUNGE = 3.4;
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

// ── Combat choreography (Phase 3 — kill the "bonking") ───────────────────────
// poseMotion gives ONE static target per pose; the renderer eased toward it, so
// every attack read as two flat standees sliding into each other. beatTimeline
// instead returns a *progress-aware* transform — a small keyframed timeline over
// the beat — so a melee strike is anticipation-crouch → explosive leap arc →
// contact, and a hit is an INSTANT knockback that recovers (the GameCube-era
// "react on the contact frame", not the modern freeze-then-ease). Still pure:
// progress in [0,1] comes from the renderer's beat clock, no RNG/wall-clock.

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Decelerating ease (fast → slow). */
const easeOutQuad = (p: number): number => { const q = clamp01(p); return 1 - (1 - q) * (1 - q); };
/** Accelerating ease (slow → fast). */
const easeInQuad = (p: number): number => { const q = clamp01(p); return q * q; };
/** A 0→1→0 hump (sin), for arcs and one-shot pops. */
const hump = (p: number): number => Math.sin(Math.PI * clamp01(p));

/** Peak height (world units) of a melee leap arc. */
export const LEAP_HEIGHT = 0.95;

/** How long each pose's keyframed choreography runs (ms). The beat itself may
 *  last longer (the scheduler holds on camera beats) — progress then clamps at 1
 *  and the pose holds its final keyframe, which IS the hit-stop dwell. Static
 *  poses (idle/guard/victory/ko) return 1: progress is irrelevant, they delegate
 *  to poseMotion. The leap/strike peaks well before its end so scheduler
 *  compression can never cut the contact moment. */
export function beatChoreoMs(state: PetVisualState): number {
    switch (state) {
        case "windup": return 200;
        case "lunge": return 320;
        case "hit":
        case "recoil": return 360;
        case "charge":
        case "rangedCast":
        case "projectileFire": return 300;
        case "dodge": return 380;
        default: return 1;
    }
}

/**
 * Progress-aware billboard transform for a pose. `progress` is 0..1 through the
 * pose's choreography (beatChoreoMs). `toward` (+1/−1) is the direction to the
 * foe; `reach` the gap-aware lunge distance (lungeReach); `opts.power` (0..1,
 * damage/maxHp) scales a hit's knockback. Static poses fall through to
 * poseMotion so idle/guard/victory/ko behave exactly as before.
 */
export function beatTimeline(
    state: PetVisualState,
    toward: number,
    reach: number,
    progress: number,
    opts: { power?: number } = {},
): PoseTransform {
    const t = toward >= 0 ? 1 : -1;
    const p = clamp01(progress);
    const power = clamp01(opts.power ?? 0.5);
    switch (state) {
        case "windup": {
            // Anticipation: lean back + crouch (squash), loaded by ~70%.
            const e = easeOutQuad(p / 0.7);
            return { ...IDLE, dx: -0.5 * t * e, dy: -0.06 * e, sx: 1 + 0.10 * e, sy: 1 - 0.13 * e };
        }
        case "lunge": {
            // Load (0–0.16) → explosive leap arc to contact (lands by ~0.55) →
            // brief landing squash held to the end (the hit-stop pose).
            const load = clamp01(p / 0.16);
            const fly = clamp01((p - 0.16) / 0.39); // reaches 1 at p=0.55
            const land = clamp01((p - 0.55) / 0.25);
            const dx = lerp(-0.3 * t, reach * t, easeInQuad(fly));
            const dy = LEAP_HEIGHT * hump(fly); // up then planted at contact
            const sx = 1 + 0.06 * load + 0.10 * fly - 0.10 * land;
            const sy = 1 - 0.05 * load - 0.04 * fly + 0.08 * land;
            return { ...IDLE, dx, dy, sx, sy };
        }
        case "hit":
        case "recoil": {
            // INSTANT knockback on the contact frame, then a fast ease back to
            // the lane — the reaction fires at p=0 (peak), not an eased slide in.
            const kb = 0.7 + 0.7 * power;       // 0.7..1.4, scales with damage
            const out = 1 - easeOutQuad(p);     // 1 at p=0, 0 at p=1 (fast-out)
            return {
                ...IDLE,
                dx: -kb * t * out,
                dy: 0.16 * hump(clamp01(p / 0.55)),
                rot: -0.18 * t * out,
                sx: 1 + 0.08 * out,
                sy: 1 - 0.08 * out,
                hurt: out,
            };
        }
        case "charge": {
            // Gather/rise in place — the VFX glow carries it; sprite lifts + swells.
            const e = easeOutQuad(clamp01(p / 0.6));
            return { ...IDLE, dy: 0.07 + 0.05 * hump(p), sx: 1 - 0.03 * e, sy: 1 + 0.09 * e };
        }
        case "rangedCast":
        case "projectileFire": {
            // Plant + lean, then a sharp recoil kick away from the foe on release.
            const plant = easeOutQuad(clamp01(p / 0.45));
            const kick = hump(clamp01((p - 0.55) / 0.45));
            return {
                ...IDLE,
                dx: -0.16 * t * plant - 0.24 * t * kick,
                dy: 0.07 * plant,
                sx: 1 - 0.03 * kick,
                sy: 1 + 0.07 * plant - 0.03 * kick,
            };
        }
        case "dodge": {
            // Sidestep toward the camera with an afterimage fade, then settle back.
            const slide = easeOutQuad(clamp01(p / 0.45));
            const back = easeInQuad(clamp01((p - 0.55) / 0.45));
            return { ...IDLE, dz: 0.95 * slide * (1 - back), opacity: 1 - 0.4 * hump(p), sx: 1 - 0.06 * slide };
        }
        default:
            // idle / guard / victory / ko — static, identical to before.
            return poseMotion(state, toward, reach);
    }
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

// ── Formation staging (Phase 2 — kill overlap by construction) ───────────────
// Pets no longer stand on raw sim tiles (which clump). Each side owns fixed
// lane anchors chosen so sprites + nameplates can NEVER overlap; the sim still
// drives who acts / who's in melee range (tileDistance, unchanged) — its
// distance only slides a pet ALONG its lane via engagementAdvance().
const LEAD_X = 3.0;      // lead pet: inner, toward center
const RESERVE_X = 4.5;   // reserve: outer
const LEAD_Z = 1.0;      // lead: front (nearer camera)
const RESERVE_Z = -1.2;  // reserve: back — x+z stagger so neither hides the other
const MAX_ADVANCE = 0.75; // most a pet slides toward center when the fight is close

/** Fixed lane anchor for a side + lane index (0 = lead, 1 = reserve). Player
 *  side sits on the left (−x), enemy on the right (+x). */
export function formationAnchor(side: "player" | "enemy", lane: number): { x: number; z: number } {
    const dir = side === "player" ? -1 : 1;
    return lane <= 0
        ? { x: dir * LEAD_X, z: LEAD_Z }
        : { x: dir * RESERVE_X, z: RESERVE_Z };
}

/** Resolve world anchors for a list of combatants by side, assigning lane
 *  indices in order within each side. Deterministic; overlap is impossible by
 *  construction (the anchor gaps exceed sprite + nameplate width). */
export function formationSlots(sides: ReadonlyArray<"player" | "enemy">): { x: number; z: number }[] {
    let p = 0, e = 0;
    return sides.map((side) => formationAnchor(side, side === "player" ? p++ : e++));
}

/** How far a pet slides toward center given the sim's actor↔target tile
 *  distance: close fights tighten the staging, ranged ones spread it — capped
 *  so the minimum separation always holds. Pure. */
export function engagementAdvance(simDist: number): number {
    const t = Math.max(0, Math.min(1, (7 - simDist) / 5)); // ≤2 tiles → full, ≥7 → none
    return t * MAX_ADVANCE;
}

// ── Grounding (Phase 1 — kill the "floating") ────────────────────────────────

/** The opaque content's bounding box within a sprite image, normalized 0..1.
 *  left/right are x fractions (0 = image left, 1 = image right); top/bottom are
 *  y fractions (0 = image TOP, 1 = image BOTTOM). Generated pet sprites center
 *  the creature in a square frame with transparent margin, so `bottom` is the
 *  fraction at which the feet actually sit — the renderer anchors THAT to the
 *  floor instead of the plane's literal bottom edge. */
export type SpriteBounds = { left: number; right: number; top: number; bottom: number };

/** Default bounds (used while the alpha scan is still loading or for the
 *  procedural placeholder): a centered subject filling most of the frame. */
export const DEFAULT_SPRITE_BOUNDS: SpriteBounds = { left: 0.14, right: 0.86, top: 0.08, bottom: 0.95 };

/** Compute the opaque bounding box of an RGBA pixel buffer. Pure + testable.
 *  `rgba` is a flat [r,g,b,a, r,g,b,a, …] buffer of width×height pixels; only
 *  the alpha channel is read. Returns DEFAULT-style full frame if nothing
 *  clears the alpha threshold. */
export function spriteBoundsFromAlpha(
    rgba: ArrayLike<number>,
    width: number,
    height: number,
    threshold = 12,
): SpriteBounds {
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (rgba[(y * width + x) * 4 + 3] > threshold) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) return { left: 0, right: 1, top: 0, bottom: 1 };
    return {
        left: minX / width,
        right: (maxX + 1) / width,
        top: minY / height,
        bottom: (maxY + 1) / height,
    };
}

/** Where to place + how to size a billboard plane so the sprite's VISIBLE feet
 *  sit on the floor (poseGroup origin y=0) and the visible content is centered
 *  on the lane at a target height — regardless of the image's transparent
 *  padding. Pure: the renderer feeds bounds (from the alpha scan), the image's
 *  width/height aspect, a target content height, and whether the texture is
 *  UV-mirrored (enemy side). */
export type GroundedLayout = {
    planeW: number;        // world width of the FULL-image plane
    planeH: number;        // world height of the FULL-image plane
    meshX: number;         // x offset to center the visible content on the lane
    meshY: number;         // y offset so the content's bottom edge sits at y=0
    contentWorldW: number; // visible content width in world units (for the shadow)
    contentWorldH: number; // visible content height in world units (≈ targetH)
};
export function groundedSpriteLayout(
    bounds: SpriteBounds,
    imageAspect: number,   // image width / height
    targetH: number,       // desired on-screen content height in world units
    mirrored: boolean,
): GroundedLayout {
    const contentFracH = Math.max(0.05, bounds.bottom - bounds.top);
    const contentFracW = Math.max(0.02, bounds.right - bounds.left);
    const planeH = targetH / contentFracH;
    const planeW = planeH * (imageAspect > 0 ? imageAspect : 1);
    // Content bottom (image y = bounds.bottom) → plane-local y = planeH*(0.5 - bottom);
    // lift the mesh by the negative of that so it lands at the feet pivot (y=0).
    const meshY = planeH * (bounds.bottom - 0.5);
    // Center the visible content horizontally; the UV mirror swaps left/right.
    const cx = (bounds.left + bounds.right) / 2;
    const displayedCx = mirrored ? 1 - cx : cx;
    const meshX = -planeW * (displayedCx - 0.5);
    return { planeW, planeH, meshX, meshY, contentWorldW: planeW * contentFracW, contentWorldH: planeH * contentFracH };
}
