/*
 * ── Tactical Pet Arena — true-3D stage helpers (pure/testable) ───────────────
 * Math + data for the LoL-style spectator renderer (PetArena3DStage):
 *   • the walkmask → instanced floor-tile layout (world == sim units, 1:1),
 *   • the broadcast follow-camera focus + fit-distance model,
 *   • sim-state → skeletal-motion mapping and the per-species model height.
 * Everything here is presentation-only — it reads the deterministic sim's
 * snapshots and the SAME walkmask the sim paths on (so the visible floor can
 * never disagree with where pets actually walk), and never feeds anything back.
 */
import { FULL_MASK, FULL_COLS, FULL_ROWS } from "./pet-arena-fullmask";
import { ARENA_X, ARENA_Y, type ArenaSnapshot, type ArenaState } from "./pet-arena-sim";
import type { PetModelMotion } from "../components/PetModel3D";

// World == sim units (±ARENA_X wide, ±ARENA_Y deep; +z toward the camera), so
// every snapshot coordinate lands on the floor with NO projection conversion.
export const A3D_TILE_W = (ARENA_X * 2) / FULL_COLS;
export const A3D_TILE_D = (ARENA_Y * 2) / FULL_ROWS;

export const A3D_FOV = 42;            // vertical FOV (deg) — broadcast-tele look
export const A3D_PITCH = 0.94;        // rad below horizontal (~54° — the MOBA spectator angle)
export const A3D_MIN_DIST = 8.5;      // never closer than a readable two-pet frame
export const A3D_MAX_DIST = 34;       // never further than "whole board + margin"
const A3D_FIT_MARGIN = 2.4;           // world-units of breathing room around the framed action

/** Uniform arena model height (world units). Species keep a compressed size
 * hint from their duel-scale targetHeight so a heavy warbeast still reads
 * bigger than a sparrow without dwarfing the 14×7.5-unit board. */
export function arenaModelHeight(targetHeight: number): number {
    const h = 1.08 + (targetHeight - 2.35) * 0.18;
    return Math.min(1.38, Math.max(0.92, h));
}

export type ArenaWalkTile = {
    x: number; z: number;   // world-space tile centre (y is the floor plane)
    shade: number;          // 0..1 brightness variation (checker + hash noise − edge AO)
    edge: boolean;          // true when any 4-neighbour is void → drawn as a ledge lip
};

/** Instanced floor layout from ANY '1'/'0' row-major walkmask — derived from
 * the SAME mask a sim paths on, so the visible floor and the gameplay can never
 * disagree. Deterministic (pure function of the mask); shared by the tactical
 * arena and the Hollow Warfront battlefield. */
export function walkTilesFromMask(mask: string, cols: number, rows: number, halfX: number, halfY: number): ArenaWalkTile[] {
    const walkable = (c: number, r: number): boolean =>
        c >= 0 && r >= 0 && c < cols && r < rows && mask.charCodeAt(r * cols + c) === 49;
    const tileW = (halfX * 2) / cols, tileD = (halfY * 2) / rows;
    const tiles: ArenaWalkTile[] = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (!walkable(c, r)) continue;
            const edge = !walkable(c - 1, r) || !walkable(c + 1, r) || !walkable(c, r - 1) || !walkable(c, r + 1);
            // Small deterministic hash for stone-tone variation (no Math.random —
            // the layout must be identical across mounts and test runs).
            const h = ((c * 73856093) ^ (r * 19349663)) >>> 0;
            const noise = ((h % 97) / 97 - 0.5) * 0.16;
            const checker = ((c + r) & 1) === 0 ? 0.04 : -0.04;
            const ao = edge ? -0.16 : 0;
            tiles.push({
                x: (c + 0.5) * tileW - halfX,
                z: (r + 0.5) * tileD - halfY,
                shade: Math.min(1, Math.max(0, 0.62 + checker + noise + ao)),
                edge,
            });
        }
    }
    return tiles;
}

/** The tactical arena's floor layout (the walkmask the arena sim paths on). */
export function arenaWalkTiles(): ArenaWalkTile[] {
    return walkTilesFromMask(FULL_MASK, FULL_COLS, FULL_ROWS, ARENA_X, ARENA_Y);
}

export type ArenaCameraFocus = { fx: number; fz: number; span: number; carrier: boolean };

/** Broadcast focus for a snapshot: follow the scroll carrier tight ("will they
 * make it home?"), else the centroid of the living pets, widening with their
 * spread. Falls back to board centre when nobody is alive (respawn lulls). */
export function arenaCameraFocus(snap: ArenaSnapshot): ArenaCameraFocus {
    if (snap.scroll.state === "carried" && snap.scroll.carrierId) {
        const c = snap.actors.find((a) => a.id === snap.scroll.carrierId);
        if (c) return { fx: c.x, fz: c.y, span: 11, carrier: true };
    }
    let n = 0, mx = 0, mz = 0;
    const live: Array<{ x: number; y: number }> = [];
    for (const a of snap.actors) {
        if (a.state === "dead" || a.state === "respawning") continue;
        mx += a.x; mz += a.y; n++; live.push(a);
    }
    if (n === 0) return { fx: 0, fz: 0, span: ARENA_X * 2, carrier: false };
    mx /= n; mz /= n;
    let spread = 0;
    for (const a of live) {
        const dx = a.x - mx, dz = a.y - mz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > spread) spread = d;
    }
    // Tight cluster → punch in on the teamfight; spread squads → widen out.
    const span = Math.min(ARENA_X * 2 + 4, Math.max(10, spread * 2 + 7));
    return { fx: mx, fz: mz, span, carrier: false };
}

/** Camera distance that fits `span` world-units of ground at the given viewport
 * aspect, for the fixed A3D_PITCH/A3D_FOV rig. Width fit uses the horizontal
 * FOV; depth fit approximates the pitched ground segment's angular height. */
export function arenaCameraDist(span: number, aspect: number): number {
    const fovY = (A3D_FOV * Math.PI) / 180;
    const halfTan = Math.tan(fovY / 2);
    const hHalfTan = halfTan * Math.max(0.55, aspect);
    const half = span / 2 + A3D_FIT_MARGIN;
    const dWidth = half / hHalfTan;
    const dDepth = (half * 0.62 * Math.sin(A3D_PITCH)) / halfTan;
    return Math.min(A3D_MAX_DIST, Math.max(A3D_MIN_DIST, Math.max(dWidth, dDepth)));
}

/** Sim actor state → skeletal motion for PetModel3D. `striking` is the
 * renderer's short self-timed pulse from the attack-state entry edge (the sim's
 * attack state itself persists across the whole swing cooldown). */
export function arenaModelMotion(state: ArenaState, moving: boolean, striking: boolean): PetModelMotion {
    if (state === "dead" || state === "respawning") return "dead";
    if (state === "dash") return "dash";
    if (state === "channel") return "windup";
    if (striking) return "strike";
    if (moving) return "run";
    return "idle";
}

/** PiP focus-cycle order: blue team first (the local player's squad in every
 * live mount), then red — so one tap-cycle can also spectate the enemy. */
export function pipCycleIds(rosterIds: readonly string[]): string[] {
    const blue = rosterIds.filter((id) => id.startsWith("blue"));
    const red = rosterIds.filter((id) => !id.startsWith("blue"));
    return [...blue, ...red];
}
