import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet, PetJutsu } from "../types/pet";
import { PET_OBSTACLE_LAYOUTS, PET_GRID_COLS, PET_GRID_ROWS, PET_GRID_SIZE, PET_SPAWN_1V1, PET_SPAWN_2V2, PET_SPAWN_TILES } from "../constants/pet-arena";
const MID_ROW = Math.floor(PET_GRID_ROWS / 2);
const CEN_COL = Math.floor(PET_GRID_COLS / 2);
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
    petPairBond,
    petHighGroundTiles,
    petPickupTiles,
    petBushTiles,
    petShrineSeekGoal,
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

// ── 2v2 team bonds (type/trait teamwork) ─────────────────────────────────

test("petPairBond: a frontline anchor + a different role is cohesive (stick together)", () => {
    const tank = pet({ trait: "Guardian" });   // → tank (anchor)
    const striker = pet({});                    // default stats → striker
    assert.equal(petPairBond(tank, striker), "cohesive");
});

test("petPairBond: two pure aggressors split (divide and conquer)", () => {
    assert.equal(petPairBond(pet({}), pet({})), "split"); // striker + striker
});

test("petPairBond: a plain duo with no synergy is neutral", () => {
    const statTank = () => pet({ defense: 60 }); // def-heavy → tank, no Guardian trait
    assert.equal(petPairBond(statTank(), statTank()), "neutral");
});

test("petPairBond: kindred element pulls an otherwise-neutral pair to cohesive", () => {
    const fireTank = () => pet({ defense: 60, element: "Fire" });
    assert.equal(petPairBond(fireTank(), fireTank()), "cohesive");          // same element
    assert.equal(petPairBond(pet({ defense: 60, element: "Fire" }), pet({ defense: 60, element: "Water" })), "neutral"); // mixed
});

test("petPairBond is symmetric", () => {
    const a = pet({ trait: "Guardian", element: "Earth" });
    const b = pet({ trait: "Aggressive", attack: 80, defense: 20 });
    assert.equal(petPairBond(a, b), petPairBond(b, a));
    assert.equal(petPairBond(pet({}), a), petPairBond(a, pet({})));
});

// ── High ground (terrain depth) ──────────────────────────────────────────

test("petHighGroundTiles: central spine minus obstacles, Set or array", () => {
    const a = MID_ROW * PET_GRID_COLS + (CEN_COL - 1), b = MID_ROW * PET_GRID_COLS + CEN_COL;
    const hg = petHighGroundTiles([a, b]); // block two central tiles
    assert.ok(hg.size > 0, "non-empty spine");
    assert.ok(!hg.has(a) && !hg.has(b), "an obstacle tile is never high ground");
    for (const t of hg) {
        const col = t % PET_GRID_COLS, row = Math.floor(t / PET_GRID_COLS);
        assert.ok(col === CEN_COL - 1 || col === CEN_COL, `tile ${t} sits on the central spine`);
        assert.ok(row >= MID_ROW - 2 && row <= MID_ROW + 2, `tile ${t} is in the contested middle rows`);
    }
    assert.deepEqual([...petHighGroundTiles(new Set([a, b]))].sort((x, y) => x - y), [...hg].sort((x, y) => x - y));
});

test("petHighGroundTiles: a fully-walled central spine yields no high ground (no crash)", () => {
    const spine: number[] = [];
    for (let row = MID_ROW - 2; row <= MID_ROW + 2; row++) for (const col of [CEN_COL - 1, CEN_COL]) spine.push(row * PET_GRID_COLS + col);
    assert.equal(petHighGroundTiles(spine).size, 0);
});

test("petPickupTiles: a free mirror-symmetric pair, never an obstacle", () => {
    const p = petPickupTiles([]); // open arena
    assert.equal(p.length, 2, "two shrines");
    const [a, b] = p;
    const colA = a % PET_GRID_COLS, colB = b % PET_GRID_COLS;
    const rowA = Math.floor(a / PET_GRID_COLS), rowB = Math.floor(b / PET_GRID_COLS);
    assert.equal(rowA, rowB, "same row (a lane)");
    assert.equal(colA + colB, PET_GRID_COLS - 1, "columns mirror about centre");
    // Blocking the first candidate pair falls through to the next free pair.
    const firstLeft = petPickupTiles([])[0];
    const p2 = petPickupTiles([firstLeft]);
    assert.equal(p2.length, 2);
    assert.ok(!p2.includes(firstLeft), "an obstacle is never a shrine");
});

test("petPickupTiles: every shipped layout leaves a free shrine pair", () => {
    for (let i = 0; i < PET_OBSTACLE_LAYOUTS.length; i++) {
        assert.equal(petPickupTiles(PET_OBSTACLE_LAYOUTS[i]).length, 2, `layout ${i} has shrines`);
    }
});

test("petShrineSeekGoal: detours to an on-the-way shrine, else heads for the foe", () => {
    const tile = (r: number, c: number) => r * PET_GRID_COLS + c;
    const self = tile(3, 1), foe = tile(3, 12);
    const shrine = tile(3, 4); // between self and foe, closer than the foe
    assert.equal(petShrineSeekGoal(self, foe, [shrine]), shrine, "grabs the shrine on the way");
    // No shrines → head for the foe.
    assert.equal(petShrineSeekGoal(self, foe, []), foe);
    // Foe already in melee range → engage, don't wander off for a shrine.
    assert.equal(petShrineSeekGoal(tile(3, 11), foe, [shrine]), foe, "engages when the foe is close");
    // A shrine FARTHER than the foe (behind us) is not worth the detour.
    assert.equal(petShrineSeekGoal(tile(3, 11), foe, [tile(3, 2)]), foe, "ignores a shrine behind us");
    // Picks the nearest of several shrines.
    assert.equal(petShrineSeekGoal(self, foe, [tile(3, 9), tile(3, 4)]), tile(3, 4), "nearest shrine wins");
});

test("petBushTiles: mirror-symmetric flank patches, free of obstacles, capped", () => {
    const b = petBushTiles([]);
    assert.ok(b.size >= 2 && b.size <= 4 && b.size % 2 === 0, "even count, capped at 4");
    for (const t of b) assert.ok(t % PET_GRID_COLS <= 4 || t % PET_GRID_COLS >= PET_GRID_COLS - 5, "bushes hug the flanks");
    // Blocking a candidate pair drops it but others remain.
    const first = [...petBushTiles([])][0];
    const blocked = petBushTiles([first]);
    assert.ok(!blocked.has(first), "an obstacle is never a bush");
    assert.ok(blocked.size >= 2, "falls through to other free pairs");
});

// ── Obstacle layout validity ─────────────────────────────────────────────
// Every maze layout must be NAVIGABLE: it can't bury a spawn, and a pet must
// always be able to BFS-reach its foe through the gaps. Guards future redesigns.
const SPAWN_TILES = PET_SPAWN_TILES;
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

test("every cover layout is navigable (no buried spawns, in-grid, foes can always meet)", () => {
    PET_OBSTACLE_LAYOUTS.forEach((layout, i) => {
        const blocked = new Set(layout);
        // No spawn tile is ever a wall.
        for (const s of SPAWN_TILES) {
            assert.ok(!blocked.has(s), `layout ${i} buries spawn tile ${s}`);
        }
        // Light cover (a few pillars), in-grid.
        assert.ok(layout.length >= 1 && layout.length <= 0.4 * PET_GRID_SIZE, `layout ${i} obstacle count ${layout.length} off-spec`);
        for (const idx of layout) {
            assert.ok(idx >= 0 && idx < PET_GRID_SIZE, `layout ${i} tile ${idx} off-grid`);
        }
        // A BFS path ALWAYS links the 1v1 spawns AND every 2v2 cross-pair —
        // every wall's gap is reachable, so no pet is ever trapped.
        assert.ok(bfsReachable(blocked, PET_SPAWN_1V1.player, PET_SPAWN_1V1.enemy), `layout ${i}: 1v1 spawns unreachable`);
        for (const p of [PET_SPAWN_2V2.playerLead, PET_SPAWN_2V2.playerReserve]) {
            for (const e of [PET_SPAWN_2V2.enemyLead, PET_SPAWN_2V2.enemyReserve]) {
                assert.ok(bfsReachable(blocked, p, e), `layout ${i}: 2v2 spawn ${p}→${e} unreachable`);
            }
        }
    });
});
