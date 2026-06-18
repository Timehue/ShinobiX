/**
 * Hollow Gate — branching-wings floor generator (Phase 2B).
 *
 * Produces a floor with a central SPAWN HUB that opens (via three corridors)
 * into three sealed-off wings:
 *   • treasure — chests + shard veins + traps (a loot detour)
 *   • beast    — elites + traps (a combat detour; pets still come from ambush)
 *   • trial    — holds the descend / Warden (the ONLY way down)
 *
 * The hub is a cut vertex: each wing connects ONLY to the hub, never to another
 * wing, so the runtime can seal the detour you didn't pick without ever blocking
 * the trial (the no-softlock rule — see docs/hollow-gate-loop.md §8). Topology is
 * fixed (not random) so it's reliable; content within each wing is rolled.
 *
 * `tagHollowGateWings` is exported separately and unit-tested: it flood-fills
 * each wing room outward through corridors (stopping at the hub) to stamp
 * `tile.wing`, then names the wing holding the descend/boss "trial".
 */
import { hollowGateReachableSet, type BSPRect } from "./hollow-gate-bsp";
import { pickRoomTheme } from "../data/hollow-gate-atlas";
import { HOLLOW_GATE_SHRINE_W, HOLLOW_GATE_SHRINE_H } from "../constants/game";
import type { HollowGateShrineRun, HollowGateTile, HollowGateTileKind, HollowGateTerrain } from "../types/character";

// Fixed room rectangles on the 15×11 grid. Hub centered; three wings in the
// top-left, top-right, and bottom bands. Each wing is its own BSP room id.
const HUB: BSPRect = { x: 6, y: 4, w: 3, h: 3 };          // rows 4-6, cols 6-8
type WingDef = { rect: BSPRect; theme: "treasure" | "beast" | "trial" };
const WINGS: WingDef[] = [
    { rect: { x: 1, y: 1, w: 4, h: 3 }, theme: "treasure" },   // top-left
    { rect: { x: 10, y: 1, w: 4, h: 3 }, theme: "beast" },     // top-right
    { rect: { x: 3, y: 8, w: 9, h: 2 }, theme: "trial" },      // bottom (descends)
];

// Hand-routed, non-overlapping corridors from the hub to each wing. Each lane is
// disjoint from the others and touches only the hub + its wing, so the hub stays
// a cut vertex (removing it isolates every wing). Index matches WINGS order.
const WING_CORRIDORS: Array<Array<[number, number]>> = [
    [[5, 2], [5, 3], [5, 4]],   // treasure: col 5, rows 2-4 (hub(6,4) ↔ treasure(4,2))
    [[9, 2], [9, 3], [9, 4]],   // beast:    col 9, rows 2-4 (hub(8,4) ↔ beast(10,2))
    [[7, 7]],                   // trial:    single cell (hub(7,6) ↔ trial(7,8))
];

function center(r: BSPRect): { x: number; y: number } {
    return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
}

/**
 * Stamp `tile.wing` for every wing cell and fill `run.wingThemes`. Flood-fills
 * from each wing room through walkable cells, never crossing into the hub room,
 * so each wing (room + its private corridor) gets a distinct id. Pure given the
 * run; called by the generator and re-runnable on a loaded run.
 */
export function tagHollowGateWings(
    run: HollowGateShrineRun,
    hubRoomId: number,
    wingRoomIds: Array<{ roomId: number; theme: string }>,
): void {
    const { width: w, height: h, tiles } = run;
    const isWalkable = (i: number) => tiles[i] && tiles[i].terrain !== "wall";
    const isHub = (i: number) => tiles[i]?.roomId === hubRoomId;
    const themes: Record<number, string> = {};

    wingRoomIds.forEach(({ roomId, theme }, wingIdx) => {
        themes[wingIdx] = theme;
        // Seed BFS from every cell of this wing's room, flood through corridors,
        // stop at the hub and at walls. Tiles already tagged stay put.
        const seeds: number[] = [];
        for (let i = 0; i < tiles.length; i += 1) {
            if (tiles[i]?.roomId === roomId) seeds.push(i);
        }
        const queue = [...seeds];
        const seen = new Set<number>(seeds);
        while (queue.length) {
            const idx = queue.shift()!;
            if (tiles[idx].wing === undefined) tiles[idx].wing = wingIdx;
            const x = idx % w;
            const y = Math.floor(idx / w);
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const nIdx = ny * w + nx;
                if (seen.has(nIdx) || !isWalkable(nIdx) || isHub(nIdx)) continue;
                if (tiles[nIdx].wing !== undefined) continue; // already another wing
                seen.add(nIdx);
                queue.push(nIdx);
            }
        }
    });
    run.wingThemes = themes;
}

// Result of trying to step onto a cell in `targetWing`. The runtime blocks the
// move when `blocked`, and otherwise applies `commitDetour` / `sealWings` to the
// run. Rules (docs §8): the trial wing is always enterable and never seals;
// entering a detour (treasure/beast) for the first time commits to it and seals
// the OTHER detour; a sealed wing can't be entered. Non-wing floors never gate.
export type WingStep = {
    blocked: boolean;
    message?: string;
    patch?: Pick<HollowGateShrineRun, "committedDetour" | "sealedWings">;
    committedTheme?: string;
};

export function wingEntryEffect(run: HollowGateShrineRun, targetWing: number | undefined): WingStep {
    if (targetWing === undefined) return { blocked: false };       // hub / shared cell
    const themes = run.wingThemes;
    if (!themes) return { blocked: false };                        // legacy / BSP floor — no gating
    if ((run.sealedWings ?? []).includes(targetWing)) {
        return { blocked: true, message: "Chakra chains have sealed this passage — the path you did not take is closed to you now." };
    }
    if (themes[targetWing] === "trial") return { blocked: false }; // the descent path is always open
    if (run.committedDetour == null) {
        const sealWings = Object.keys(themes).map(Number)
            .filter((k) => k !== targetWing && themes[k] !== "trial");
        return {
            blocked: false,
            patch: { committedDetour: targetWing, sealedWings: [...(run.sealedWings ?? []), ...sealWings] },
            committedTheme: themes[targetWing],
        };
    }
    if (run.committedDetour === targetWing) return { blocked: false }; // re-entering your detour
    return { blocked: true, message: "That wing has sealed behind your choice." };
}

// The wing theme a cell belongs to — its own wing, or (for a hub door / shared
// cell) the wing a neighbouring corridor leads into. Lets the renderer color-
// code wings and label the hub doors so the "pick a path" choice is informed.
export function wingThemeAt(run: HollowGateShrineRun, idx: number): string | undefined {
    const themes = run.wingThemes;
    if (!themes) return undefined;
    const t = run.tiles[idx];
    if (t?.wing != null) return themes[t.wing];
    const x = idx % run.width, y = Math.floor(idx / run.width);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= run.width || ny >= run.height) continue;
        const n = run.tiles[ny * run.width + nx];
        if (n?.wing != null) return themes[n.wing];
    }
    return undefined;
}

export const WING_TINT: Record<string, string> = { treasure: "rgba(180,150,60,0.14)", beast: "rgba(190,70,70,0.14)", trial: "rgba(150,90,210,0.15)" };
export const WING_GLYPH: Record<string, string> = { treasure: "🏆", beast: "🐺", trial: "⚔" };

export function generateHollowGateWingRun(floor: number, isFinalFloor: boolean): HollowGateShrineRun {
    const w = HOLLOW_GATE_SHRINE_W;
    const h = HOLLOW_GATE_SHRINE_H;
    const total = w * h;
    const terrain: HollowGateTerrain[] = new Array(total).fill("wall");
    const roomIds: number[] = new Array(total).fill(-1);

    // ── Carve hub + wing rooms (roomId 0 = hub, 1..3 = wings) ──────────────
    const carveRoom = (r: BSPRect, id: number) => {
        for (let ry = r.y; ry < r.y + r.h; ry += 1) {
            for (let rx = r.x; rx < r.x + r.w; rx += 1) {
                if (rx < 0 || ry < 0 || rx >= w || ry >= h) continue;
                const idx = ry * w + rx;
                terrain[idx] = "room_floor";
                roomIds[idx] = id;
            }
        }
    };
    carveRoom(HUB, 0);
    WINGS.forEach((wing, i) => carveRoom(wing.rect, i + 1));

    // ── Connect each wing to the hub ONLY (hub = cut vertex) ───────────────
    for (const lane of WING_CORRIDORS) {
        for (const [cx, cy] of lane) {
            const idx = cy * w + cx;
            if (terrain[idx] === "wall") terrain[idx] = "corridor_floor";
        }
    }

    // ── Mark doors where a corridor first meets a room ─────────────────────
    {
        const touched = new Set<number>();
        for (let i = 0; i < total; i += 1) {
            if (terrain[i] !== "corridor_floor") continue;
            const x = i % w, y = Math.floor(i / w);
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const nIdx = ny * w + nx;
                if (terrain[nIdx] === "room_floor" && !touched.has(nIdx)) {
                    terrain[nIdx] = "door";
                    touched.add(nIdx);
                }
            }
        }
    }

    // ── Spawn (hub center), Leave tile (hub corner), descend/boss (trial) ──
    const hubCenter = center(HUB);
    const playerX = hubCenter.x, playerY = hubCenter.y;
    const spawnIdx = playerY * w + playerX;
    // Bottom-right hub corner — a plain hub cell (no corridor attaches there).
    const exitIdx = (HUB.y + HUB.h - 1) * w + (HUB.x + HUB.w - 1);
    const trialWing = WINGS.findIndex((wg) => wg.theme === "trial");
    const trialC = center(WINGS[trialWing].rect);
    const targetIdx = trialC.y * w + trialC.x;

    const kinds: HollowGateTileKind[] = new Array(total).fill("empty");
    for (let i = 0; i < total; i += 1) if (terrain[i] === "wall") kinds[i] = "wall";
    const reserved = new Set<number>([spawnIdx, exitIdx, targetIdx]);
    kinds[exitIdx] = "exit";
    kinds[targetIdx] = isFinalFloor ? "boss" : "descend";

    const protectedRadius = new Set<number>([spawnIdx]);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nIdx = (playerY + dy) * w + (playerX + dx);
        if (terrain[nIdx] && terrain[nIdx] !== "wall") protectedRadius.add(nIdx);
    }

    // Place `count` tiles of `kind` into the room cells of a specific roomId.
    const placeInRoom = (roomId: number, kind: HollowGateTileKind, count: number) => {
        const cells: number[] = [];
        for (let i = 0; i < total; i += 1) {
            if (roomIds[i] === roomId && terrain[i] === "room_floor"
                && kinds[i] === "empty" && !reserved.has(i) && !protectedRadius.has(i)) {
                cells.push(i);
            }
        }
        for (let k = cells.length - 1; k > 0; k -= 1) {     // shuffle
            const j = Math.floor(Math.random() * (k + 1));
            [cells[k], cells[j]] = [cells[j], cells[k]];
        }
        for (let n = 0; n < count && n < cells.length; n += 1) kinds[cells[n]] = kind;
    };

    const veins = 1 + Math.floor(floor / 2);
    // Treasure wing (roomId 1): loot. Beast wing (roomId 2): combat. Trial wing
    // (roomId of the trial def): elites + a shard cache guarding the descend.
    WINGS.forEach((wing, i) => {
        const roomId = i + 1;
        if (wing.theme === "treasure") {
            placeInRoom(roomId, "chest", 2);
            placeInRoom(roomId, "shard_vein", veins);
            placeInRoom(roomId, "trap", 2);
        } else if (wing.theme === "beast") {
            placeInRoom(roomId, "elite", 1 + Math.floor(floor / 2));
            placeInRoom(roomId, "trap", 1);
            placeInRoom(roomId, "chest", 1);
        } else { // trial
            placeInRoom(roomId, "elite", 1);
            placeInRoom(roomId, "shard_vein", 1);
            placeInRoom(roomId, "trap", 1);
        }
    });
    // Hub: the Shrine Keeper + a story tile.
    placeInRoom(0, "npc", 1);
    placeInRoom(0, "story", 1);

    // ── Validate spawn → exit AND spawn → descend (walls block) ────────────
    const wallSet = new Set<number>();
    for (let i = 0; i < total; i += 1) if (terrain[i] === "wall") wallSet.add(i);
    const reachable = hollowGateReachableSet(w, h, spawnIdx, wallSet);
    if (!reachable.has(exitIdx) || !reachable.has(targetIdx)) {
        // Topology is fixed, so this should never happen — signal the caller to
        // fall back to the legacy generator rather than ship a broken floor.
        throw new Error("hollow-gate wing floor failed reachability");
    }

    const seed = Math.floor(Math.random() * 0x7fffffff);
    const tiles: HollowGateTile[] = kinds.map((kind, i) => ({
        kind,
        terrain: terrain[i],
        roomId: roomIds[i] >= 0 ? roomIds[i] : null,
        revealed: i === spawnIdx,
        resolved: i === spawnIdx,
        flavor: i === spawnIdx ? "You stand at the threshold of the Hollow Gate Shrine." : undefined,
    }));

    const roomThemes: Record<number, string> = {};
    for (let id = 0; id <= WINGS.length; id += 1) roomThemes[id] = pickRoomTheme(id, floor, seed);

    const run: HollowGateShrineRun = {
        width: w, height: h, playerX, playerY, tiles, floor,
        threat: 0, torch: 10, keys: 0, completed: false,
        roomThemes, seed, sealedWings: [], committedDetour: null,
    };
    tagHollowGateWings(
        run, 0,
        WINGS.map((wing, i) => ({ roomId: i + 1, theme: wing.theme })),
    );

    // Cut-vertex self-check: no two DIFFERENT wings may touch directly (they must
    // meet only through the hub). If a corridor lane accidentally bridged two
    // wings, throw so the caller falls back to a legacy floor rather than ship a
    // dungeon where sealing a detour could also seal the descent.
    for (let i = 0; i < tiles.length; i += 1) {
        const wa = tiles[i].wing;
        if (wa === undefined || tiles[i].terrain === "wall") continue;
        const x = i % w, y = Math.floor(i / w);
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx >= w || ny >= h) continue;
            const wb = tiles[ny * w + nx].wing;
            if (wb !== undefined && wb !== wa) {
                throw new Error("hollow-gate wings touch directly (cut-vertex violated)");
            }
        }
    }
    return run;
}
