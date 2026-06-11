import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet, PetJutsu } from "../types/pet";
import { PET_OBSTACLE_LAYOUTS, PET_GRID_COLS, PET_GRID_ROWS, PET_GRID_SIZE } from "../constants/pet-arena";
import {
    getDistance,
    isInRange,
    isTileBlocked,
    isTileCover,
    hasLineOfSight,
    moveToward,
    moveAway,
    getValidMoveTiles,
    petArchetypeFor,
    buildArenaTiles,
    makeArena,
    isAdjacentToAny,
    tileToIndex,
    type PetBattleActor,
} from "./pet-tactics";

function actor(row: number, col: number, over: Partial<PetBattleActor> = {}): PetBattleActor {
    return { id: over.id ?? `a-${row}-${col}`, name: "T", hp: 100, maxHp: 100, position: { row, col }, archetype: "striker", statuses: [], cooldowns: {}, ...over };
}
function jutsu(kind: PetJutsu["kind"]): PetJutsu {
    return { name: kind, power: 50, cooldown: 3, currentCooldown: 0, kind };
}
function pet(over: Partial<Pet>): Pet {
    return { id: "standard-1", name: "P", rarity: "standard", level: 1, xp: 0, maxLevel: 50, hp: 100, attack: 30, defense: 30, speed: 30, jutsus: [], unlockedForPve: false, ...over } as Pet;
}

// ── Distance / range ─────────────────────────────────────────────────────

test("getDistance is Manhattan", () => {
    assert.equal(getDistance(actor(3, 1), actor(3, 5)), 4);
    assert.equal(getDistance(actor(1, 1), actor(4, 3)), 5);
});

test("isInRange compares distance to move range", () => {
    assert.equal(isInRange({ range: 2 }, actor(3, 1), actor(3, 3)), true);
    assert.equal(isInRange({ range: 2 }, actor(3, 1), actor(3, 4)), false);
});

// ── Tile queries ─────────────────────────────────────────────────────────

test("isTileBlocked / isTileCover read the tile type", () => {
    assert.equal(isTileBlocked({ row: 0, col: 0, type: "blocked" }), true);
    assert.equal(isTileBlocked({ row: 0, col: 0, type: "cover" }), false);
    assert.equal(isTileCover({ row: 0, col: 0, type: "cover" }), true);
    assert.equal(isTileBlocked(undefined), false);
});

// ── Line of sight ────────────────────────────────────────────────────────

test("hasLineOfSight: clear lane sees, a wall in the way blocks", () => {
    const clear = makeArena([]);
    assert.equal(hasLineOfSight(actor(3, 2), actor(3, 6), clear), true);
    const walled = makeArena([{ row: 3, col: 4, type: "blocked" }]);
    assert.equal(hasLineOfSight(actor(3, 2), actor(3, 6), walled), false);
    // Cover also breaks sight (you fire around it, at reduced damage — handled in the sim).
    const covered = makeArena([{ row: 3, col: 4, type: "cover" }]);
    assert.equal(hasLineOfSight(actor(3, 2), actor(3, 6), covered), false);
});

// ── Pathing ──────────────────────────────────────────────────────────────

test("moveToward greedy (no arena) steps along the dominant axis", () => {
    assert.deepEqual(moveToward(actor(3, 1), actor(3, 5)), { row: 3, col: 2 });
    assert.deepEqual(moveToward(actor(1, 3), actor(5, 3)), { row: 2, col: 3 });
});

test("moveToward routes AROUND a blocked tile instead of through it", () => {
    const arena = makeArena([
        { row: 2, col: 3, type: "blocked" },
        { row: 3, col: 3, type: "blocked" },
        { row: 4, col: 3, type: "blocked" },
    ]);
    const step = moveToward(actor(3, 1), actor(3, 5), arena);
    // Never steps onto a blocked tile, and actually moves.
    assert.notDeepEqual(step, { row: 3, col: 3 });
    assert.notDeepEqual(step, { row: 3, col: 1 });
    assert.equal(arena.types.get(tileToIndex(step.row, step.col)) ?? "normal", "normal");
});

test("moveAway picks the neighbor that increases distance", () => {
    assert.deepEqual(moveAway(actor(3, 5), actor(3, 2)), { row: 3, col: 6 });
});

test("getValidMoveTiles stays within range and avoids walls / occupants", () => {
    const arena = makeArena([{ row: 3, col: 5, type: "blocked" }]);
    const me = actor(3, 3, { archetype: "tank" }); // tank → move range 2
    const other = actor(3, 4, { id: "other" });
    const tiles = getValidMoveTiles(me, { arena, actors: [me, other] });
    for (const t of tiles) {
        assert.ok(Math.abs(t.row - 3) + Math.abs(t.col - 3) <= 2, "within range");
        assert.ok(!(t.row === 3 && t.col === 5), "no blocked tile");
        assert.ok(!(t.row === 3 && t.col === 4), "no occupied tile");
        assert.ok(!(t.row === 3 && t.col === 3), "excludes its own tile");
    }
    assert.ok(tiles.length > 0);
});

// ── Archetype ──────────────────────────────────────────────────────────────

test("petArchetypeFor derives a sensible archetype", () => {
    assert.equal(petArchetypeFor(pet({ trait: "Guardian" })), "tank");
    assert.equal(petArchetypeFor(pet({ jutsus: [jutsu("heal"), jutsu("shield")] })), "support");
    assert.equal(petArchetypeFor(pet({ jutsus: [jutsu("movelock"), jutsu("freeze")] })), "control");
    assert.equal(petArchetypeFor(pet({ trait: "Aggressive", attack: 90, defense: 30 })), "assassin");
    assert.equal(petArchetypeFor(pet({ trait: "Swift", speed: 90, attack: 40, jutsus: [jutsu("dot")] })), "kite");
    assert.equal(petArchetypeFor(pet({ attack: 30, defense: 30, jutsus: [jutsu("damage")] })), "striker");
});

// ── Tile builder ─────────────────────────────────────────────────────────

test("buildArenaTiles: cover ⊆ obstacles, blocked ∪ cover = obstacles, accents are free lane tiles", () => {
    const layout = [48, 49, 50, 62, 63, 64]; // "Central Rock"
    const r = buildArenaTiles(layout, 3);
    const obstacleSet = new Set(layout);
    // cover + blocked exactly partition the obstacles
    assert.deepEqual(new Set([...r.blocked, ...r.cover]), obstacleSet);
    for (const c of r.cover) assert.ok(obstacleSet.has(c));
    assert.ok(r.cover.size <= 3);
    // hazard / healing / slow never land on obstacles or the start tiles, and are disjoint
    const accents = [...r.hazard, ...r.healing, ...r.slow];
    const accentSet = new Set(accents);
    assert.equal(accents.length, accentSet.size, "accents are disjoint");
    for (const a of accents) {
        assert.ok(!obstacleSet.has(a), "accent not on an obstacle");
        assert.ok(a !== 43 && a !== 54, "accent not on a start tile");
    }
});

test("buildArenaTiles is deterministic for the same layout + index", () => {
    const layout = [33, 47, 48, 65, 79, 78];
    const a = buildArenaTiles(layout, 1);
    const b = buildArenaTiles(layout, 1);
    assert.deepEqual(a.tiles.map(t => `${t.row},${t.col},${t.type}`).sort(), b.tiles.map(t => `${t.row},${t.col},${t.type}`).sort());
});

test("isAdjacentToAny detects an orthogonally adjacent tile", () => {
    const cover = new Set([tileToIndex(3, 5)]);
    assert.equal(isAdjacentToAny(tileToIndex(3, 4), cover), true);  // left of cover
    assert.equal(isAdjacentToAny(tileToIndex(3, 6), cover), true);  // right of cover
    assert.equal(isAdjacentToAny(tileToIndex(3, 7), cover), false); // two away
    assert.equal(isAdjacentToAny(tileToIndex(3, 5), cover), false); // same tile, not adjacent
});

// ── Obstacle layout validity ─────────────────────────────────────────────
// Every hand-designed battlefield must be PLAYABLE: it can't bury a spawn, and
// a pet must always be able to reach its foe. Guards future map redesigns.
const SPAWN_TILES = [43, 54, 29, 57, 40, 68]; // 1v1 player/enemy + 2v2 four slots
function bfsReachable(blocked: Set<number>, from: number, to: number): boolean {
    if (blocked.has(from) || blocked.has(to)) return false;
    const seen = new Set<number>([from]);
    const q = [from];
    while (q.length) {
        const cur = q.shift()!;
        if (cur === to) return true;
        const r = Math.floor(cur / PET_GRID_COLS), c = cur % PET_GRID_COLS;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= PET_GRID_ROWS || nc < 0 || nc >= PET_GRID_COLS) continue;
            const ni = nr * PET_GRID_COLS + nc;
            if (seen.has(ni) || blocked.has(ni)) continue;
            seen.add(ni); q.push(ni);
        }
    }
    return false;
}

test("every obstacle layout is a playable battlefield (no buried spawns, sane density, foes can meet)", () => {
    PET_OBSTACLE_LAYOUTS.forEach((layout, i) => {
        const blocked = new Set(layout);
        // No spawn tile is ever an obstacle.
        for (const s of SPAWN_TILES) {
            assert.ok(!blocked.has(s), `layout ${i} buries spawn tile ${s}`);
        }
        // Sane density — designed, not empty, not a maze.
        assert.ok(layout.length >= 4 && layout.length <= 12, `layout ${i} has off-spec obstacle count ${layout.length}`);
        // Indices are in-grid and row 0 / row 6 stay clear (guaranteed lanes).
        for (const idx of layout) {
            assert.ok(idx >= 0 && idx < PET_GRID_SIZE, `layout ${i} tile ${idx} off-grid`);
            const row = Math.floor(idx / PET_GRID_COLS);
            assert.ok(row >= 1 && row <= 5, `layout ${i} tile ${idx} should keep rows 0 and 6 clear`);
        }
        // A path always exists between the 1v1 spawns AND every 2v2 cross-pair.
        assert.ok(bfsReachable(blocked, 43, 54), `layout ${i}: 1v1 spawns unreachable`);
        for (const p of [29, 57]) for (const e of [40, 68]) {
            assert.ok(bfsReachable(blocked, p, e), `layout ${i}: 2v2 spawn ${p}→${e} unreachable`);
        }
    });
});
