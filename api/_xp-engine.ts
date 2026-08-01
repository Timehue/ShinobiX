// Pure, IO-free server port of the client's character XP / level engine, for
// the server-authoritative PvP-win reward (audit #7 / Stage 3 Phase 3). Split
// out so the (large) level math is unit-testable without storage — same pattern
// as api/_ranked-rating.ts (Phase 1) and api/_territory-supply.ts.
//
// This is a VERBATIM port. Keep every function in lockstep with its client
// source; the colocated _xp-engine.test.ts pins server == client output and a
// drift on either side must change both. Sources:
//   • shinobij.client/src/constants/game.ts   — the numeric constants
//   • shinobij.client/src/lib/stats.ts         — xpNeeded, maxHp/Chakra/Stamina
//       ForLevel, reconcileCharacterStatBudget + its stat-budget helpers
//   • shinobij.client/src/lib/progression.ts   — effectiveCharacterXpGain
//   • shinobij.client/src/lib/character-progress.ts — rankTitleForLevel
//   • shinobij.client/src/App.tsx              — examLevelCap, gainXp
//
// The server runs this on the WINNER's full save (read under the claim lock),
// which still carries elderFocus / examsPassed / pets / activePetId (those are
// stripped from the PvP *session* char but not from the save), so the payout is
// computed identically to the client.

// ── constants/game.ts ───────────────────────────────────────────────────────
export const MAX_LEVEL = 100;
export const MAX_STAT = 2500;
export const STARTING_STAT_POINTS = 20;
// Real (non-testing) XP rate. Parity-pinned with shinobij.client constants/game.ts.
export const CHARACTER_XP_GAIN_MULTIPLIER = 1;
export const HP_CAP = 10000;
export const CHAKRA_CAP = 5000;
export const STAMINA_CAP = 5000;
// combatResourcesV2 — the chakra/stamina combat-resource redesign switch. MUST match
// shinobij.client/src/constants/game.ts COMBAT_RESOURCES_V2 + the v2 pool constants
// (parity-pinned by _xp-engine.test.ts) or PvE and PvP diverge. Flip BOTH + rebuild.
// See docs/chakra-stamina-redesign-plan.md.
export const COMBAT_RESOURCES_V2 = true;
export const CHAKRA_BASE_V2 = 1000;
export const CHAKRA_CAP_V2 = 10000;
export const STAMINA_BASE_V2 = 1000;
export const STAMINA_CAP_V2 = 10000;

// ── lib/stats.ts — stat helpers ─────────────────────────────────────────────
export const STAT_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense',
    'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense',
    'ninjutsuOffense', 'ninjutsuDefense',
] as const;
type StatKey = typeof STAT_KEYS[number];
export type Stats = Record<StatKey, number>;

function capStat(value: number): number {
    return Math.min(MAX_STAT, Math.max(0, Math.floor(value)));
}

function baseStats(): Stats {
    return {
        strength: 10, speed: 10, intelligence: 10, willpower: 10,
        bukijutsuOffense: 10, bukijutsuDefense: 10,
        taijutsuOffense: 10, taijutsuDefense: 10,
        genjutsuOffense: 10, genjutsuDefense: 10,
        ninjutsuOffense: 10, ninjutsuDefense: 10,
    };
}

function normalizeStats(stats?: Partial<Record<string, unknown>>): Stats {
    const base = baseStats();
    return STAT_KEYS.reduce((normalized, key) => {
        const raw = stats?.[key];
        normalized[key] = capStat(raw == null ? base[key] : Number(raw));
        return normalized;
    }, { ...base });
}

export function allocatedStatPoints(stats: Stats): number {
    const base = baseStats();
    return STAT_KEYS.reduce((total, key) => total + Math.max(0, capStat(stats[key]) - base[key]), 0);
}

/**
 * How many stat points this character has actually put into their build —
 * the authoritative measure behind the "stats trained" progression gates.
 *
 * `totalStatsTrained` is a server-owned COUNTER, but only idle training
 * increments it (api/training/_grant.ts). Points that arrive by allocating the
 * unspent pool or by PvP stat growth raise `stats` without touching it, and the
 * save sanitizer discards the client's attempt to bump it — so the raw counter
 * undercounts every build that grew that way. Taking the max against the stats
 * actually allocated closes that gap using only server-owned data (`stats` is
 * entitlement-conserved, so it cannot be forged).
 *
 * Mirrors the client's Logbook measure (shinobij.client/src/lib/logbook-objectives.ts
 * `statsTrained`) so the requirement a player SEES is the requirement the
 * server enforces — the two used to disagree, letting the Logbook read 400/400
 * while the Genin exam refused.
 */
export function effectiveStatsTrained(character: XpCharacter): number {
    const counter = Math.max(0, Math.floor(Number(character.totalStatsTrained) || 0));
    const stats = normalizeStats(character.stats as Partial<Record<string, unknown>> | undefined);
    return Math.max(counter, allocatedStatPoints(stats));
}

// ── lib/stats.ts — level curve ──────────────────────────────────────────────
// (Character XP is RETIRED — docs/leveling-without-xp-map.md. xpNeeded, the
// cumulative-XP helpers and the level→stat-BUDGET functions are deleted on both
// sides: level is now a function of earned stat points, see the fitted curve
// further down. The stored `xp` field survives only as frozen rollback ballast
// that the save sanitizer re-asserts and nothing reads.)

export function maxHpForLevel(level: number): number {
    // Base HP at level 1 is 500 (starter HP); +100 per level thereafter, up to
    // HP_CAP. Shifting only the base keeps the curve balance-neutral — players and
    // same-level AI (aiHpForLevel multiplies this) both gain the +400 base.
    // Keep this in lock-step with shinobij.client/src/lib/stats.ts (parity test).
    return Math.min(HP_CAP, 500 + (Math.max(1, level) - 1) * 100);
}

// v2 (combatResourcesV2) pool: bigger, level-scaling — base@L1 → cap@L100. Legacy
// curve is 100→5,000; v2 is ~1,000→~10,000. Mirrors shinobij.client/src/lib/stats.ts.
function v2PoolForLevel(level: number, base: number, cap: number): number {
    return Math.min(cap, Math.floor(base + (Math.max(1, level) - 1) * ((cap - base) / (MAX_LEVEL - 1))));
}

export function maxChakraForLevel(level: number): number {
    if (COMBAT_RESOURCES_V2) return v2PoolForLevel(level, CHAKRA_BASE_V2, CHAKRA_CAP_V2);
    return Math.min(CHAKRA_CAP, Math.floor(100 + (Math.max(1, level) - 1) * ((CHAKRA_CAP - 100) / (MAX_LEVEL - 1))));
}

export function maxStaminaForLevel(level: number): number {
    if (COMBAT_RESOURCES_V2) return v2PoolForLevel(level, STAMINA_BASE_V2, STAMINA_CAP_V2);
    return Math.min(STAMINA_CAP, Math.floor(100 + (Math.max(1, level) - 1) * ((STAMINA_CAP - 100) / (MAX_LEVEL - 1))));
}

export function rankFromLevel(level: number): string {
    if (level >= 80) return 'Special Jonin';
    if (level >= 50) return 'Jonin';
    if (level >= 30) return 'Chunin';
    if (level >= 15) return 'Genin';
    return 'Academy Student';
}

// Loose character shape — the server operates on the raw KV save object.
export type XpCharacter = Record<string, unknown>;

// Two-axis progression: unspentStats is a STORED pool — stat points come from
// training (direct-to-stat), the daily checklist + one-time content grants, and
// combat, NOT a level budget. Mirrors shinobij.client/src/lib/stats.ts.
// Reconcile only normalizes stats + clamps the pool ≥ 0; it never rolls back
// spent stats and never grants points on level-up.
export function reconcileCharacterStatBudget(character: XpCharacter): XpCharacter {
    const stats = normalizeStats(character.stats as Record<string, unknown> | undefined);
    const unspentStats = Math.max(0, Math.floor(Number(character.unspentStats) || 0));
    return { ...character, stats, unspentStats };
}

// ── lib/progression.ts ──────────────────────────────────────────────────────
export function effectiveCharacterXpGain(character: { elderFocus?: unknown }, amount: number): number {
    const baseAmount = Math.max(0, Math.floor(amount));
    const testingBoostedAmount = Math.floor(baseAmount * CHARACTER_XP_GAIN_MULTIPLIER);
    const trainingFocusBonus = character.elderFocus === 'training'
        ? Math.floor(testingBoostedAmount * 0.1)
        : 0;
    return testingBoostedAmount + trainingFocusBonus;
}

// ── lib/character-progress.ts ───────────────────────────────────────────────
const levelOnlyRankTitles = new Set([
    'Academy Student', 'Genin', 'Chunin', 'Jonin', 'Elite Jonin',
    'Special Jonin', 'Kage', 'Legendary Kage',
]);

function roleRankTitle(character: XpCharacter): string {
    const currentTitle = typeof character.rankTitle === 'string' ? character.rankTitle.trim() : '';
    const lowerTitle = currentTitle.toLowerCase();
    const isRoleTitle = lowerTitle.includes('kage') ||
        lowerTitle.includes('elder') ||
        lowerTitle.includes('anbu') ||
        lowerTitle.includes('clan leader') ||
        lowerTitle.includes('clan head');

    if (currentTitle && isRoleTitle && !levelOnlyRankTitles.has(currentTitle)) return currentTitle;
    if (character.clanFounder) return 'Clan Leader';
    return '';
}

export function rankTitleForLevel(character: XpCharacter, level: number): string {
    if (level < MAX_LEVEL) return rankFromLevel(level);
    return roleRankTitle(character) || 'Special Jonin';
}

// ── App.tsx — examLevelCap ──────────────────────────────────────────────────
const EXAM_LEVEL_GATES: { exam: string; level: number }[] = [
    { exam: 'genin', level: 20 },
    { exam: 'chunin', level: 39 },
    // Jonin / Special Jonin exams do not block XP — players reach 100 freely.
];

function examLevelCap(character: XpCharacter): number {
    const passed = Array.isArray(character.examsPassed) ? character.examsPassed as unknown[] : [];
    for (const gate of EXAM_LEVEL_GATES) {
        if (!passed.includes(gate.exam)) return gate.level;
    }
    return MAX_LEVEL;
}

// ── lib/stats.ts — stat-derived leveling (docs/leveling-without-xp-map.md) ──
// Level is a pure function of total stat points EARNED (allocated above base +
// the unspent pool — the conserved sum preserveStatPointEntitlement guards).
// Anchors FITTED to the per-rank caps (straight inversion of the linear budget
// walls at L15/L30). VERBATIM port of shinobij.client/src/lib/stats.ts;
// parity-pinned by _cross-build-parity.test.ts + _level-curve.test.ts.
export const LEVEL_EARNED_ANCHORS: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [15, 2800],
    [30, 6200],
    [50, 11600],
    [80, 19600],
    [100, 27500],
];

// Total earned stat points required to BE `level` (0 at L1).
export function earnedForLevel(level: number): number {
    const clamped = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
    for (let i = 1; i < LEVEL_EARNED_ANCHORS.length; i++) {
        const [aL, aE] = LEVEL_EARNED_ANCHORS[i - 1];
        const [bL, bE] = LEVEL_EARNED_ANCHORS[i];
        if (clamped >= aL && clamped <= bL) {
            return aE + Math.round(((clamped - aL) / (bL - aL)) * (bE - aE));
        }
    }
    return 0;
}

// The raw curve inverse: the level `earned` total points supports. Exam holds
// (examLevelCap) are applied by the caller — monotone in `earned`.
export function levelForEarned(earned: number): number {
    const points = Math.max(0, Math.floor(earned));
    for (let level = MAX_LEVEL; level >= 2; level--) {
        if (earnedForLevel(level) <= points) return level;
    }
    return 1;
}

// The conserved earned-points sum off the raw save shape.
export function earnedStatPoints(character: XpCharacter): number {
    const stats = normalizeStats(character.stats as Record<string, unknown> | undefined);
    const pool = Math.max(0, Math.floor(Number(character.unspentStats) || 0));
    return allocatedStatPoints(stats) + pool;
}

// Recompute the character's level from the earned-points ledger, clamped by the
// exam holds. RISE-ONLY by design: an unmigrated save (old XP-era level above
// its earned-derived level) must never de-level when a grant endpoint touches
// it before the one-time sanitizer migration tops its pool up — the migration
// (api/save/[name].ts) is the only place the two are reconciled downward-safe.
// A level-up refills vitals to the new maxima, exactly like the old per-level
// gainXp loop's final state.
export function applyDerivedLevel(character: XpCharacter): XpCharacter {
    let updated = reconcileCharacterStatBudget(character);
    const earned = earnedStatPoints(updated);
    const target = Math.max(1, Math.min(examLevelCap(updated), levelForEarned(earned)));
    const current = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(updated.level) || 1)));
    if (target > current) {
        const nextMaxHp = maxHpForLevel(target);
        const nextMaxChakra = maxChakraForLevel(target);
        const nextMaxStamina = maxStaminaForLevel(target);
        updated = {
            ...updated,
            level: target,
            rankTitle: rankTitleForLevel(updated, target),
            maxHp: nextMaxHp,
            maxChakra: nextMaxChakra,
            maxStamina: nextMaxStamina,
            hp: nextMaxHp,
            chakra: nextMaxChakra,
            stamina: nextMaxStamina,
        };
    }
    return updated;
}

// ── gainXp — RETIRED XP driver, kept as a derived-level compatibility shim ──
// Character XP is removed (docs/leveling-without-xp-map.md): level derives from
// the earned-points ledger, so the amount is ignored and the call collapses to
// the rise-only derived-level recompute. Legacy grant sites can keep calling
// this safely while they are converted; the frozen `xp` field is never touched.
export function gainXp(character: XpCharacter, _amount: number): XpCharacter {
    return applyDerivedLevel(character);
}

// ── PvP-win reward composition ──────────────────────────────────────────────
export type PvpWinGains = { ryoGain: number; deathsGate: boolean; trait: string | null; growthMult: number };

/** The base PvP-win ryo for `char`, scaled by the active pet trait and the
 *  Death's Gate (sector 99) 2× bonus. Character XP is retired — the old Swift
 *  +25% XP and Death's Gate ×2 XP boosts now act on PvP STAT GROWTH instead
 *  (docs/leveling-without-xp-map.md §4.1), surfaced here as `growthMult`. */
export function computePvpWinGains(char: XpCharacter, rewardSector: unknown): PvpWinGains {
    const pets = Array.isArray(char.pets) ? char.pets as Array<Record<string, unknown>> : [];
    const activePet = pets.find((p) => p && p.id === char.activePetId);
    const trait = (activePet && typeof activePet.trait === 'string') ? activePet.trait : null;
    const deathsGate = Number(rewardSector) === 99;
    const ryoGain = (trait === 'Lucky' ? 90 : 75) * (deathsGate ? 2 : 1);
    const growthMult = (trait === 'Swift' ? 1.25 : 1) * (deathsGate ? 2 : 1);
    return { ryoGain, deathsGate, trait, growthMult };
}

export type PvpWinCredit = {
    char: XpCharacter;
    summary: { ryo: number; xp: number; level: number; rankTitle: string; maxHp: number; maxChakra: number; maxStamina: number; unspentStats: number; statGrowth?: { allocated: Record<string, number>; unspentGain: number } };
};

/** Apply the base PvP-win reward to `char`: ryo += ryoGain plus the rise-only
 *  derived-level recompute (XP is retired — stat growth is credited separately
 *  by the claim endpoint and is what actually moves the ledger). Returns the
 *  mutated character plus a summary for the client read-back; `summary.xp`
 *  stays in the shape as 0 so older clients keep parsing. */
export function creditPvpWinBase(char: XpCharacter, ryoGain: number): PvpWinCredit {
    const leveled = applyDerivedLevel(char);
    const nextChar: XpCharacter = { ...leveled, ryo: (Number(leveled.ryo) || 0) + ryoGain };
    return {
        char: nextChar,
        summary: {
            ryo: Number(nextChar.ryo) || 0,
            xp: 0,
            level: Number(nextChar.level) || 0,
            rankTitle: typeof nextChar.rankTitle === 'string' ? nextChar.rankTitle : '',
            maxHp: Number(nextChar.maxHp) || 0,
            maxChakra: Number(nextChar.maxChakra) || 0,
            maxStamina: Number(nextChar.maxStamina) || 0,
            unspentStats: Number(nextChar.unspentStats) || 0,
        },
    };
}
