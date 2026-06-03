"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAT_KEYS = exports.STAMINA_CAP = exports.CHAKRA_CAP = exports.HP_CAP = exports.CHARACTER_XP_GAIN_MULTIPLIER = exports.STARTING_STAT_POINTS = exports.MAX_STAT = exports.MAX_LEVEL = void 0;
exports.xpNeeded = xpNeeded;
exports.maxHpForLevel = maxHpForLevel;
exports.maxChakraForLevel = maxChakraForLevel;
exports.maxStaminaForLevel = maxStaminaForLevel;
exports.rankFromLevel = rankFromLevel;
exports.reconcileCharacterStatBudget = reconcileCharacterStatBudget;
exports.effectiveCharacterXpGain = effectiveCharacterXpGain;
exports.rankTitleForLevel = rankTitleForLevel;
exports.gainXp = gainXp;
exports.computePvpWinGains = computePvpWinGains;
exports.creditPvpWinBase = creditPvpWinBase;
// ── constants/game.ts ───────────────────────────────────────────────────────
exports.MAX_LEVEL = 100;
exports.MAX_STAT = 2500;
exports.STARTING_STAT_POINTS = 20;
exports.CHARACTER_XP_GAIN_MULTIPLIER = 3;
exports.HP_CAP = 10000;
exports.CHAKRA_CAP = 5000;
exports.STAMINA_CAP = 5000;
// ── lib/stats.ts — stat helpers ─────────────────────────────────────────────
exports.STAT_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense',
    'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense',
    'ninjutsuOffense', 'ninjutsuDefense',
];
function capStat(value) {
    return Math.min(exports.MAX_STAT, Math.max(0, Math.floor(value)));
}
function baseStats() {
    return {
        strength: 10, speed: 10, intelligence: 10, willpower: 10,
        bukijutsuOffense: 10, bukijutsuDefense: 10,
        taijutsuOffense: 10, taijutsuDefense: 10,
        genjutsuOffense: 10, genjutsuDefense: 10,
        ninjutsuOffense: 10, ninjutsuDefense: 10,
    };
}
function normalizeStats(stats) {
    const base = baseStats();
    return exports.STAT_KEYS.reduce((normalized, key) => {
        const raw = stats?.[key];
        normalized[key] = capStat(raw == null ? base[key] : Number(raw));
        return normalized;
    }, { ...base });
}
function allocatedStatPoints(stats) {
    const base = baseStats();
    return exports.STAT_KEYS.reduce((total, key) => total + Math.max(0, capStat(stats[key]) - base[key]), 0);
}
// ── lib/stats.ts — level / XP curve ─────────────────────────────────────────
function xpNeeded(level) {
    if (level >= exports.MAX_LEVEL)
        return 0;
    return level * 100;
}
const TOTAL_XP_TO_MAX_LEVEL = ((exports.MAX_LEVEL - 1) * exports.MAX_LEVEL / 2) * 100;
function totalXpBeforeLevel(level) {
    const clampedLevel = Math.max(1, Math.min(exports.MAX_LEVEL, Math.floor(level)));
    return ((clampedLevel - 1) * clampedLevel / 2) * 100;
}
function totalXpForProgress(level, xp) {
    if (level >= exports.MAX_LEVEL)
        return TOTAL_XP_TO_MAX_LEVEL;
    const currentLevelXp = Math.max(0, Math.min(xpNeeded(level), Math.floor(xp)));
    return Math.min(TOTAL_XP_TO_MAX_LEVEL, totalXpBeforeLevel(level) + currentLevelXp);
}
function maxHpForLevel(level) {
    return Math.min(exports.HP_CAP, 100 + (Math.max(1, level) - 1) * 100);
}
function maxChakraForLevel(level) {
    return Math.min(exports.CHAKRA_CAP, Math.floor(100 + (Math.max(1, level) - 1) * ((exports.CHAKRA_CAP - 100) / (exports.MAX_LEVEL - 1))));
}
function maxStaminaForLevel(level) {
    return Math.min(exports.STAMINA_CAP, Math.floor(100 + (Math.max(1, level) - 1) * ((exports.STAMINA_CAP - 100) / (exports.MAX_LEVEL - 1))));
}
function rankFromLevel(level) {
    if (level >= 80)
        return 'Special Jonin';
    if (level >= 50)
        return 'Jonin';
    if (level >= 30)
        return 'Chunin';
    if (level >= 15)
        return 'Genin';
    return 'Academy Student';
}
// ── lib/stats.ts — stat budget ──────────────────────────────────────────────
const TOTAL_STAT_POINTS_TO_CAP = exports.STAT_KEYS.reduce((total, key) => total + (exports.MAX_STAT - baseStats()[key]), 0);
const STAT_POINTS_FROM_XP_TO_CAP = TOTAL_STAT_POINTS_TO_CAP - exports.STARTING_STAT_POINTS;
function statPointBudgetForProgress(level, xp) {
    const progressXp = totalXpForProgress(level, xp);
    const earnedFromXp = Math.floor((progressXp / TOTAL_XP_TO_MAX_LEVEL) * STAT_POINTS_FROM_XP_TO_CAP);
    return Math.min(TOTAL_STAT_POINTS_TO_CAP, exports.STARTING_STAT_POINTS + earnedFromXp);
}
function reconcileCharacterStatBudget(character) {
    const stats = normalizeStats(character.stats);
    const level = Number(character.level);
    const xp = Number(character.xp);
    const earnedBudget = statPointBudgetForProgress(level, xp);
    const available = Math.max(0, earnedBudget - allocatedStatPoints(stats));
    return { ...character, stats, unspentStats: available };
}
// ── lib/progression.ts ──────────────────────────────────────────────────────
function effectiveCharacterXpGain(character, amount) {
    const baseAmount = Math.max(0, Math.floor(amount));
    const testingBoostedAmount = Math.floor(baseAmount * exports.CHARACTER_XP_GAIN_MULTIPLIER);
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
function roleRankTitle(character) {
    const currentTitle = typeof character.rankTitle === 'string' ? character.rankTitle.trim() : '';
    const lowerTitle = currentTitle.toLowerCase();
    const isRoleTitle = lowerTitle.includes('kage') ||
        lowerTitle.includes('elder') ||
        lowerTitle.includes('anbu') ||
        lowerTitle.includes('clan leader') ||
        lowerTitle.includes('clan head');
    if (currentTitle && isRoleTitle && !levelOnlyRankTitles.has(currentTitle))
        return currentTitle;
    if (character.clanFounder)
        return 'Clan Leader';
    return '';
}
function rankTitleForLevel(character, level) {
    if (level < exports.MAX_LEVEL)
        return rankFromLevel(level);
    return roleRankTitle(character) || 'Special Jonin';
}
// ── App.tsx — examLevelCap ──────────────────────────────────────────────────
const EXAM_LEVEL_GATES = [
    { exam: 'genin', level: 20 },
    { exam: 'chunin', level: 39 },
    // Jonin / Special Jonin exams do not block XP — players reach 100 freely.
];
function examLevelCap(character) {
    const passed = Array.isArray(character.examsPassed) ? character.examsPassed : [];
    for (const gate of EXAM_LEVEL_GATES) {
        if (!passed.includes(gate.exam))
            return gate.level;
    }
    return exports.MAX_LEVEL;
}
// ── App.tsx — gainXp (the driver) ───────────────────────────────────────────
function gainXp(character, amount) {
    const totalAmount = effectiveCharacterXpGain(character, amount);
    const levelCap = examLevelCap(character);
    let updated = reconcileCharacterStatBudget(character);
    const startLevel = Number(updated.level);
    const startXp = Number(updated.xp);
    updated = { ...updated, level: startLevel, xp: startLevel >= exports.MAX_LEVEL ? 0 : startXp + totalAmount };
    while (Number(updated.level) < exports.MAX_LEVEL && Number(updated.level) < levelCap && Number(updated.xp) >= xpNeeded(Number(updated.level))) {
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
    if (Number(updated.level) >= levelCap && Number(updated.level) < exports.MAX_LEVEL) {
        updated = { ...updated, xp: Math.min(Number(updated.xp), xpNeeded(Number(updated.level)) - 1) };
    }
    if (Number(updated.level) >= exports.MAX_LEVEL) {
        updated = { ...updated, level: exports.MAX_LEVEL, xp: 0, rankTitle: rankTitleForLevel(updated, exports.MAX_LEVEL) };
    }
    return reconcileCharacterStatBudget(updated);
}
/** The base PvP-win xp/ryo for `char`, scaled by the active pet trait and the
 *  Death's Gate (sector 99) 2× bonus. `rewardSector` comes from the session
 *  stamp; the trait is read from the winner's own (full) save. */
function computePvpWinGains(char, rewardSector) {
    const pets = Array.isArray(char.pets) ? char.pets : [];
    const activePet = pets.find((p) => p && p.id === char.activePetId);
    const trait = (activePet && typeof activePet.trait === 'string') ? activePet.trait : null;
    const deathsGate = Number(rewardSector) === 99;
    const xpGain = (trait === 'Swift' ? 125 : 100) * (deathsGate ? 2 : 1);
    const ryoGain = (trait === 'Lucky' ? 90 : 75) * (deathsGate ? 2 : 1);
    return { xpGain, ryoGain, deathsGate, trait };
}
/** Apply the base PvP-win reward to `char`: gainXp(xpGain) then ryo += ryoGain.
 *  Returns the mutated character plus a summary of the credited fields for the
 *  client read-back. Verbatim with handlePvpWin's `gainXp` + `ryo: rewarded.ryo
 *  + ryoGain` (the territory-scroll/auraDust/kill-counter grants are NOT here —
 *  they stay client-side this phase). */
function creditPvpWinBase(char, xpGain, ryoGain) {
    const leveled = gainXp(char, xpGain);
    const nextChar = { ...leveled, ryo: (Number(leveled.ryo) || 0) + ryoGain };
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
