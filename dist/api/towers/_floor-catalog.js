"use strict";
/*
 * Battle Towers — floor catalog (schema + v1 seed floors).
 *
 * Each floor is a curated tactical map: an objective, a map size, a field-rule
 * affix, enemy pods (+ an optional boss / NPC / goal tile), and a one-time
 * first-clear reward. The engine (api/towers/_engine.ts, Phase 1) INTERPRETS this
 * data — so new floors are content, not code. See docs/battle-towers-plan.md §19/§24.
 *
 * `aiId` / `npc.aiId` reference enemy templates that Phase 1 resolves from the
 * existing AI catalog (lib/combat-ai.ts builtinAis); here they are opaque ids the
 * validator only shape-checks. Rewards are ONE-TIME first-clear (Option A / no
 * seasons, Decision 5) and are paid server-side in api/towers/settle.ts, never
 * from the client.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PARTY_SCALE_FLOOR = exports.DEFAULT_PARTY_SIZE = exports.MAX_PARTY_SIZE = exports.MIN_PARTY_SIZE = exports.TOWER_FLOOR_COUNT = exports.FLOOR_CATALOG = exports.TOWER_BIOMES = exports.OBJECTIVES_NEEDING_GOAL = exports.OBJECTIVES_NEEDING_NPC = exports.OBJECTIVES_NEEDING_BOSS = exports.TOWER_OBJECTIVES = void 0;
exports.hexZone = hexZone;
exports.getFloor = getFloor;
exports.getFloorBalanceFor = getFloorBalanceFor;
exports.partyScaleFactor = partyScaleFactor;
exports.scaleEnemyStat = scaleEnemyStat;
exports.TOWER_OBJECTIVES = [
    'defeat-all', // clear every enemy
    'defeat-boss', // kill the boss; trash optional
    'defeat-all-then-boss', // clear trash, then the boss
    'protect-npc', // an allied NPC must survive
    'kill-escort', // clear all enemies AND keep the NPC alive
    'reach-tile', // reach the goal tile within the round budget
    'break-objective', // destroy a staged objective across phase gates
    'survive', // survive `roundBudget` rounds (boss unkillable)
    'kill-adds-first', // boss shielded until summoned adds die
];
// Objectives that REQUIRE a boss / npc / goal tile (cross-checked by the validator).
exports.OBJECTIVES_NEEDING_BOSS = new Set([
    'defeat-boss', 'defeat-all-then-boss', 'break-objective', 'kill-adds-first',
]);
exports.OBJECTIVES_NEEDING_NPC = new Set([
    'protect-npc', 'kill-escort',
]);
exports.OBJECTIVES_NEEDING_GOAL = new Set([
    'reach-tile',
]);
// Map biomes mirror the PvP session's valid biomes (api/pvp/session.ts).
exports.TOWER_BIOMES = ['forest', 'snow', 'volcano', 'shadow', 'central'];
// Hex geometry (mirrors _engine.towerNeighbors) for laying out feature ZONES in
// the static catalog without depending on the engine module. Used by hexZone to
// build a pylon's 7-hex "flower" (centre + the 6 touching tiles).
function catalogHexNeighbors(pos, w, h) {
    const x = pos % w, y = Math.floor(pos / w);
    const even = x % 2 === 0;
    const deltas = even
        ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
        : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return deltas
        .map(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx < 0 || nx >= w || ny < 0 || ny >= h ? -1 : ny * w + nx; })
        .filter(n => n >= 0);
}
/** A pylon "flower" zone: a centre tile + the (up to) 6 hexes touching it. */
function hexZone(center, w, h) {
    return [center, ...catalogHexNeighbors(center, w, h)];
}
// ─── v1 seed floors (a roomy ~20×14 board — about double the old 14×10, with the
// squad and enemies spread across spawn BANDS, not single edge columns) ──────
// A coherent 1–5 slice with a boss + milestone at floor 5; extends toward the
// 15-floor catalog sketched in plan §24. Tile index = y * width + x. Elemental
// pylons are 7-hex flowers (hexZone); wards/hazards are precise tiles. Features
// sit in the contested centre, clear of the squad/enemy/npc spawn bands.
exports.FLOOR_CATALOG = [
    {
        id: 1, name: 'Foothold', biome: 'forest', objective: 'defeat-all',
        roundBudget: 8, map: { width: 20, height: 14 }, fieldRule: { kind: 'none' },
        enemies: [{ aiId: 'grunt-bandit', count: 6 }],
        // Two elemental-pylon flowers introduce the mechanic. Their ELEMENTS are
        // assigned per-run from the tower's 3 random elements (see _encounter).
        features: [
            { kind: 'pylon', tiles: hexZone(86, 20, 14), element: 'Fire', weakenElement: 'Water', percent: 25, label: 'Pylon' },
            { kind: 'pylon', tiles: hexZone(94, 20, 14), element: 'Water', weakenElement: 'Earth', percent: 25, label: 'Pylon' },
        ],
        firstClearReward: { ryo: 400, xp: 150 },
    },
    {
        id: 2, name: 'Crossfire Glade', biome: 'forest', objective: 'defeat-all',
        roundBudget: 8, map: { width: 20, height: 14 }, fieldRule: { kind: 'buff', tag: 'Increase Damage Given', percent: 15 },
        enemies: [{ aiId: 'grunt-bandit', count: 4 }, { aiId: 'grunt-archer', count: 3, spawnRound: 2 }],
        // Three elemental-pylon flowers (one per tower element) + a cover-ward flower.
        features: [
            { kind: 'pylon', tiles: hexZone(86, 20, 14), element: 'Fire', weakenElement: 'Water', percent: 25, label: 'Pylon' },
            { kind: 'pylon', tiles: hexZone(90, 20, 14), element: 'Earth', weakenElement: 'Lightning', percent: 25, label: 'Pylon' },
            { kind: 'pylon', tiles: hexZone(94, 20, 14), element: 'Wind', weakenElement: 'Fire', percent: 25, label: 'Pylon' },
            { kind: 'ward', tiles: hexZone(150, 20, 14), percent: 20, label: 'Warded Stone' },
        ],
        firstClearReward: { ryo: 600, xp: 220, boneCharms: 5 },
    },
    {
        id: 3, name: 'The Frozen Run', biome: 'snow', objective: 'reach-tile',
        roundBudget: 7, map: { width: 20, height: 14 }, fieldRule: { kind: 'hazard', tag: 'Drain', percent: 5 },
        enemies: [{ aiId: 'grunt-blocker', count: 5 }, { aiId: 'grunt-archer', count: 3 }],
        // Two frost-spike hazard flowers blocking the dash + one pylon to fight over.
        features: [
            { kind: 'hazard', tiles: hexZone(86, 20, 14), percent: 12, label: 'Frost Spikes' },
            { kind: 'hazard', tiles: hexZone(94, 20, 14), percent: 12, label: 'Frost Spikes' },
            { kind: 'pylon', tiles: hexZone(150, 20, 14), element: 'Water', weakenElement: 'Earth', percent: 25, label: 'Pylon' },
        ],
        goalTile: 279, // bottom-right corner of a 20×14 board
        firstClearReward: { ryo: 800, xp: 300 },
    },
    {
        id: 4, name: 'Hold the Line', biome: 'central', objective: 'protect-npc',
        roundBudget: 8, map: { width: 20, height: 14 }, fieldRule: { kind: 'debuff', tag: 'Increase Damage Taken', percent: 10 },
        enemies: [{ aiId: 'grunt-bandit', count: 5 }, { aiId: 'grunt-brute', count: 2 }, { aiId: 'grunt-archer', count: 2, spawnRound: 2 }],
        npc: { aiId: 'npc-genin', pos: 123 },
        // Two pylon flowers + a cover-ward flower to keep the genin alive.
        features: [
            { kind: 'pylon', tiles: hexZone(86, 20, 14), element: 'Fire', weakenElement: 'Water', percent: 25, label: 'Pylon' },
            { kind: 'pylon', tiles: hexZone(94, 20, 14), element: 'Lightning', weakenElement: 'Wind', percent: 25, label: 'Pylon' },
            { kind: 'ward', tiles: hexZone(150, 20, 14), percent: 25, label: 'Bulwark' },
        ],
        firstClearReward: { ryo: 1000, xp: 380, fateShards: 5 },
    },
    {
        id: 5, name: 'Warden of the Spire', biome: 'volcano', objective: 'defeat-boss',
        roundBudget: 12, map: { width: 22, height: 16 }, fieldRule: { kind: 'buff', tag: 'Increase Damage Given', percent: 10 },
        // The boss plus a guard pack of adds; phase gates at 60% and 30% HP.
        enemies: [{ aiId: 'grunt-bandit', count: 4 }, { aiId: 'grunt-acolyte', count: 2, spawnRound: 2 }],
        boss: { aiId: 'boss-warden', phases: [60, 30] },
        // Three pylon flowers + a cover-ward flower to break line from the boss.
        features: [
            { kind: 'pylon', tiles: hexZone(117, 22, 16), element: 'Fire', weakenElement: 'Water', percent: 25, label: 'Pylon' },
            { kind: 'pylon', tiles: hexZone(121, 22, 16), element: 'Earth', weakenElement: 'Lightning', percent: 25, label: 'Pylon' },
            { kind: 'pylon', tiles: hexZone(125, 22, 16), element: 'Wind', weakenElement: 'Fire', percent: 25, label: 'Pylon' },
            { kind: 'ward', tiles: hexZone(209, 22, 16), percent: 25, label: 'Sheltered Rock' },
        ],
        firstClearReward: { ryo: 2000, xp: 800, fateShards: 10, milestone: 'tower-floor-5' },
    },
];
function getFloor(id) {
    return exports.FLOOR_CATALOG.find(f => f.id === id);
}
exports.TOWER_FLOOR_COUNT = exports.FLOOR_CATALOG.length;
// ─── Party size (2–4 scalable squad) ─────────────────────────────────────────
// The engine is N-actor, so party size is a RUN PARAMETER, not a fixed count — a
// duo, trio, or full squad all run the same floors. Floors are authored at
// MAX_PARTY_SIZE; smaller parties face enemies scaled by partyScaleFactor (the map,
// enemy positions, and objective are preserved — only enemy HP/damage scale, so the
// tactical puzzle stays intact). See docs/battle-towers-plan.md §28.
exports.MIN_PARTY_SIZE = 2;
exports.MAX_PARTY_SIZE = 4;
exports.DEFAULT_PARTY_SIZE = 4;
// A small party never faces enemies weaker than this fraction of the 4-balance — keeps
// a duo a real fight, not a pushover. Starting curve; tune in the balance pass.
exports.PARTY_SCALE_FLOOR = 0.6;
function clampPartySize(n) {
    return Math.max(exports.MIN_PARTY_SIZE, Math.min(exports.MAX_PARTY_SIZE, Math.floor(Number(n) || exports.DEFAULT_PARTY_SIZE)));
}
/** The party size a floor is balanced for (default MAX_PARTY_SIZE), clamped to [2,4]. */
function getFloorBalanceFor(floor) {
    return clampPartySize(floor.balanceFor ?? exports.DEFAULT_PARTY_SIZE);
}
/**
 * Enemy-strength multiplier for a party smaller than the floor's balance baseline.
 * Sub-linear: a smaller party has fewer actions, but co-op coordination means enemies
 * shouldn't drop to a strict head-count ratio. `partySize >= balanceFor` → 1.0 (floors
 * are authored at the max party and are never scaled UP). Tunable starting curve.
 */
function partyScaleFactor(partySize, balanceFor = exports.DEFAULT_PARTY_SIZE) {
    const p = clampPartySize(partySize);
    const base = clampPartySize(balanceFor);
    if (p >= base)
        return 1;
    return Math.max(exports.PARTY_SCALE_FLOOR, p / base);
}
/** Apply a party-scale factor to an enemy's scalar stat (HP / damage). Never scales up; floor of 1. */
function scaleEnemyStat(value, factor) {
    const f = Math.min(1, Math.max(0, factor));
    return Math.max(1, Math.round((Number(value) || 0) * f));
}
