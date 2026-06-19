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

export const TOWER_OBJECTIVES = [
    'defeat-all',           // clear every enemy
    'defeat-boss',          // kill the boss; trash optional
    'defeat-all-then-boss', // clear trash, then the boss
    'protect-npc',          // an allied NPC must survive
    'kill-escort',          // clear all enemies AND keep the NPC alive
    'reach-tile',           // reach the goal tile within the round budget
    'break-objective',      // destroy a staged objective across phase gates
    'survive',              // survive `roundBudget` rounds (boss unkillable)
    'kill-adds-first',      // boss shielded until summoned adds die
] as const;
export type TowerObjective = (typeof TOWER_OBJECTIVES)[number];

// Objectives that REQUIRE a boss / npc / goal tile (cross-checked by the validator).
export const OBJECTIVES_NEEDING_BOSS: ReadonlySet<TowerObjective> = new Set([
    'defeat-boss', 'defeat-all-then-boss', 'break-objective', 'kill-adds-first',
]);
export const OBJECTIVES_NEEDING_NPC: ReadonlySet<TowerObjective> = new Set([
    'protect-npc', 'kill-escort',
]);
export const OBJECTIVES_NEEDING_GOAL: ReadonlySet<TowerObjective> = new Set([
    'reach-tile',
]);

// Map biomes mirror the PvP session's valid biomes (api/pvp/session.ts).
export const TOWER_BIOMES = ['forest', 'snow', 'volcano', 'shadow', 'central'] as const;
export type TowerBiome = (typeof TOWER_BIOMES)[number];

// A per-floor passive "field rule" (Ley-Line-Disorder style, plan §19): one of
// hazard / debuff / buff, applied each round. `none` for warm-up floors.
export type TowerFieldRule =
    | { kind: 'none' }
    | { kind: 'hazard'; tag: string; percent?: number }
    | { kind: 'debuff'; tag: string; percent?: number }
    | { kind: 'buff'; tag: string; percent?: number };

export type TowerEnemyPod = {
    aiId: string;
    count: number;
    /** spawn at the start of this round (waves/reinforcements); default round 1 */
    spawnRound?: number;
};

export type TowerBoss = {
    aiId: string;
    /** HP-threshold phase gates as percentages, descending (e.g. [66, 33]) */
    phases?: number[];
};

export type TowerNpc = {
    aiId: string;
    /** tile index on the map; resolved/placed by the engine if omitted */
    pos?: number;
};

export type TowerReward = {
    ryo?: number;
    xp?: number;
    fateShards?: number;
    boneCharms?: number;
    itemId?: string;
    /** one-time milestone unlock key (title / cosmetic / signature), credited once */
    milestone?: string;
};

export type TowerFloor = {
    /** 1-based floor number, unique + contiguous within the catalog */
    id: number;
    name: string;
    biome: TowerBiome;
    objective: TowerObjective;
    /** round budget — a star-tier threshold for most objectives; the survive-count for `survive` */
    roundBudget: number;
    map: { width: number; height: number };
    fieldRule: TowerFieldRule;
    enemies: TowerEnemyPod[];
    boss?: TowerBoss;
    npc?: TowerNpc;
    /** goal tile index for `reach-tile` objectives */
    goalTile?: number;
    /** party size the enemy counts / boss HP are tuned for (2–4); default 4. Smaller
     *  parties face enemies scaled by partyScaleFactor(partySize, balanceFor). */
    balanceFor?: number;
    firstClearReward: TowerReward;
};

// ─── v1 seed floors (Decision 1 = A: a ~20×16 board) ─────────────────────────
// A coherent 1–5 slice with a boss + milestone at floor 5; extends toward the
// 15-floor catalog sketched in plan §24.
export const FLOOR_CATALOG: readonly TowerFloor[] = [
    {
        id: 1, name: 'Foothold', biome: 'forest', objective: 'defeat-all',
        roundBudget: 8, map: { width: 20, height: 16 }, fieldRule: { kind: 'none' },
        enemies: [{ aiId: 'grunt-bandit', count: 3 }],
        firstClearReward: { ryo: 400, xp: 150 },
    },
    {
        id: 2, name: 'Crossfire Glade', biome: 'forest', objective: 'defeat-all',
        roundBudget: 8, map: { width: 20, height: 16 }, fieldRule: { kind: 'buff', tag: 'Increase Damage Given', percent: 15 },
        enemies: [{ aiId: 'grunt-bandit', count: 2 }, { aiId: 'grunt-archer', count: 2, spawnRound: 2 }],
        firstClearReward: { ryo: 600, xp: 220, boneCharms: 5 },
    },
    {
        id: 3, name: 'The Frozen Run', biome: 'snow', objective: 'reach-tile',
        roundBudget: 6, map: { width: 20, height: 16 }, fieldRule: { kind: 'hazard', tag: 'Drain', percent: 5 },
        enemies: [{ aiId: 'grunt-blocker', count: 4 }],
        goalTile: 319, // bottom-right corner of a 20×16 board
        firstClearReward: { ryo: 800, xp: 300 },
    },
    {
        id: 4, name: 'Hold the Line', biome: 'central', objective: 'protect-npc',
        roundBudget: 8, map: { width: 20, height: 16 }, fieldRule: { kind: 'debuff', tag: 'Increase Damage Taken', percent: 10 },
        enemies: [{ aiId: 'grunt-bandit', count: 3 }, { aiId: 'grunt-archer', count: 2, spawnRound: 2 }],
        npc: { aiId: 'npc-genin', pos: 168 },
        firstClearReward: { ryo: 1000, xp: 380, fateShards: 5 },
    },
    {
        id: 5, name: 'Warden of the Spire', biome: 'volcano', objective: 'defeat-boss',
        roundBudget: 10, map: { width: 20, height: 16 }, fieldRule: { kind: 'buff', tag: 'Increase Damage Given', percent: 10 },
        enemies: [{ aiId: 'grunt-bandit', count: 2 }],
        boss: { aiId: 'boss-warden', phases: [50] },
        firstClearReward: { ryo: 2000, xp: 800, fateShards: 10, milestone: 'tower-floor-5' },
    },
] as const;

export function getFloor(id: number): TowerFloor | undefined {
    return FLOOR_CATALOG.find(f => f.id === id);
}

export const TOWER_FLOOR_COUNT = FLOOR_CATALOG.length;

// ─── Party size (2–4 scalable squad) ─────────────────────────────────────────
// The engine is N-actor, so party size is a RUN PARAMETER, not a fixed count — a
// duo, trio, or full squad all run the same floors. Floors are authored at
// MAX_PARTY_SIZE; smaller parties face enemies scaled by partyScaleFactor (the map,
// enemy positions, and objective are preserved — only enemy HP/damage scale, so the
// tactical puzzle stays intact). See docs/battle-towers-plan.md §28.
export const MIN_PARTY_SIZE = 2;
export const MAX_PARTY_SIZE = 4;
export const DEFAULT_PARTY_SIZE = 4;
// A small party never faces enemies weaker than this fraction of the 4-balance — keeps
// a duo a real fight, not a pushover. Starting curve; tune in the balance pass.
export const PARTY_SCALE_FLOOR = 0.6;

function clampPartySize(n: number): number {
    return Math.max(MIN_PARTY_SIZE, Math.min(MAX_PARTY_SIZE, Math.floor(Number(n) || DEFAULT_PARTY_SIZE)));
}

/** The party size a floor is balanced for (default MAX_PARTY_SIZE), clamped to [2,4]. */
export function getFloorBalanceFor(floor: TowerFloor): number {
    return clampPartySize(floor.balanceFor ?? DEFAULT_PARTY_SIZE);
}

/**
 * Enemy-strength multiplier for a party smaller than the floor's balance baseline.
 * Sub-linear: a smaller party has fewer actions, but co-op coordination means enemies
 * shouldn't drop to a strict head-count ratio. `partySize >= balanceFor` → 1.0 (floors
 * are authored at the max party and are never scaled UP). Tunable starting curve.
 */
export function partyScaleFactor(partySize: number, balanceFor: number = DEFAULT_PARTY_SIZE): number {
    const p = clampPartySize(partySize);
    const base = clampPartySize(balanceFor);
    if (p >= base) return 1;
    return Math.max(PARTY_SCALE_FLOOR, p / base);
}

/** Apply a party-scale factor to an enemy's scalar stat (HP / damage). Never scales up; floor of 1. */
export function scaleEnemyStat(value: number, factor: number): number {
    const f = Math.min(1, Math.max(0, factor));
    return Math.max(1, Math.round((Number(value) || 0) * f));
}
