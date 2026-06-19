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
// ─── v1 seed floors (a tighter ~14×10 board — bigger than PvP's 12×10, dense
// enough to read as a real skirmish instead of a sea of empty tiles) ─────────
// A coherent 1–5 slice with a boss + milestone at floor 5; extends toward the
// 15-floor catalog sketched in plan §24. Tile index = y * width + x. Features sit
// in the contested centre (cols 3–9), clear of the squad/enemy/npc spawn columns.
exports.FLOOR_CATALOG = [
    {
        id: 1, name: 'Foothold', biome: 'forest', objective: 'defeat-all',
        roundBudget: 8, map: { width: 14, height: 10 }, fieldRule: { kind: 'none' },
        enemies: [{ aiId: 'grunt-bandit', count: 5 }],
        firstClearReward: { ryo: 400, xp: 150 },
    },
    {
        id: 2, name: 'Crossfire Glade', biome: 'forest', objective: 'defeat-all',
        roundBudget: 8, map: { width: 14, height: 10 }, fieldRule: { kind: 'buff', tag: 'Increase Damage Given', percent: 15 },
        enemies: [{ aiId: 'grunt-bandit', count: 3 }, { aiId: 'grunt-archer', count: 3, spawnRound: 2 }],
        // Two opposing elemental pylons + a cover ward in the middle: stand your
        // fire user on the Flame Pylon (61), your water user on the Tide Pylon (78).
        features: [
            { kind: 'pylon', tiles: [61], element: 'Fire', weakenElement: 'Water', percent: 25, label: 'Flame Pylon' },
            { kind: 'pylon', tiles: [78], element: 'Water', weakenElement: 'Fire', percent: 25, label: 'Tide Pylon' },
            { kind: 'ward', tiles: [90], percent: 20, label: 'Warded Stone' },
        ],
        firstClearReward: { ryo: 600, xp: 220, boneCharms: 5 },
    },
    {
        id: 3, name: 'The Frozen Run', biome: 'snow', objective: 'reach-tile',
        roundBudget: 6, map: { width: 14, height: 10 }, fieldRule: { kind: 'hazard', tag: 'Drain', percent: 5 },
        enemies: [{ aiId: 'grunt-blocker', count: 4 }, { aiId: 'grunt-archer', count: 2 }],
        // Frost-spike tiles strewn across the dash to the goal — don't end the round on one.
        features: [
            { kind: 'hazard', tiles: [48, 78, 105], percent: 12, label: 'Frost Spikes' },
        ],
        goalTile: 139, // bottom-right corner of a 14×10 board
        firstClearReward: { ryo: 800, xp: 300 },
    },
    {
        id: 4, name: 'Hold the Line', biome: 'central', objective: 'protect-npc',
        roundBudget: 8, map: { width: 14, height: 10 }, fieldRule: { kind: 'debuff', tag: 'Increase Damage Taken', percent: 10 },
        enemies: [{ aiId: 'grunt-bandit', count: 4 }, { aiId: 'grunt-brute', count: 2 }, { aiId: 'grunt-archer', count: 2, spawnRound: 2 }],
        npc: { aiId: 'npc-genin', pos: 73 },
        // A cover ward beside the genin to help keep them alive.
        features: [
            { kind: 'ward', tiles: [74], percent: 25, label: 'Bulwark' },
        ],
        firstClearReward: { ryo: 1000, xp: 380, fateShards: 5 },
    },
    {
        id: 5, name: 'Warden of the Spire', biome: 'volcano', objective: 'defeat-boss',
        roundBudget: 12, map: { width: 16, height: 11 }, fieldRule: { kind: 'buff', tag: 'Increase Damage Given', percent: 10 },
        // The boss plus a guard pack of adds; phase gates at 60% and 30% HP.
        enemies: [{ aiId: 'grunt-bandit', count: 3 }, { aiId: 'grunt-acolyte', count: 2, spawnRound: 2 }],
        boss: { aiId: 'boss-warden', phases: [60, 30] },
        // Cover ward to break line from the boss; a Flame Pylon for fire builds.
        features: [
            { kind: 'ward', tiles: [85], percent: 25, label: 'Sheltered Rock' },
            { kind: 'pylon', tiles: [88], element: 'Fire', weakenElement: 'Water', percent: 25, label: 'Magma Vent' },
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
