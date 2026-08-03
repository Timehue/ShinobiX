/*
 * Server-side port of the AI opponent level curves — step 3a of the AI-fight
 * migration (docs/runbooks/combat-mode-migration.md).
 *
 * WHY THIS EXISTS
 * Step 2 can seal a built-in AI at its AUTHORED level, but almost no live fight
 * uses the authored level. The client RE-LEVELS its opponent per entry point
 * (`relevelBuiltinAi`): a combat mission aligns the foe to the player, a rift
 * boss rebases to player+15, hunts scale by sector. That rule ran only on the
 * client, so a server fight built from the authored profile would be a
 * different — usually much weaker — opponent than the one the player was shown.
 * Routing the client onto that would be a half-migration, so the curves move
 * first.
 *
 * These are FORMULAS, not data, so this is a hand port rather than a generated
 * mirror (contrast api/_ai-profile-catalog.ts). Drift is caught by
 * `scripts/ai-level-curve-parity.test.ts`, which runs the client functions and
 * these side by side over a full level/bonus/loadout sweep and asserts equality.
 *
 * Source of truth, mirrored function-for-function:
 *   shinobij.client/src/lib/ai-stats.ts   — the curves
 *   shinobij.client/src/lib/stats.ts      — capStat / addToAllStats / normalizeStats
 *   shinobij.client/src/lib/combat-ai.ts  — makeBuiltinAi / normalizeAiProfile / relevelBuiltinAi
 *
 * Shared constants and the player-side curves (MAX_LEVEL, MAX_STAT,
 * STARTING_STAT_POINTS, STAT_KEYS, maxHpForLevel, maxChakra/StaminaForLevel)
 * already have a server mirror in api/_xp-engine.ts and are reused from there —
 * a second copy would be a second thing to drift.
 */
import {
    MAX_LEVEL,
    MAX_STAT,
    STARTING_STAT_POINTS,
    STAT_KEYS,
    maxHpForLevel,
    maxChakraForLevel,
    maxStaminaForLevel,
    type Stats,
} from './_xp-engine.js';

type StatKey = typeof STAT_KEYS[number];

/** Mirrors lib/stats.ts capStat. */
export function capStat(value: number): number {
    return Math.min(MAX_STAT, Math.max(0, Math.floor(Number(value) || 0)));
}

/** Mirrors lib/stats.ts addToAllStats. */
export function addToAllStats(stats: Stats, amount: number): Stats {
    return STAT_KEYS.reduce((out, key) => {
        out[key] = capStat(stats[key] + amount);
        return out;
    }, {} as Stats);
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** A jutsu as far as these curves care: only its discipline matters. */
export type CurveJutsu = { type?: string };

/** Mirrors ai-stats.ts aiPrimaryJutsuType — the most-represented discipline,
 *  ignoring 'Any'. Ties fall to the earlier key, matching Object.entries order
 *  on the literal the client builds ({ Any, Ninjutsu, Taijutsu, Genjutsu, Bukijutsu }). */
export function aiPrimaryJutsuType(jutsus: CurveJutsu[] = []): string | undefined {
    const order = ['Any', 'Ninjutsu', 'Taijutsu', 'Genjutsu', 'Bukijutsu'];
    const counts: Record<string, number> = { Any: 0, Ninjutsu: 0, Taijutsu: 0, Genjutsu: 0, Bukijutsu: 0 };
    for (const jutsu of jutsus) {
        const type = String(jutsu?.type ?? '');
        // The client indexes counts[jutsu.type] directly, so an unrecognized
        // type becomes its own key AFTER the five literal keys — reproduce that
        // insertion order rather than dropping it.
        if (!(type in counts)) { counts[type] = 0; order.push(type); }
        counts[type] = (counts[type] ?? 0) + 1;
    }
    const sorted = order
        .filter((type) => type !== 'Any')
        .map((type) => [type, counts[type]] as const)
        .sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[1] ? sorted[0][0] : undefined;
}

// Per-stat ceiling above the base-10 floor. 12 × this == the full L100 budget.
const STAT_CAP_OVER_BASE = MAX_STAT - 10;

/** Mirrors ai-stats.ts aiArchetypeWeights. */
function aiArchetypeWeights(primary?: string): Record<StatKey, number> {
    const w: Record<StatKey, number> = {
        strength: 1.1, speed: 1.1, intelligence: 1.1, willpower: 1.1,
        bukijutsuOffense: 1.0, taijutsuOffense: 1.0, genjutsuOffense: 1.0, ninjutsuOffense: 1.0,
        bukijutsuDefense: 1.25, taijutsuDefense: 1.25, genjutsuDefense: 1.25, ninjutsuDefense: 1.25,
    };
    if (primary && primary !== 'Any') {
        const stem = `${primary[0]!.toLowerCase()}${primary.slice(1)}`;
        const offense = `${stem}Offense` as StatKey;
        const defense = `${stem}Defense` as StatKey;
        if (offense in w) w[offense] = 2.2;
        if (defense in w) w[defense] = 1.5;
        if (primary === 'Ninjutsu' || primary === 'Genjutsu') { w.intelligence = 1.7; w.willpower = 1.7; }
        else { w.strength = 1.7; w.speed = 1.7; }
    }
    return w;
}

/**
 * Mirrors ai-stats.ts distributeStatBudget.
 *
 * ORDER-SENSITIVE: the rounding-stall branch hands out the last few points by
 * walking STAT_KEYS in order, so this reproduces the client's key order exactly
 * (api/_xp-engine.ts STAT_KEYS is asserted identical to the client's list).
 * Reordering either list silently changes AI stat blocks.
 */
function distributeStatBudget(budget: number, weights: Record<StatKey, number>): Stats {
    const over: Record<string, number> = {};
    for (const k of STAT_KEYS) over[k] = 0;
    let remaining = Math.max(0, Math.floor(budget));
    let active: StatKey[] = STAT_KEYS.filter((k) => weights[k] > 0);
    for (let iter = 0; iter < 24 && remaining > 0 && active.length > 0; iter++) {
        const wsum = active.reduce((s, k) => s + weights[k], 0);
        let handed = 0;
        for (const k of active) {
            const give = Math.min(STAT_CAP_OVER_BASE - over[k]!, Math.floor((remaining * weights[k]) / wsum));
            if (give > 0) { over[k] = over[k]! + give; handed += give; }
        }
        remaining -= handed;
        if (handed === 0) {
            for (const k of active) { if (remaining <= 0) break; if (over[k]! < STAT_CAP_OVER_BASE) { over[k] = over[k]! + 1; remaining--; } }
        }
        active = active.filter((k) => over[k]! < STAT_CAP_OVER_BASE);
    }
    return STAT_KEYS.reduce((s, k) => { s[k] = capStat(10 + over[k]!); return s; }, {} as Stats);
}

/** Mirrors ai-stats.ts aiStatBudgetForLevel (the FROZEN AI curve — see the note
 *  there: it is deliberately NOT the player's post-XP-removal curve). */
export function aiStatBudgetForLevel(level: number): number {
    const clampedLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
    const fullBudget = 12 * STAT_CAP_OVER_BASE;
    return STARTING_STAT_POINTS + Math.round(((clampedLevel - 1) / (MAX_LEVEL - 1)) * (fullBudget - STARTING_STAT_POINTS));
}

/** Mirrors ai-stats.ts aiStatsForLevel. */
export function aiStatsForLevel(level: number, jutsus: CurveJutsu[] = []): Stats {
    const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level || 1)));
    return distributeStatBudget(aiStatBudgetForLevel(safeLevel), aiArchetypeWeights(aiPrimaryJutsuType(jutsus)));
}

/** Mirrors ai-stats.ts aiHpForLevel. */
export function aiHpForLevel(level: number, toughness = 0): number {
    const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level || 1)));
    const levelScale = safeLevel / MAX_LEVEL;
    return Math.floor(maxHpForLevel(safeLevel) * (1.12 + levelScale * 0.35 + toughness * 1.5));
}

/** Mirrors ai-stats.ts aiRawDamageReductionForLevel. */
export function aiRawDamageReductionForLevel(level: number, toughness = 0): number {
    const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level || 1)));
    return clampNumber(0.06 + safeLevel * 0.005 + toughness * 0.28, 0.08, 0.62);
}

/** Mirrors ai-stats.ts aiArmorFactorFromRaw. */
export function aiArmorFactorFromRaw(rawDR: number): number {
    return clampNumber(1 - rawDR, 0.45, 0.97);
}

/**
 * Mirrors combat-ai.ts makeBuiltinAi's per-id toughness rule. Hunt beasts are
 * armored (the Worldstorm Dragon is the documented exception, dropped to 0.18
 * so its lowered HP override actually lands); everything else is 0.
 */
export function aiToughnessForId(id: string, level: number): number {
    if (id === 'hunt-ai-worldstorm-dragon') return 0.18;
    if (id.startsWith('hunt-ai-')) return level >= 70 ? 0.35 : 0.18;
    return 0;
}

/** The subset of a profile these curves read and rewrite. */
export type RelevelableProfile = {
    id: string;
    level: number;
    hp: number;
    chakra: number;
    stamina: number;
    stats: Stats;
    armorRawDR: number;
    jutsuIds: string[];
    hpFloorExempt?: boolean;
    [key: string]: unknown;
};

/**
 * Rebuild a profile at a new level / stat bonus — the server mirror of
 * combat-ai.ts `relevelBuiltinAi`, which is itself `makeBuiltinAi` followed by
 * `normalizeAiProfile`. Identity fields (id, name, jutsuIds, flags) are
 * preserved; level, stats, HP, pools and armor are recomputed.
 *
 * `loadoutJutsu` is the profile's resolved jutsu (its discipline mix picks the
 * archetype weights); pass what api/_ai-opponent-loadout.ts resolved.
 *
 * TWO FAITHFUL QUIRKS, deliberately reproduced — the client's real behavior is
 * the contract here, not what the curves "should" do:
 *
 *  1. `hpFloorExempt` is DROPPED. `relevelBuiltinAi` calls `makeBuiltinAi`
 *     without the 10th argument, so a re-leveled apex/story boss loses its
 *     exemption and its HP is floored back onto the level curve. This is the
 *     documented hazard in lib/apex-contract.ts (lines 18-24). Diverging here
 *     would make the server fight easier than the client's.
 *  2. HP is floored at `aiHpForLevel(level, toughness)`, so an `hpOverride`
 *     below the natural curve is a no-op — the floor only binds at low levels.
 */
export function relevelAiProfile(
    base: RelevelableProfile,
    targetLevel: number,
    statBonus: number,
    hpOverride = 0,
    loadoutJutsu: CurveJutsu[] = [],
): RelevelableProfile {
    const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(targetLevel || 1)));
    const bonus = Math.max(0, Math.floor(statBonus || 0));
    const toughness = aiToughnessForId(base.id, level);
    const armorRawDR = aiRawDamageReductionForLevel(level, toughness);
    // makeBuiltinAi: max(hpOverride, aiHpForLevel(level, toughness)); then
    // normalizeAiProfile floors again at aiHpForLevel(level, 0), which is never
    // the larger of the two. Composed, the toughness floor wins.
    const hp = Math.max(Math.max(0, Math.floor(hpOverride || 0)), aiHpForLevel(level, toughness));
    // makeBuiltinAi hands normalizeAiProfile `recommended + bonus`, and
    // normalize then takes max(recommended, that) per stat — with a
    // non-negative bonus the sum always wins, so this is the composed result.
    const stats = addToAllStats(aiStatsForLevel(level, loadoutJutsu), bonus);
    return {
        ...base,
        level,
        hp,
        chakra: Math.max(maxChakraForLevel(level), 0),
        stamina: Math.max(maxStaminaForLevel(level), 0),
        stats,
        armorRawDR: Math.max(aiRawDamageReductionForLevel(level), armorRawDR),
        // See quirk 1: the re-level path does not carry the exemption through.
        hpFloorExempt: undefined,
    };
}
