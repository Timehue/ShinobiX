/*
 * Pet-battle TACTICAL model + helpers (Phases 5-6).
 *
 * Pure, node-testable, and free of any ../App import. Defines the tactical
 * battle-state types (PetBattleActor / PetArchetype / BattleStatus), the arena
 * tile-type model (ArenaTile / ArenaTileType), grid helpers (distance, range,
 * pathing, line-of-sight, tile queries), a deterministic tile-type builder for
 * the existing obstacle layouts, and an archetype deriver.
 *
 * The simulator (App.tsx runPetArenaBattle) stays the source of truth for
 * outcomes; it consumes the tile Sets this module builds to apply cover /
 * hazard / healing / slow effects. Everything here is a pure function of its
 * inputs, so ranked replays (identical canonical sim on both clients) stay in
 * sync and no RNG is consumed.
 */

import type { Pet } from "../types/pet";
import type { PetBattleAnimationEvent } from "../types/pet-battle";
import { PET_GRID_COLS, PET_GRID_ROWS, PET_GRID_SIZE } from "../constants/pet-arena";

// ── Core tactical types ─────────────────────────────────────────────────────

export type PetArchetype =
    | "bruiser"
    | "tank"
    | "striker"
    | "kite"
    | "support"
    | "control"
    | "assassin";

/** An active combat status on an actor. Mirrors the simulator's status flags
 *  in a serializable, tactical-layer-friendly shape. */
export type BattleStatus = {
    kind:
        | "burn" | "freeze" | "confuse" | "stun" | "poison"
        | "atkBuff" | "defBuff" | "shield" | "moveLock" | "absorb"
        // Phase-12 archetype statuses — surfaced so the scorer's anti-waste can
        // see them (don't re-wound an already-bleeding foe, don't re-slow, etc.).
        | "wound" | "marked" | "slow" | "haste";
    rounds: number;
    magnitude?: number;
};

export type PetBattleActor = {
    id: string;
    name: string;
    hp: number;
    maxHp: number;
    position: { row: number; col: number };
    archetype: PetArchetype;
    statuses: BattleStatus[];
    cooldowns: Record<string, number>;
    guardValue?: number;
    shieldValue?: number;
    isCharging?: boolean;
    chargedMoveId?: string;
    lastAction?: string;
};

// ── Team / battle-state model (Phase 13) ────────────────────────────────────
// The engine no longer assumes one actor per side. A team holds its full
// roster plus which pets are currently fielded (activePetIds) — 1 for 1v1, 2
// for 2v2. PetBattleState is the canonical, mode-aware battle container; the
// existing 1v1 / 2v2 simulators can project into and out of it.
export type PetBattleMode = "pve_1v1" | "pve_2v2" | "ranked_1v1" | "ranked_2v2";

export type PetBattleTeam = {
    side: "player" | "enemy";
    pets: PetBattleActor[];
    activePetIds: string[];
};

export type PetBattleState = {
    mode: PetBattleMode;
    teams: {
        player: PetBattleTeam;
        enemy: PetBattleTeam;
    };
    turnNumber: number;
    arena: ArenaTile[];
    animationQueue: PetBattleAnimationEvent[];
    battleLog: string[];
};

// ── Arena tile model ────────────────────────────────────────────────────────

export type ArenaTileType =
    | "normal"
    | "blocked"
    | "cover"
    | "hazard"
    | "healing"
    | "slow";

export type ArenaTile = {
    row: number;
    col: number;
    type: ArenaTileType;
};

/** Compiled arena — a fast tile-type lookup over the grid. */
export type Arena = {
    cols: number;
    rows: number;
    types: Map<number, ArenaTileType>;
};

// ── Index / coordinate helpers ──────────────────────────────────────────────

export function tileToIndex(row: number, col: number): number {
    return row * PET_GRID_COLS + col;
}
export function indexToTile(index: number): { row: number; col: number } {
    return { row: Math.floor(index / PET_GRID_COLS), col: index % PET_GRID_COLS };
}

export function makeArena(tiles: ArenaTile[]): Arena {
    const types = new Map<number, ArenaTileType>();
    for (const t of tiles) types.set(tileToIndex(t.row, t.col), t.type);
    return { cols: PET_GRID_COLS, rows: PET_GRID_ROWS, types };
}

/** Tile type at a coordinate. Out-of-bounds reads as "blocked" (a wall). */
export function arenaTileType(arena: Arena, row: number, col: number): ArenaTileType {
    if (row < 0 || col < 0 || row >= arena.rows || col >= arena.cols) return "blocked";
    return arena.types.get(tileToIndex(row, col)) ?? "normal";
}

// ── Tile-type queries ───────────────────────────────────────────────────────

export function isTileBlocked(tile: ArenaTile | undefined): boolean {
    return tile?.type === "blocked";
}
export function isTileCover(tile: ArenaTile | undefined): boolean {
    return tile?.type === "cover";
}
/** Blocked AND cover are impassable — pets path AROUND both. */
export function isImpassableType(type: ArenaTileType): boolean {
    return type === "blocked" || type === "cover";
}
function isPassable(arena: Arena, row: number, col: number, occupied?: ReadonlySet<number>): boolean {
    if (isImpassableType(arenaTileType(arena, row, col))) return false;
    if (occupied?.has(tileToIndex(row, col))) return false;
    return true;
}

// ── Distance / range ────────────────────────────────────────────────────────

/** Manhattan distance between two actors (grid steps, no diagonals). */
export function getDistance(actorA: PetBattleActor, actorB: PetBattleActor): number {
    return Math.abs(actorA.position.row - actorB.position.row)
        + Math.abs(actorA.position.col - actorB.position.col);
}

/** Whether a move (by its tile range) can reach actorB from actorA. */
export function isInRange(move: { range: number }, actorA: PetBattleActor, actorB: PetBattleActor): boolean {
    return getDistance(actorA, actorB) <= move.range;
}

// ── Line of sight ───────────────────────────────────────────────────────────

/** Bresenham line walk from actor → target. Blocked + cover tiles break sight
 *  (the endpoints themselves are not checked). Adjacent actors always see. */
export function hasLineOfSight(actor: PetBattleActor, target: PetBattleActor, arena: Arena): boolean {
    let x0 = actor.position.col, y0 = actor.position.row;
    const x1 = target.position.col, y1 = target.position.row;
    if (x0 === x1 && y0 === y1) return true;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (let steps = 0; steps < PET_GRID_SIZE; steps++) {
        if (x0 === x1 && y0 === y1) return true;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx)  { err += dx; y0 += sy; }
        if (x0 === x1 && y0 === y1) return true;   // reached target — endpoint not a blocker
        if (isImpassableType(arenaTileType(arena, y0, x0))) return false;
    }
    return true;
}

// ── Pathing ─────────────────────────────────────────────────────────────────

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/** BFS one step from actor toward target, routing around impassable tiles.
 *  Returns the next coordinate to step onto (actor's own tile if no path). */
export function moveToward(
    actor: PetBattleActor,
    target: PetBattleActor,
    arena?: Arena,
    occupied?: ReadonlySet<number>,
): { row: number; col: number } {
    const start = actor.position, goal = target.position;
    if (start.row === goal.row && start.col === goal.col) return { ...start };
    // No arena → greedy step (used by callers that don't model obstacles).
    if (!arena) {
        const stepRow = Math.sign(goal.row - start.row);
        const stepCol = Math.sign(goal.col - start.col);
        return Math.abs(goal.row - start.row) >= Math.abs(goal.col - start.col)
            ? { row: start.row + stepRow, col: start.col }
            : { row: start.row, col: start.col + stepCol };
    }
    const startIdx = tileToIndex(start.row, start.col);
    const goalIdx = tileToIndex(goal.row, goal.col);
    const queue: number[] = [startIdx];
    const parent = new Map<number, number>([[startIdx, -1]]);
    while (queue.length) {
        const curr = queue.shift()!;
        if (curr === goalIdx) {
            let step = curr;
            while (parent.get(step) !== startIdx) step = parent.get(step)!;
            return indexToTile(step);
        }
        const { row, col } = indexToTile(curr);
        for (const [dr, dc] of NEIGHBORS) {
            const nr = row + dr, nc = col + dc;
            if (nr < 0 || nc < 0 || nr >= arena.rows || nc >= arena.cols) continue;
            const nIdx = tileToIndex(nr, nc);
            if (parent.has(nIdx)) continue;
            // The goal tile itself is allowed even if occupied (it's the target).
            const passable = nIdx === goalIdx || isPassable(arena, nr, nc, occupied);
            if (!passable) continue;
            parent.set(nIdx, curr);
            queue.push(nIdx);
        }
    }
    return { ...start }; // no path — hold position
}

/** Step to the adjacent passable tile that maximizes distance from the target
 *  (the core of kiting). Returns the actor's tile if no better neighbor. */
export function moveAway(
    actor: PetBattleActor,
    target: PetBattleActor,
    arena?: Arena,
    occupied?: ReadonlySet<number>,
): { row: number; col: number } {
    const { row, col } = actor.position;
    // Direction that points away from the target (per axis), for tie-breaking.
    const awayRow = Math.sign(row - target.position.row);
    const awayCol = Math.sign(col - target.position.col);
    let best = { row, col };
    let bestDist = Math.abs(row - target.position.row) + Math.abs(col - target.position.col);
    let bestAlign = 0;
    for (const [dr, dc] of NEIGHBORS) {
        const nr = row + dr, nc = col + dc;
        if (arena && !isPassable(arena, nr, nc, occupied)) continue;
        if (!arena && (nr < 0 || nc < 0 || nr >= PET_GRID_ROWS || nc >= PET_GRID_COLS)) continue;
        const d = Math.abs(nr - target.position.row) + Math.abs(nc - target.position.col);
        const align = dr * awayRow + dc * awayCol; // +1 when the step retreats along the away axis
        if (d > bestDist || (d === bestDist && align > bestAlign)) {
            bestDist = d; bestAlign = align; best = { row: nr, col: nc };
        }
    }
    return best;
}

export type BattleState = { arena: Arena; actors: PetBattleActor[] };

/** Every tile an actor can legally reach this turn (BFS within its archetype's
 *  move range), excluding impassable tiles and tiles occupied by other actors. */
export function getValidMoveTiles(actor: PetBattleActor, battleState: BattleState): { row: number; col: number }[] {
    const range = archetypeMoveRange(actor.archetype);
    const occupied = new Set<number>(
        battleState.actors.filter(a => a.id !== actor.id).map(a => tileToIndex(a.position.row, a.position.col)),
    );
    const startIdx = tileToIndex(actor.position.row, actor.position.col);
    const dist = new Map<number, number>([[startIdx, 0]]);
    const queue: number[] = [startIdx];
    const out: { row: number; col: number }[] = [];
    while (queue.length) {
        const curr = queue.shift()!;
        const d = dist.get(curr)!;
        if (curr !== startIdx) out.push(indexToTile(curr));
        if (d >= range) continue;
        const { row, col } = indexToTile(curr);
        for (const [dr, dc] of NEIGHBORS) {
            const nr = row + dr, nc = col + dc;
            const nIdx = tileToIndex(nr, nc);
            if (dist.has(nIdx)) continue;
            if (!isPassable(battleState.arena, nr, nc, occupied)) continue;
            dist.set(nIdx, d + 1);
            queue.push(nIdx);
        }
    }
    return out;
}

/** Tiles a given archetype can travel per turn. */
export function archetypeMoveRange(archetype: PetArchetype): number {
    switch (archetype) {
        case "kite":
        case "striker":
        case "assassin": return 4;
        case "bruiser":
        case "control": return 3;
        case "tank":
        case "support": return 2;
        default: return 3;
    }
}

// ── Archetype derivation ────────────────────────────────────────────────────

const CONTROL_KINDS = new Set(["movelock", "freeze", "stun", "confuse"]);
const SUPPORT_KINDS = new Set(["heal", "barrier", "shield", "absorb"]);
const RANGED_KINDS = new Set(["dot", "debuff", "movelock", "freeze", "stun", "confuse", "burn"]);

/**
 * Derive a pet's combat archetype from its kit + trait + stat shape. Pure +
 * deterministic. Priority: dedicated supporters/controllers first, then trait
 * identity, then stat shape, defaulting to a balanced striker.
 */
export function petArchetypeFor(pet: Pick<Pet, "jutsus" | "trait" | "attack" | "defense" | "speed" | "hp">): PetArchetype {
    const jutsus = pet.jutsus ?? [];
    const controlCount = jutsus.filter(j => CONTROL_KINDS.has(j.kind)).length;
    const supportCount = jutsus.filter(j => SUPPORT_KINDS.has(j.kind)).length;
    const hasHeal = jutsus.some(j => j.kind === "heal");
    const hasRanged = jutsus.some(j => RANGED_KINDS.has(j.kind));
    const atk = pet.attack ?? 0, def = pet.defense ?? 0, spd = pet.speed ?? 0;
    const trait = pet.trait;

    if (supportCount >= 2 || (hasHeal && supportCount >= 1)) return "support";
    if (controlCount >= 2) return "control";
    if (trait === "Guardian" || def >= atk * 1.35) return "tank";
    if (trait === "Aggressive") return atk >= def * 1.8 ? "assassin" : "bruiser";
    if (trait === "Swift" || spd > atk * 1.15) return hasRanged ? "kite" : "assassin";
    if (hasRanged) return "kite";
    if (def > atk) return "tank";
    return atk >= def * 1.5 ? "bruiser" : "striker";
}

// ── 2v2 team bond (Phase: type/trait teamwork) ───────────────────────────────
// Whether two ALLIED pets "work well together". Frontline/support anchors + a
// kindred element + loyal/protective traits make a cohesive pair that sticks
// together and focus-fires one foe; two pure aggressors (or twin flankers)
// divide and conquer, spreading to pressure both foes. Pure, symmetric, and
// deterministic (NO RNG) so ranked party replays stay in sync, and it drives
// ONLY target PREFERENCE in the 2v2 engine — never damage/odds/rewards.
const AGGRO_ARCHETYPES = new Set<PetArchetype>(["assassin", "striker", "bruiser"]);
const ANCHOR_ARCHETYPES = new Set<PetArchetype>(["tank", "support"]);

export type PetPairBond = "cohesive" | "neutral" | "split";

export function petPairBond(
    a: Pick<Pet, "jutsus" | "trait" | "attack" | "defense" | "speed" | "hp" | "element">,
    b: Pick<Pet, "jutsus" | "trait" | "attack" | "defense" | "speed" | "hp" | "element">,
): PetPairBond {
    let score = 0;
    // Kindred chakra nature fights as one.
    if (a.element && a.element !== "None" && a.element === b.element) score += 1.5;
    // Traits — protectors + loyal/team-player traits bind the pair; twin
    // attackers and twin flankers each spread out.
    const has = (t: string) => a.trait === t || b.trait === t;
    const both = (t: string) => a.trait === t && b.trait === t;
    if (both("Aggressive")) score -= 1.5;
    else if (has("Guardian")) score += 1;
    if (both("Swift")) score -= 1;
    if (has("Battleborn")) score += 0.5;
    if (has("Loyal")) score += 0.5;
    // Roles — an anchor (frontline/support) beside a DIFFERENT role is the
    // classic comp; two pure aggressors divide and conquer.
    const ra = petArchetypeFor(a), rb = petArchetypeFor(b);
    if (AGGRO_ARCHETYPES.has(ra) && AGGRO_ARCHETYPES.has(rb)) score -= 1.5;
    else if ((ANCHOR_ARCHETYPES.has(ra) || ANCHOR_ARCHETYPES.has(rb)) && ra !== rb) score += 1.5;
    if (score >= 1) return "cohesive";
    if (score <= -1) return "split";
    return "neutral";
}

// ── Deterministic tile-type builder ─────────────────────────────────────────

// Lane candidate tiles (rows 2-4, central-ish columns) used to place
// hazard / healing / slow accents. Kept off the start tiles (43 player,
// 54 enemy) and only used when not already an obstacle.
const ACCENT_CANDIDATES: ReadonlyArray<number> = [
    // row 2 (cols 3,5,8,10), row 3 (cols 4,6,9), row 4 (cols 3,5,8,10)
    31, 33, 36, 38,
    46, 48, 51,
    59, 61, 64, 66,
];
const START_TILES = new Set<number>([43, 54]);

/**
 * Build the arena tile types for a battle from its chosen obstacle layout.
 * Fully deterministic (a pure function of the layout + its index) — consumes
 * NO RNG, so it never shifts the simulator's existing roll sequence; only the
 * tile EFFECTS change outcomes.
 *
 * - Obstacles near the centre columns (5-8) become COVER (a defender hugging
 *   them takes less ranged damage); the rest stay BLOCKED. Both are impassable.
 * - A small, rotating set of lane tiles become HAZARD / HEALING / SLOW.
 *
 * Returns the non-normal tiles (for rendering) plus fast Sets (for the sim).
 */
export function buildArenaTiles(obstacleLayout: ReadonlyArray<number>, layoutIndex: number): {
    tiles: ArenaTile[];
    blocked: Set<number>;
    cover: Set<number>;
    hazard: Set<number>;
    healing: Set<number>;
    slow: Set<number>;
} {
    const obstacles = new Set<number>(obstacleLayout);
    const cover = new Set<number>();
    const blocked = new Set<number>();
    // Split obstacles into cover (central) vs blocked. Cap cover at 3 so a
    // layout never becomes all-cover.
    const centralObstacles = obstacleLayout.filter(idx => {
        const col = idx % PET_GRID_COLS;
        return col >= 5 && col <= 8;
    });
    const coverPicks = (centralObstacles.length ? centralObstacles : [...obstacleLayout]).slice(0, 3);
    for (const idx of obstacleLayout) {
        if (coverPicks.includes(idx)) cover.add(idx);
        else blocked.add(idx);
    }

    // Place hazard / healing / slow on free lane tiles, rotated by layoutIndex
    // so different layouts feature different accents. Two of each at most.
    const hazard = new Set<number>();
    const healing = new Set<number>();
    const slow = new Set<number>();
    const free = ACCENT_CANDIDATES.filter(idx => !obstacles.has(idx) && !START_TILES.has(idx));
    const buckets: Array<Set<number>> = [hazard, healing, slow];
    const caps = [2, 2, 2];
    let placed = 0;
    for (let i = 0; i < free.length && placed < 6; i++) {
        const tile = free[(i + layoutIndex) % free.length];
        const bucketIdx = (i + layoutIndex) % 3;
        const bucket = buckets[bucketIdx];
        if (bucket.size >= caps[bucketIdx]) continue;
        if (hazard.has(tile) || healing.has(tile) || slow.has(tile)) continue;
        bucket.add(tile);
        placed++;
    }

    const tiles: ArenaTile[] = [];
    const push = (idx: number, type: ArenaTileType) => {
        const { row, col } = indexToTile(idx);
        tiles.push({ row, col, type });
    };
    blocked.forEach(idx => push(idx, "blocked"));
    cover.forEach(idx => push(idx, "cover"));
    hazard.forEach(idx => push(idx, "hazard"));
    healing.forEach(idx => push(idx, "healing"));
    slow.forEach(idx => push(idx, "slow"));
    return { tiles, blocked, cover, hazard, healing, slow };
}

// ── High ground (terrain depth) ──────────────────────────────────────────────
// The contested central spine (cols 6-7, rows 2-5) minus any obstacle sitting on
// it. A pet that ENDS a round holding high ground earns a protective ward in the
// sim, and the renderer marks the tiles — so positioning for the centre matters.
// Derived purely from the obstacle list, so the 1v1 + 2v2 engines AND the
// renderer all agree WITHOUT needing the full typed-tile system in 2v2. Pure +
// deterministic (no RNG) → ranked stays synced.
const HIGH_GROUND_CANDIDATES: readonly number[] = (() => {
    const out: number[] = [];
    for (let row = 2; row <= 5; row++) for (let col = 6; col <= 7; col++) out.push(row * PET_GRID_COLS + col);
    return out;
})();
export function petHighGroundTiles(obstacles: ReadonlySet<number> | ReadonlyArray<number>): Set<number> {
    const blocked = obstacles instanceof Set ? obstacles : new Set(obstacles);
    return new Set(HIGH_GROUND_CANDIDATES.filter(t => !blocked.has(t)));
}

// ── Power pickups (terrain depth) ────────────────────────────────────────────
// Two mirror-symmetric "shrine" tiles on the approach lanes, free of obstacles.
// A pet that reaches one claims a one-time surge (attack + a small restore). The
// pair is symmetric so ranked stays fair; the first all-free pair is chosen so a
// layout never buries both shrines. Pure + deterministic (derived from the
// obstacle list, so the 1v1 + 2v2 engines + the renderer agree).
const PICKUP_PAIR_CANDIDATES: readonly (readonly [number, number])[] = [
    [3 * PET_GRID_COLS + 4, 3 * PET_GRID_COLS + 9],   // (3,4)+(3,9) — main mid-lane
    [2 * PET_GRID_COLS + 4, 2 * PET_GRID_COLS + 9],   // (2,4)+(2,9)
    [4 * PET_GRID_COLS + 4, 4 * PET_GRID_COLS + 9],   // (4,4)+(4,9)
    [3 * PET_GRID_COLS + 3, 3 * PET_GRID_COLS + 10],  // (3,3)+(3,10)
];
export function petPickupTiles(obstacles: ReadonlySet<number> | ReadonlyArray<number>): number[] {
    const blocked = obstacles instanceof Set ? obstacles : new Set(obstacles);
    for (const [a, b] of PICKUP_PAIR_CANDIDATES) {
        if (!blocked.has(a) && !blocked.has(b)) return [a, b];
    }
    return [];
}

// ── Tactical zones (Phase 10-14) ────────────────────────────────────────────
// The 14-wide grid is huge; zones focus the fight around the middle. Cover and
// hazard tiles read as their own zones; otherwise columns band into backline
// (outer), midline, and the contested frontline (centre two columns). Pets
// naturally converge on the frontline + use cover, so not every tile is needed.
export type ArenaZone = "backline" | "midline" | "frontline" | "cover" | "danger";

export function petTacticalZone(col: number, tileType?: ArenaTileType): ArenaZone {
    if (tileType === "cover") return "cover";
    if (tileType === "hazard") return "danger";
    if (col >= 6 && col <= 7) return "frontline";
    if (col >= 4 && col <= 9) return "midline";
    return "backline";
}

/** Manhattan adjacency test against a tile Set (used for the cover bonus). */
export function isAdjacentToAny(pos: number, tiles: ReadonlySet<number>): boolean {
    if (!tiles.size) return false;
    const { row, col } = indexToTile(pos);
    for (const [dr, dc] of NEIGHBORS) {
        const nr = row + dr, nc = col + dc;
        if (nr < 0 || nc < 0 || nr >= PET_GRID_ROWS || nc >= PET_GRID_COLS) continue;
        if (tiles.has(tileToIndex(nr, nc))) return true;
    }
    return false;
}
