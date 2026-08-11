/*
 * Battle Towers — Endless Spire floor catalog.
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
 * HP + round-budget numbers are locked by deterministic real-engine release simulations
 * across every tier and weekly blessing. Never reuses getFloor / FLOOR_CATALOG.
 */
import type {
    TowerFloor, TowerBiome, TowerBoss, TowerFeature, TowerBoardObject, TowerDynamicHazard,
} from './_floor-catalog.js';
import { hexZone } from './_floor-catalog.js';
import { SPIRE_MAX_TIER } from './_modifiers.js';

/** Increment only when generated Spire floor rules change. Active runs seal this value. */
export const SPIRE_CATALOG_VERSION = 'endless-spire-v2' as const;

export type SpireBossKey =
    | 'warden' | 'revenant' | 'ravager' | 'sovereign'
    | 'stormcaller' | 'mirror-shogun' | 'void-emperor';

type SpireBossDef = {
    aiId: string;
    mechanic: NonNullable<TowerBoss['mechanic']>;
    phases: number[];
    roundBudget: number;
    map: { width: number; height: number };
    biome: TowerBiome;
    /** number of static guard-pod adds spawned in the base encounter (bulwark needs live guards) */
    guardPod: number;
    guardAiId?: string;
    summonAiId?: string;
    summonCount?: number;
    regenFlatCap?: number;
    phasePillars?: number;
    aegis?: NonNullable<TowerBoss['aegis']>;
    terrainPillars?: number;
    boardObjects?: TowerBoardObject[];
    dynamicHazards?: TowerDynamicHazard[];
    closingRing?: NonNullable<TowerFloor['closingRing']>;
    targetMode: NonNullable<TowerBoss['targetMode']>;
    strike: NonNullable<TowerBoss['strike']>;
    name: string;
};

// The four ENDGAME bosses (endgame stat blocks live in _enemy-templates spire-*). Per-boss
// caps + arena; the enrage stack cap is sealed globally by resolveAscensionModifiers.
const SPIRE_BOSSES: Record<SpireBossKey, SpireBossDef> = {
    warden: {
        aiId: 'spire-warden', mechanic: 'bulwark', phases: [60, 30], roundBudget: 16,
        map: { width: 22, height: 16 }, biome: 'volcano', guardPod: 3, name: 'Spire Warden',
        targetMode: 'squishiest',
        strike: { kind: 'slam', pct: 6, radius: 1, everyRounds: 4, firstRound: 4 },
    },
    revenant: {
        aiId: 'spire-revenant', mechanic: 'regen', phases: [66, 33], roundBudget: 18,
        map: { width: 22, height: 16 }, biome: 'shadow', guardPod: 0, regenFlatCap: 2800, name: 'Hollow Revenant',
        targetMode: 'support',
        strike: { kind: 'volley', pct: 6, radius: 1, everyRounds: 4, firstRound: 4 },
    },
    ravager: {
        aiId: 'spire-ravager', mechanic: 'summon', phases: [66, 33], roundBudget: 18,
        map: { width: 22, height: 16 }, biome: 'volcano', guardPod: 2,
        summonAiId: 'spire-guard', summonCount: 3, name: 'Pit Ravager',
        targetMode: 'lowest-hp',
        strike: { kind: 'nova', pct: 7, radius: 1, everyRounds: 4, firstRound: 4 },
    },
    sovereign: {
        aiId: 'spire-sovereign', mechanic: 'enrage', phases: [75, 50, 25], roundBudget: 20,
        map: { width: 24, height: 16 }, biome: 'shadow', guardPod: 2, name: 'Spire Sovereign',
        targetMode: 'lowest-hp',
        strike: { kind: 'nova', pct: 8, radius: 1, everyRounds: 3, firstRound: 3 },
    },
    // Tier 12 is a formation fight rather than another Revenant sustain check. The Matriarch
    // hunts support loadouts, blankets their tile with a wide volley, and calls low-HP storm
    // shades whose ranged AOE punishes a party that refuses to split. The contested Stormwell
    // gives an organised team a resource objective without adding another healing wall.
    stormcaller: {
        aiId: 'spire-stormcaller', mechanic: 'summon', phases: [72, 44], roundBudget: 18,
        map: { width: 22, height: 16 }, biome: 'snow', guardPod: 1,
        guardAiId: 'spire-tempest-shade', summonAiId: 'spire-tempest-shade', summonCount: 2,
        terrainPillars: 5,
        boardObjects: [{ kind: 'font', resource: 'chakra', percent: 12, cap: 180, label: 'Stormwell' }],
        dynamicHazards: [{ kind: 'geyser', count: 4, pct: 4, everyRounds: 3, firstRound: 3 }],
        name: 'Stormglass Matriarch', targetMode: 'support',
        strike: { kind: 'volley', pct: 6, radius: 2, everyRounds: 4, firstRound: 4 },
    },
    // Tier 16 is an add-break / arena-control duel. Reflections sustain the Shogun's bulwark;
    // each exposed phase then raises a bounded aegis and grows new glass pillars. The large slam
    // makes melee stacking readable but costly, while the shrine asks the party to hold ground.
    'mirror-shogun': {
        aiId: 'spire-mirror-shogun', mechanic: 'bulwark', phases: [70, 40], roundBudget: 16,
        map: { width: 22, height: 16 }, biome: 'central', guardPod: 2,
        guardAiId: 'spire-mirror-guard', phasePillars: 2, aegis: { shieldPct: 10 },
        terrainPillars: 4,
        boardObjects: [{ kind: 'shrine', percent: 8, label: 'Hall of Reflections' }],
        name: 'Mirror Shogun', targetMode: 'squishiest',
        strike: { kind: 'slam', pct: 7, radius: 2, everyRounds: 4, firstRound: 4 },
    },
    // Tier 20 is the authored apex rather than a fourth Sovereign repeat. It opens behind two
    // controller heralds, pressures sustain, reshapes the board at every gate, and forces a late
    // convergence through the existing closing-ring vocabulary. Enrage remains capped by the
    // sealed Spire contract; shields and ring chips are bounded, deterministic, and dodgeable.
    'void-emperor': {
        aiId: 'spire-void-emperor', mechanic: 'enrage', phases: [75, 50, 25], roundBudget: 20,
        map: { width: 24, height: 18 }, biome: 'shadow', guardPod: 2,
        guardAiId: 'spire-eclipse-herald', phasePillars: 2, aegis: { shieldPct: 8 },
        terrainPillars: 6, closingRing: { pct: 5, fromRound: 14, minRadius: 3 },
        name: 'Emperor of the Last Eclipse', targetMode: 'support',
        strike: { kind: 'nova', pct: 8, radius: 2, everyRounds: 3, firstRound: 3 },
    },
};

// Boss per floor (index 0 = floor 1). Sovereign owns milestones 5/10/15/20; warden/revenant/
// ravager cycle the rest for variety. Each boss keeps its native mechanic; the tier escalates.
const BOSS_BY_FLOOR: SpireBossKey[] = [
    'warden', 'revenant', 'ravager', 'warden', 'sovereign',   // 1-5
    'revenant', 'ravager', 'warden', 'revenant', 'sovereign', // 6-10
    'warden', 'stormcaller', 'ravager', 'warden', 'sovereign',       // 11-15
    'mirror-shogun', 'revenant', 'ravager', 'revenant', 'void-emperor', // 16-20
];

// Per-floor authored boss HP (index 0 = floor 1). Floors 8-20 are locked by the deterministic
// real-engine release sim in scripts/spire-balance.test.ts. HP stays the per-encounter tuning
// knob because each boss mechanic adds a very different TTK tax; global stat/damage changes
// would also perturb the already-shipped story tower.
const HP_BY_FLOOR: number[] = [
    17600, 13800, 25000, 21000, 36300,   // 1-5
    19300, 33300, 50000, 31000, 53010,   // 6-10
    50400, 31800, 42000, 51000, 48000,   // 11-15
    50000, 31200, 40000, 28000, 36000,   // 16-20
];

/** The four milestone floors (title/border unlocks; keys namespaced spire-tier-N in settle). */
export const SPIRE_MILESTONE_FLOORS: ReadonlySet<number> = new Set([5, 10, 15, 20]);

/** Server-owned visual contract mirrored by the Tower art manifest. */
export const SPIRE_BOSS_VISUALS: Readonly<Record<SpireBossKey, string>> = {
    warden: 'warden', revenant: 'revenant', ravager: 'ravager', sovereign: 'sovereign',
    stormcaller: 'stormcaller', 'mirror-shogun': 'mirror-shogun', 'void-emperor': 'void-emperor',
};

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
        targetMode: def.targetMode,
        strike: { ...def.strike },
        hp,
        ...(def.summonAiId ? { summonAiId: def.summonAiId, summonCount: def.summonCount } : {}),
        ...(def.regenFlatCap != null ? { regenFlatCap: def.regenFlatCap } : {}),
        ...(def.phasePillars != null ? { phasePillars: def.phasePillars } : {}),
        ...(def.aegis ? { aegis: { ...def.aegis } } : {}),
    };

    return {
        id: tier,
        name: `Spire — Floor ${tier} · ${def.name}`,
        biome: def.biome,
        objective: 'defeat-boss',
        roundBudget: def.roundBudget,
        map: { ...def.map },
        fieldRule: { kind: 'none' },
        // Guard pod (bulwark needs live guards; authored milestones may carry tactical adds).
        enemies: def.guardPod > 0 ? [{ aiId: def.guardAiId ?? 'spire-guard', count: def.guardPod }] : [],
        boss,
        features: spireFeatures(def.map.width, def.map.height),
        ...(def.terrainPillars != null ? { terrainPillars: def.terrainPillars } : {}),
        ...(def.boardObjects ? { boardObjects: structuredClone(def.boardObjects) } : {}),
        ...(def.dynamicHazards ? { dynamicHazards: structuredClone(def.dynamicHazards) } : {}),
        ...(def.closingRing ? { closingRing: { ...def.closingRing } } : {}),
        // Spire rewards are best-tier-per-week (settleSpireForMember), NOT one-time first-clear;
        // this stays empty so the story reward path is never triggered for a spire floor.
        firstClearReward: {},
    };
}

// ── Access model ──────────────────────────────────────────────────────────────
// Production ready rooms require exactly four human members. Legacy/local AI practice may
// exercise 1–4 actors unless this compatibility switch explicitly requires a full squad.
export function spireRequiresFullSquad(): boolean {
    return process.env.TOWER_REQUIRE_FULL_SQUAD === '1';
}

export { SPIRE_MAX_TIER };
