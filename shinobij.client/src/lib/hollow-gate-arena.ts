/**
 * Hollow Gate — boss arena hazards.
 *
 * While a floor's boss is still standing, one fissure line splits its chamber
 * and vents spirit fire in a rhythm you can read: a segment glows (warning),
 * then erupts, then cools while the next segment takes its turn. An erupting
 * tile cannot be stepped onto, so reaching the boss means timing the crossing.
 *
 * The hazard only gates movement. It deals no damage, costs no step, and
 * changes no reward, threat, torch or combat rule; the server is unaware of it.
 * The tiles beside the chamber's doorways stay safe, so a player always has a
 * foothold to wait on, and a stripe never erupts twice in a row.
 */
import type { HollowGateShrineRun, HollowGateTile } from "../types/character";

/** One beat of the rhythm: each fissure erupts one beat in three. The eager
 *  movement check keeps its own copy (importing it from there would split
 *  that module into an extra startup chunk); a test keeps the two equal. */
export const HOLLOW_GATE_FISSURE_BEAT_MS = 1200;
export type HollowGateFissureState = "calm" | "warning" | "erupting";

const CARD: ReadonlyArray<readonly [number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const cache = new WeakMap<readonly HollowGateTile[], Map<number, number>>();

/** Fissure cells of the live boss chamber, each mapped to its stripe (0-2).
 *  Empty once the boss is defeated, or on floors without a boss. */
export function hollowGateArenaFissures(run: Pick<HollowGateShrineRun, "tiles" | "width">): Map<number, number> {
    const cached = cache.get(run.tiles);
    if (cached) return cached;
    const { tiles, width: w } = run;
    const fissures = new Map<number, number>();
    const boss = tiles.findIndex((t) => t.kind === "boss" && !t.resolved);
    const room = boss >= 0 ? tiles[boss].roomId : null;
    if (room != null) {
        const nearDoor = (i: number) => CARD.some(([dx, dy]) => {
            const x = i % w + dx, y = Math.floor(i / w) + dy;
            return x >= 0 && x < w && y >= 0 && tiles[y * w + x]?.terrain === "door";
        });
        // ONE fissure line splits the chamber across its middle (a column in a
        // wide room, a row in a tall one), so the painting stays the room and
        // the crack is a single barrier to time your way over. Its segments
        // take turns erupting along the line.
        const cells: number[] = [];
        tiles.forEach((t, i) => { if (t.roomId === room && t.terrain === "room_floor") cells.push(i); });
        const xs = cells.map((i) => i % w), ys = cells.map((i) => Math.floor(i / w));
        const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
        const wide = right - left >= bottom - top;
        const mid = wide ? Math.floor((left + right) / 2) : Math.floor((top + bottom) / 2);
        for (const i of cells) {
            const x = i % w, y = Math.floor(i / w), t = tiles[i];
            if ((wide ? x : y) !== mid) continue;
            if (t.terrain !== "room_floor" || t.kind !== "empty" || t.solid || nearDoor(i)) continue;
            fissures.set(i, (wide ? y - top : x - left) % 3);
        }
    }
    cache.set(run.tiles, fissures);
    return fissures;
}

/** The rhythm at `now`: which stripe erupts, and which glows a beat ahead. */
export function hollowGateFissureState(stripe: number, now: number): HollowGateFissureState {
    const beat = Math.floor(now / HOLLOW_GATE_FISSURE_BEAT_MS) % 3;
    if (stripe === beat) return "erupting";
    if (stripe === (beat + 1) % 3) return "warning";
    return "calm";
}

/** True when stepping onto `index` right now would walk into erupting fire. */
export function hollowGateFissureBlocks(run: Pick<HollowGateShrineRun, "tiles" | "width">, index: number, now: number): boolean {
    const stripe = hollowGateArenaFissures(run).get(index);
    return stripe !== undefined && hollowGateFissureState(stripe, now) === "erupting";
}
