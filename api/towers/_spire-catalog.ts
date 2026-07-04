/*
 * Battle Towers — Endless Spire floor catalog (Wave 1).
 *
 * A DEDICATED 20-floor ascension boss gauntlet, separate from the 10 story floors
 * (FLOOR_CATALOG). Floor N === ascension tier N. Clearing floor N unlocks N+1
 * (character.battleTowerAscension). The four bosses rotate across the ladder, with the
 * apex SOVEREIGN anchoring the milestone floors 5/10/15/20; every boss keeps its native
 * mechanic while the tier's sealed modifiers (dmgMult / roundCap / enrageCap) stack on top.
 *
 * getSpireFloor(tier) BUILDS a TowerFloor-shaped encounter on the fly (buildTowerEncounter
 * consumes it exactly like a story floor) — the bosses are the ENDGAME variants
 * (spire-* templates, def composite ≈ 7500) so a maxed squad's statFactor doesn't peg the
 * ceiling. Boss HP is authored PER-FLOOR here (a boss appears at many floors; an HP-scaled
 * mechanic × a single base × mult would wall/immortal — the clamped-DPS sim proved this).
 *
 * HP + round-budget numbers are TARGETS from the endgame re-stat pass; the final tune is a
 * re-sim against the built engine (per the design). Never reuses getFloor / FLOOR_CATALOG.
 */
import type { TowerFloor, TowerBiome, TowerBoss, TowerFeature } from './_floor-catalog.js';
import { hexZone } from './_floor-catalog.js';
import { SPIRE_MAX_TIER } from './_modifiers.js';

export type SpireBossKey = 'warden' | 'revenant' | 'ravager' | 'sovereign';

type SpireBossDef = {
    aiId: string;
    mechanic: NonNullable<TowerBoss['mechanic']>;
    phases: number[];
    roundBudget: number;
    map: { width: number; height: number };
    biome: TowerBiome;
    /** number of static guard-pod adds spawned in the base encounter (bulwark needs live guards) */
    guardPod: number;
    summonAiId?: string;
    summonCount?: number;
    regenFlatCap?: number;
    name: string;
};

// The four ENDGAME bosses (endgame stat blocks live in _enemy-templates spire-*). Per-boss
// caps + arena; the enrage stack cap is sealed globally by resolveAscensionModifiers.
const SPIRE_BOSSES: Record<SpireBossKey, SpireBossDef> = {
    warden: {
        aiId: 'spire-warden', mechanic: 'bulwark', phases: [60, 30], roundBudget: 16,
        map: { width: 22, height: 16 }, biome: 'volcano', guardPod: 3, name: 'Spire Warden',
    },
    revenant: {
        aiId: 'spire-revenant', mechanic: 'regen', phases: [66, 33], roundBudget: 18,
        map: { width: 22, height: 16 }, biome: 'shadow', guardPod: 0, regenFlatCap: 2800, name: 'Hollow Revenant',
    },
    ravager: {
        aiId: 'spire-ravager', mechanic: 'summon', phases: [66, 33], roundBudget: 18,
        map: { width: 22, height: 16 }, biome: 'volcano', guardPod: 2,
        summonAiId: 'spire-guard', summonCount: 3, name: 'Pit Ravager',
    },
    sovereign: {
        aiId: 'spire-sovereign', mechanic: 'enrage', phases: [75, 50, 25], roundBudget: 20,
        map: { width: 24, height: 16 }, biome: 'shadow', guardPod: 2, name: 'Spire Sovereign',
    },
};

// Boss per floor (index 0 = floor 1). Sovereign owns milestones 5/10/15/20; warden/revenant/
// ravager cycle the rest for variety. Each boss keeps its native mechanic; the tier escalates.
const BOSS_BY_FLOOR: SpireBossKey[] = [
    'warden', 'revenant', 'ravager', 'warden', 'sovereign',   // 1-5
    'revenant', 'ravager', 'warden', 'revenant', 'sovereign', // 6-10
    'warden', 'revenant', 'ravager', 'warden', 'sovereign',   // 11-15
    'warden', 'revenant', 'ravager', 'revenant', 'sovereign', // 16-20
];

// Per-floor authored boss HP (index 0 = floor 1). Targets from the endgame re-stat sim:
// tuned so a maxed 4-human squad (~5.2-6.0k DPS/round after boss def 7500 + armor) clears in
// ~5 rounds (F1, approachable) up to ~14 rounds (F20, brutal) — accounting for each mechanic
// (bulwark ~1.7× TTK tax → lower raw HP; regen flat-capped drag; summon add-clear tax). These
// are STARTING numbers pending the final against-the-engine re-sim.
const HP_BY_FLOOR: number[] = [
    17600, 13800, 25000, 21000, 36300,   // 1-5
    19300, 33300, 28000, 24800, 46600,   // 6-10
    35000, 27500, 45800, 38700, 62200,   // 11-15
    42200, 35800, 54100, 35800, 72500,   // 16-20
];

/** The four milestone floors (title/border unlocks; keys namespaced spire-tier-N in settle). */
export const SPIRE_MILESTONE_FLOORS: ReadonlySet<number> = new Set([5, 10, 15, 20]);

export function isValidSpireTier(tier: number): boolean {
    return Number.isInteger(tier) && tier >= 1 && tier <= SPIRE_MAX_TIER;
}

/** The boss key featured on a given floor (for validation + display). */
export function spireBossForFloor(floor: number): SpireBossKey | undefined {
    if (!isValidSpireTier(floor)) return undefined;
    return BOSS_BY_FLOOR[floor - 1];
}

// Placeholder feature flowers (the encounter builder re-scatters them each run by seed).
function centreZone(w: number, h: number): number[] {
    return hexZone(Math.floor(h / 2) * w + Math.floor(w / 2), w, h);
}
function spireFeatures(w: number, h: number): TowerFeature[] {
    return [
        { kind: 'pylon', tiles: centreZone(w, h), element: 'Fire', weakenElement: 'Water', percent: 25, label: 'Pylon' },
        { kind: 'pylon', tiles: centreZone(w, h), element: 'Fire', weakenElement: 'Water', percent: 25, label: 'Pylon' },
        { kind: 'ward', tiles: centreZone(w, h), percent: 25, label: 'Warded Stone' },
    ];
}

/**
 * Build the TowerFloor for spire tier N (1..20). Same shape a story floor uses, so
 * buildTowerEncounter consumes it unchanged. Boss HP is per-floor; the sealed ascension
 * modifiers (dmgMult / roundCap / enrageCap) are computed separately by resolveAscensionModifiers
 * and threaded through buildTowerEncounter — this only carries the encounter shape.
 */
export function getSpireFloor(tier: number): TowerFloor | undefined {
    if (!isValidSpireTier(tier)) return undefined;
    const key = BOSS_BY_FLOOR[tier - 1]!;
    const def = SPIRE_BOSSES[key];
    const hp = HP_BY_FLOOR[tier - 1]!;

    const boss: TowerBoss = {
        aiId: def.aiId,
        phases: def.phases,
        mechanic: def.mechanic,
        hp,
        ...(def.summonAiId ? { summonAiId: def.summonAiId, summonCount: def.summonCount } : {}),
        ...(def.regenFlatCap != null ? { regenFlatCap: def.regenFlatCap } : {}),
    };

    return {
        id: tier,
        name: `Spire — Floor ${tier} · ${def.name}`,
        biome: def.biome,
        objective: 'defeat-boss',
        roundBudget: def.roundBudget,
        map: { ...def.map },
        fieldRule: { kind: 'none' },
        // Guard pod (bulwark needs live guards; ravager also opens with a couple of adds).
        enemies: def.guardPod > 0 ? [{ aiId: 'spire-guard', count: def.guardPod }] : [],
        boss,
        features: spireFeatures(def.map.width, def.map.height),
        // Spire rewards are best-tier-per-week (settleSpireForMember), NOT one-time first-clear;
        // this stays empty so the story reward path is never triggered for a spire floor.
        firstClearReward: {},
    };
}

// ── Access model ──────────────────────────────────────────────────────────────
// The Endless Spire is group content. During testing solo entry is OPEN (a solo run simply
// walls early — expected). Flip the env flag to require a full squad (the humans-only future).
export function spireRequiresFullSquad(): boolean {
    return process.env.TOWER_REQUIRE_FULL_SQUAD === '1';
}

export { SPIRE_MAX_TIER };
