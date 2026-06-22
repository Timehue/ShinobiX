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
export const CHARACTER_XP_GAIN_MULTIPLIER = 3;
export const HP_CAP = 10000;
export const CHAKRA_CAP = 5000;
export const STAMINA_CAP = 5000;

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

function allocatedStatPoints(stats: Stats): number {
    const base = baseStats();
    return STAT_KEYS.reduce((total, key) => total + Math.max(0, capStat(stats[key]) - base[key]), 0);
}

// ── lib/stats.ts — level / XP curve ─────────────────────────────────────────
export function xpNeeded(level: number): number {
    if (level >= MAX_LEVEL) return 0;
    return level * 100;
}

const TOTAL_XP_TO_MAX_LEVEL = ((MAX_LEVEL - 1) * MAX_LEVEL / 2) * 100;

function totalXpBeforeLevel(level: number): number {
    const clampedLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
    return ((clampedLevel - 1) * clampedLevel / 2) * 100;
}

function totalXpForProgress(level: number, xp: number): number {
    if (level >= MAX_LEVEL) return TOTAL_XP_TO_MAX_LEVEL;
    const currentLevelXp = Math.max(0, Math.min(xpNeeded(level), Math.floor(xp)));
    return Math.min(TOTAL_XP_TO_MAX_LEVEL, totalXpBeforeLevel(level) + currentLevelXp);
}

export function maxHpForLevel(level: number): number {
    // Base HP at level 1 is 500 (starter HP); +100 per level thereafter, up to
    // HP_CAP. Shifting only the base keeps the curve balance-neutral — players and
    // same-level AI (aiHpForLevel multiplies this) both gain the +400 base.
    // Keep this in lock-step with shinobij.client/src/lib/stats.ts (parity test).
    return Math.min(HP_CAP, 500 + (Math.max(1, level) - 1) * 100);
}

export function maxChakraForLevel(level: number): number {
    return Math.min(CHAKRA_CAP, Math.floor(100 + (Math.max(1, level) - 1) * ((CHAKRA_CAP - 100) / (MAX_LEVEL - 1))));
}

export function maxStaminaForLevel(level: number): number {
    return Math.min(STAMINA_CAP, Math.floor(100 + (Math.max(1, level) - 1) * ((STAMINA_CAP - 100) / (MAX_LEVEL - 1))));
}

export function rankFromLevel(level: number): string {
    if (level >= 80) return 'Special Jonin';
    if (level >= 50) return 'Jonin';
    if (level >= 30) return 'Chunin';
    if (level >= 15) return 'Genin';
    return 'Academy Student';
}

// ── lib/stats.ts — stat budget ──────────────────────────────────────────────
const TOTAL_STAT_POINTS_TO_CAP = STAT_KEYS.reduce((total, key) => total + (MAX_STAT - baseStats()[key]), 0);
const STAT_POINTS_FROM_XP_TO_CAP = TOTAL_STAT_POINTS_TO_CAP - STARTING_STAT_POINTS;

function statPointBudgetForProgress(level: number, xp: number): number {
    const progressXp = totalXpForProgress(level, xp);
    const earnedFromXp = Math.floor((progressXp / TOTAL_XP_TO_MAX_LEVEL) * STAT_POINTS_FROM_XP_TO_CAP);
    return Math.min(TOTAL_STAT_POINTS_TO_CAP, STARTING_STAT_POINTS + earnedFromXp);
}

// Loose character shape — the server operates on the raw KV save object.
export type XpCharacter = Record<string, unknown>;

export function reconcileCharacterStatBudget(character: XpCharacter): XpCharacter {
    const stats = normalizeStats(character.stats as Record<string, unknown> | undefined);
    const level = Number(character.level);
    const xp = Number(character.xp);
    const earnedBudget = statPointBudgetForProgress(level, xp);
    const available = Math.max(0, earnedBudget - allocatedStatPoints(stats));
    return { ...character, stats, unspentStats: available };
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

// ── App.tsx — gainXp (the driver) ───────────────────────────────────────────
export function gainXp(character: XpCharacter, amount: number): XpCharacter {
    const totalAmount = effectiveCharacterXpGain(character as { elderFocus?: unknown }, amount);
    const levelCap = examLevelCap(character);
    let updated: XpCharacter = reconcileCharacterStatBudget(character);
    const startLevel = Number(updated.level);
    const startXp = Number(updated.xp);
    updated = { ...updated, level: startLevel, xp: startLevel >= MAX_LEVEL ? 0 : startXp + totalAmount };
    while (Number(updated.level) < MAX_LEVEL && Number(updated.level) < levelCap && Number(updated.xp) >= xpNeeded(Number(updated.level))) {
        const curLevel = Number(updated.level);
        const needed = xpNeeded(curLevel);
        const newLevel = curLevel + 1;
        const nextMaxHp = maxHpForLevel(newLevel);
        const nextMaxChakra = maxChakraForLevel(newLevel);
        const nextMaxStamina = maxStaminaForLevel(newLevel);
        updated = {
            ...updated,
            xp: Number(updated.xp) - needed,
            level: newLevel,
            rankTitle: rankTitleForLevel(updated, newLevel),
            maxHp: nextMaxHp,
            maxChakra: nextMaxChakra,
            maxStamina: nextMaxStamina,
            hp: nextMaxHp,
            chakra: nextMaxChakra,
            stamina: nextMaxStamina,
        };
    }
    // If capped by exam gate, clamp XP so it doesn't overflow past the threshold.
    if (Number(updated.level) >= levelCap && Number(updated.level) < MAX_LEVEL) {
        updated = { ...updated, xp: Math.min(Number(updated.xp), xpNeeded(Number(updated.level)) - 1) };
    }
    if (Number(updated.level) >= MAX_LEVEL) {
        updated = { ...updated, level: MAX_LEVEL, xp: 0, rankTitle: rankTitleForLevel(updated, MAX_LEVEL) };
    }
    return reconcileCharacterStatBudget(updated);
}

// ── PvP-win reward composition (App.tsx handlePvpWin 10365-10416) ────────────
export type PvpWinGains = { xpGain: number; ryoGain: number; deathsGate: boolean; trait: string | null };

/** The base PvP-win xp/ryo for `char`, scaled by the active pet trait and the
 *  Death's Gate (sector 99) 2× bonus. `rewardSector` comes from the session
 *  stamp; the trait is read from the winner's own (full) save. */
export function computePvpWinGains(char: XpCharacter, rewardSector: unknown): PvpWinGains {
    const pets = Array.isArray(char.pets) ? char.pets as Array<Record<string, unknown>> : [];
    const activePet = pets.find((p) => p && p.id === char.activePetId);
    const trait = (activePet && typeof activePet.trait === 'string') ? activePet.trait : null;
    const deathsGate = Number(rewardSector) === 99;
    const xpGain = (trait === 'Swift' ? 125 : 100) * (deathsGate ? 2 : 1);
    const ryoGain = (trait === 'Lucky' ? 90 : 75) * (deathsGate ? 2 : 1);
    return { xpGain, ryoGain, deathsGate, trait };
}

export type PvpWinCredit = {
    char: XpCharacter;
    summary: { ryo: number; xp: number; level: number; rankTitle: string; maxHp: number; maxChakra: number; maxStamina: number; unspentStats: number };
};

/** Apply the base PvP-win reward to `char`: gainXp(xpGain) then ryo += ryoGain.
 *  Returns the mutated character plus a summary of the credited fields for the
 *  client read-back. Verbatim with handlePvpWin's `gainXp` + `ryo: rewarded.ryo
 *  + ryoGain` (the territory-scroll/auraDust/kill-counter grants are NOT here —
 *  they stay client-side this phase). */
export function creditPvpWinBase(char: XpCharacter, xpGain: number, ryoGain: number): PvpWinCredit {
    const leveled = gainXp(char, xpGain);
    const nextChar: XpCharacter = { ...leveled, ryo: (Number(leveled.ryo) || 0) + ryoGain };
    return {
        char: nextChar,
        summary: {
            ryo: Number(nextChar.ryo) || 0,
            xp: Number(nextChar.xp) || 0,
            level: Number(nextChar.level) || 0,
            rankTitle: typeof nextChar.rankTitle === 'string' ? nextChar.rankTitle : '',
            maxHp: Number(nextChar.maxHp) || 0,
            maxChakra: Number(nextChar.maxChakra) || 0,
            maxStamina: Number(nextChar.maxStamina) || 0,
            unspentStats: Number(nextChar.unspentStats) || 0,
        },
    };
}
