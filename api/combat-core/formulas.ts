import type { CombatJutsu, CombatStatus } from './types.js';

export const MAX_STAT = 2500;
export const EP_MULTIPLIER = 32;
export const JUTSU_MAX_LEVEL = 50;
export const MASTERY_MIN_DAMAGE_FRAC = 0.3;

export const JUTSU_LEVEL_CAP_ACADEMY = 10;
export const JUTSU_LEVEL_CAP_GENIN = 20;
export const JUTSU_LEVEL_CAP_CHUNIN = 30;
export const JUTSU_LEVEL_CAP_JONIN = 50;

export const STAT_CAP_ACADEMY = 350;
export const STAT_CAP_GENIN = 700;
export const STAT_CAP_CHUNIN = 1300;
export const STAT_CAP_JONIN = 2100;
export const STAT_CAP_SPECIAL_JONIN = 2500;
export const STAT_CAP_FIELDS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
];

export const K_DR = 0.5;
export const K_AMP = 0.5;
export const K_GENERALS = 0.5;
export const GENERAL_STAT_FIELDS = ['strength', 'speed', 'intelligence', 'willpower'] as const;
export const K_DISCIPLINE = 0.5;
export const DISCIPLINE_BONUS_SCALE = 2;
export const DISCIPLINE_OFFENSE_FIELD: Record<string, string> = {
    Taijutsu: 'taijutsuOffense',
    Bukijutsu: 'bukijutsuOffense',
    Genjutsu: 'genjutsuOffense',
    Ninjutsu: 'ninjutsuOffense',
};

export const DR_DOT_SCALE = 0.5;
export const HEAL_FLAT = 750;
export const SHIELD_FLAT = 750;
export const DRAIN_BASE_TICK = 50;
export const DRAIN_PER_LEVEL = 5;
export const DRAIN_MAX_TICK = 300;
export const WOUND_CAP_BY_RANK: Record<string, number> = {
    basic: 25,
    AB: 30,
    S: 35,
};
export const WOUND_HARD_CAP_PCT = 60;
export const GUARD_DEFENSE_MAX_MIT = 0.5;
export const STUN_AP_PENALTY = 40;
export const MAX_WOUND_STACKS = 2;

export const STATUS_DURATIONS_OVERRIDE: Record<string, number> = {
    'Increase Damage Given': 2,
    'Increase Damage Taken': 2,
    'Decrease Damage Given': 2,
    'Decrease Damage Taken': 2,
    'Increase Generals': 2,
    'Increase Discipline': 2,
};

export type FormulaStatus = Pick<CombatStatus, 'name' | 'percent' | 'discipline'>;
export type FormulaStatusNameMatcher = (actual: string, expected: string) => boolean;

const exactNameMatches: FormulaStatusNameMatcher = (actual, expected) => actual === expected;

export function masteryDamageFraction(
    masteryLevel: number,
    maxLevel: number,
    minFraction: number,
): number {
    return minFraction + (1 - minFraction) * (Math.max(0, Math.min(maxLevel, masteryLevel)) / maxLevel);
}

export function masteryDamageFrac(masteryLevel: number): number {
    return MASTERY_MIN_DAMAGE_FRAC + (1 - MASTERY_MIN_DAMAGE_FRAC) * (Math.max(0, Math.min(JUTSU_MAX_LEVEL, masteryLevel)) / JUTSU_MAX_LEVEL);
}

export function jutsuLevelCapForLevel(level: number): number {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    if (lvl >= 50) return JUTSU_LEVEL_CAP_JONIN;
    if (lvl >= 30) return JUTSU_LEVEL_CAP_CHUNIN;
    if (lvl >= 15) return JUTSU_LEVEL_CAP_GENIN;
    return JUTSU_LEVEL_CAP_ACADEMY;
}

export function statCapForLevel(level: number): number {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    if (lvl >= 80) return STAT_CAP_SPECIAL_JONIN;
    if (lvl >= 50) return STAT_CAP_JONIN;
    if (lvl >= 30) return STAT_CAP_CHUNIN;
    if (lvl >= 15) return STAT_CAP_GENIN;
    return STAT_CAP_ACADEMY;
}

export function perRankStatCap(stats: Record<string, number>, level: number): Record<string, number> {
    const cap = statCapForLevel(level);
    const out: Record<string, number> = { ...stats };
    for (const key of STAT_CAP_FIELDS) {
        if (typeof out[key] === 'number') out[key] = Math.min(out[key], cap);
    }
    return out;
}

export function isZeroDamageFortyApJutsu(jutsu: Pick<CombatJutsu, 'id' | 'ap' | 'isUtility'>): boolean {
    if (jutsu.isUtility === true) return true;
    if (jutsu.isUtility === false) return false;
    return jutsu.ap === 40 && jutsu.id !== 'basic-attack' && !jutsu.id.startsWith('item-');
}

export function getOffense(stats: Record<string, number>, type: string): number {
    if (type === 'Taijutsu') return (stats.taijutsuOffense ?? 0) + (stats.strength ?? 0) + (stats.speed ?? 0);
    if (type === 'Bukijutsu') return (stats.bukijutsuOffense ?? 0) + (stats.intelligence ?? 0) + (stats.strength ?? 0);
    if (type === 'Genjutsu') return (stats.genjutsuOffense ?? 0) + (stats.intelligence ?? 0) + (stats.willpower ?? 0);
    return (stats.ninjutsuOffense ?? 0) + (stats.willpower ?? 0) + (stats.speed ?? 0);
}

export function getDefense(stats: Record<string, number>, type: string): number {
    if (type === 'Taijutsu') return (stats.taijutsuDefense ?? 0) + (stats.strength ?? 0) + (stats.speed ?? 0);
    if (type === 'Bukijutsu') return (stats.bukijutsuDefense ?? 0) + (stats.intelligence ?? 0) + (stats.strength ?? 0);
    if (type === 'Genjutsu') return (stats.genjutsuDefense ?? 0) + (stats.intelligence ?? 0) + (stats.willpower ?? 0);
    return (stats.ninjutsuDefense ?? 0) + (stats.willpower ?? 0) + (stats.speed ?? 0);
}

export function statFactorFromComposites(offense: number, defense: number): number {
    return Math.max(0.35, Math.min(1.85, 1 + ((offense - defense) / (MAX_STAT * 2)) * 0.85));
}

export function statusDurationFor(name: string, fallback: number = 2): number {
    return STATUS_DURATIONS_OVERRIDE[name] ?? fallback;
}

export function hasFormulaStatus(
    statuses: readonly FormulaStatus[],
    name: string,
    nameMatches: FormulaStatusNameMatcher = exactNameMatches,
): boolean {
    return statuses.some(status => nameMatches(status.name, name));
}

export function generalsBonusFromStatuses(
    statuses: readonly FormulaStatus[],
    nameMatches: FormulaStatusNameMatcher = exactNameMatches,
): number {
    if (hasFormulaStatus(statuses, 'Bloodline Seal', nameMatches)) return 0;
    let rawFrac = 0;
    for (const status of statuses) {
        if (status.name === 'Increase Generals') rawFrac += (status.percent ?? 0) / 100;
    }
    if (rawFrac <= 0) return 0;
    const effFrac = rawFrac / (rawFrac + K_GENERALS);
    return Math.floor(effFrac * MAX_STAT);
}

export function withGeneralsBonus(stats: Record<string, number>, bonus: number): Record<string, number> {
    if (bonus <= 0) return stats;
    const out = { ...stats };
    for (const key of GENERAL_STAT_FIELDS) out[key] = (out[key] ?? 0) + bonus;
    return out;
}

export function disciplineBonusesFromStatuses(
    statuses: readonly FormulaStatus[],
    nameMatches: FormulaStatusNameMatcher = exactNameMatches,
): Record<string, number> {
    if (hasFormulaStatus(statuses, 'Bloodline Seal', nameMatches)) return {};
    const rawFrac: Record<string, number> = {};
    for (const status of statuses) {
        if (status.name !== 'Increase Discipline') continue;
        const field = DISCIPLINE_OFFENSE_FIELD[status.discipline ?? ''];
        if (field) rawFrac[field] = (rawFrac[field] ?? 0) + (status.percent ?? 0) / 100;
    }
    const out: Record<string, number> = {};
    for (const [field, raw] of Object.entries(rawFrac)) {
        if (raw <= 0) continue;
        const effFrac = raw / (raw + K_DISCIPLINE);
        out[field] = Math.floor(effFrac * MAX_STAT * DISCIPLINE_BONUS_SCALE);
    }
    return out;
}

export function withDisciplineBonuses(stats: Record<string, number>, bonuses: Record<string, number>): Record<string, number> {
    const entries = Object.entries(bonuses);
    if (!entries.length) return stats;
    const out = { ...stats };
    for (const [field, bonus] of entries) out[field] = (out[field] ?? 0) + bonus;
    return out;
}

export function cappedPostDamage(damage: number, percent: number): number {
    return Math.floor(Math.min(damage * (percent / 100), damage * 0.6));
}

export function woundCapForJutsu(jutsu: { bloodlineRank?: string | null }): number {
    const rank = (jutsu.bloodlineRank ?? '').trim();
    if (/^S/i.test(rank)) return WOUND_CAP_BY_RANK.S;
    if (/^[AB]/i.test(rank)) return WOUND_CAP_BY_RANK.AB;
    return WOUND_CAP_BY_RANK.basic;
}

export function pierceTrueDamage(offenseComposite: number, jutsuAp: number, masteryLevel: number): number {
    const apFactor = Math.max(0.5, (jutsuAp || 60) / 60);
    const masteryFactor = 1 + Math.max(0, Math.min(50, masteryLevel)) * 0.005;
    const raw = offenseComposite * 0.35 * apFactor * masteryFactor;
    return Math.floor(Math.max(100, Math.min(900, raw)));
}

export function weatherMultiplier(element: string | undefined, positiveEl: string, negativeEl: string): number {
    if (!element || (!positiveEl && !negativeEl)) return 1;
    if (positiveEl && element === positiveEl) return 1.05;
    if (negativeEl && element === negativeEl) return 0.98;
    return 1;
}

export function terrainMultiplier(jutsu: Pick<CombatJutsu, 'type'>, biome: string): number {
    switch (biome) {
        case 'forest': return jutsu.type === 'Taijutsu' ? 1.1 : 1;
        case 'snow': return jutsu.type === 'Bukijutsu' ? 1.1 : 1;
        case 'volcano': return jutsu.type === 'Ninjutsu' ? 1.1 : 1;
        case 'shadow': return jutsu.type === 'Genjutsu' ? 1.1 : 1;
        default: return 1;
    }
}

export function homeTerrainMultiplier(homeTerrainType: unknown, jutsu: Pick<CombatJutsu, 'type'>): number {
    return typeof homeTerrainType === 'string' && homeTerrainType !== '' && jutsu.type === homeTerrainType ? 1.1 : 1;
}

export function armorRawDrFromCharacter(character: Record<string, unknown>): number {
    return character.armorRawDR !== undefined && character.armorRawDR !== null
        ? Math.min(1.5, Math.max(0, Number(character.armorRawDR)))
        : Math.max(0, 1 - Math.min(1.0, Math.max(0.25, Number(character.armorFactor ?? 1.0))));
}

export function drContributionFromStatuses(
    attackerStatuses: readonly FormulaStatus[],
    defenderStatuses: readonly FormulaStatus[],
): number {
    let dr = 0;
    for (const status of attackerStatuses) {
        if (status.name === 'Decrease Damage Given') dr += (status.percent ?? 0) / 100;
    }
    for (const status of defenderStatuses) {
        if (status.name === 'Decrease Damage Taken') dr += (status.percent ?? 0) / 100;
    }
    return dr;
}

export function effectiveDrFromRaw(rawTotalDR: number): number {
    return rawTotalDR > 0 ? rawTotalDR / (rawTotalDR + K_DR) : 0;
}

export function ampMultiplierFromStatuses(
    attackerStatuses: readonly FormulaStatus[],
    defenderStatuses: readonly FormulaStatus[],
    nameMatches: FormulaStatusNameMatcher = exactNameMatches,
): number {
    let rawAmp = 0;
    for (const status of attackerStatuses) {
        if (status.name === 'Increase Damage Given') rawAmp += (status.percent ?? 0) / 100;
    }
    for (const status of defenderStatuses) {
        if (status.name === 'Increase Damage Taken') rawAmp += (status.percent ?? 0) / 100;
        else if (nameMatches(status.name, 'Ignition')) rawAmp += (status.percent ?? 0) / 100;
    }
    if (rawAmp <= 0) return 1;
    return 1 + rawAmp / (rawAmp + K_AMP);
}

export function ampTagCapForRank(rank?: string | null): number {
    const trimmed = (rank ?? '').trim();
    if (/^S/i.test(trimmed)) return 40;
    if (/^[AB]/i.test(trimmed)) return 35;
    return 30;
}

export function scaledTagPercent(
    rawPct: number,
    masteryLevel: number,
    tagName?: string,
    bloodlineRank?: string | null,
    cappedTagNames?: ReadonlySet<string>,
): number {
    const raw = rawPct > 0 ? rawPct : 30;
    const levelScaled = Math.max(0, raw - (50 - masteryLevel) * 0.2);
    if (tagName && cappedTagNames?.has(tagName)) {
        return Math.min(levelScaled, ampTagCapForRank(bloodlineRank));
    }
    return levelScaled;
}

export function drainTick(masteryLevel: number): number {
    return Math.max(DRAIN_BASE_TICK, Math.min(DRAIN_MAX_TICK, DRAIN_BASE_TICK + masteryLevel * DRAIN_PER_LEVEL));
}

export function healAmountForMastery(masteryLevel: number, healBoost: number): number {
    return Math.min(HEAL_FLAT, Math.floor(HEAL_FLAT * masteryDamageFrac(masteryLevel) * healBoost));
}

export function shieldAmountForMastery(masteryLevel: number): number {
    return Math.min(SHIELD_FLAT, Math.floor(SHIELD_FLAT * masteryDamageFrac(masteryLevel)));
}

export function itemDamageMultiplier(itemDamagePct: unknown): number {
    return 1 + Math.max(0, Number(itemDamagePct ?? 0)) / 100;
}

export function bloodlineDamageMultiplier(bloodlineMult: unknown, isSealed: boolean): number {
    return isSealed ? 1.0 : Math.max(1.0, Number(bloodlineMult ?? 1.0));
}

export function guardDefenseMitigationPct(guardDefensePct: unknown): number {
    return Math.min(GUARD_DEFENSE_MAX_MIT, Math.max(0, Number(guardDefensePct ?? 0) / 100));
}

export function dotMitigationFromRawDr(rawArmorDR: number, rawStatusDR: number): number {
    const ownEffDR = effectiveDrFromRaw(Math.max(0, rawArmorDR) + Math.max(0, rawStatusDR));
    return Math.max(0, 1 - ownEffDR * DR_DOT_SCALE);
}

export type DirectDamageFormulaInput = {
    jutsu: Pick<CombatJutsu, 'id' | 'type' | 'ap' | 'effectPower' | 'isUtility'>;
    attackerStats: Record<string, number>;
    defenderStats: Record<string, number>;
    attackerCharacter: Record<string, unknown>;
    defenderCharacter: Record<string, unknown>;
    masteryLevel: number;
    wMult?: number;
    biome?: string;
    rawStatusDR?: number;
    hasBloodlineSeal?: boolean;
    partyDamageScale?: number;
};

export type DirectDamageFormulaResult = {
    baseDmg: number;
    effectiveDR: number;
    offStats: Record<string, number>;
    offense: number;
    defense: number;
    statFactor: number;
    armorRawDR: number;
    rawTotalDR: number;
};

export function directDamageBaseFormula(input: DirectDamageFormulaInput): DirectDamageFormulaResult {
    const {
        jutsu,
        attackerStats,
        defenderStats,
        attackerCharacter,
        defenderCharacter,
        masteryLevel,
        wMult = 1,
        biome = 'central',
        rawStatusDR = 0,
        hasBloodlineSeal = false,
        partyDamageScale = 1,
    } = input;
    const epAtMax = (jutsu.effectPower ?? 20) + JUTSU_MAX_LEVEL * 0.2;
    const scaledEp = isZeroDamageFortyApJutsu(jutsu) ? 0 : Math.max(0, epAtMax * masteryDamageFrac(masteryLevel));
    const offense = getOffense(attackerStats, jutsu.type);
    const defense = getDefense(defenderStats, jutsu.type);
    const statFactor = statFactorFromComposites(offense, defense);
    const baseDmg = Math.max(0, Math.floor(
        scaledEp *
        EP_MULTIPLIER *
        statFactor *
        wMult *
        terrainMultiplier(jutsu, biome) *
        homeTerrainMultiplier(attackerCharacter.homeTerrainType, jutsu) *
        bloodlineDamageMultiplier(attackerCharacter.bloodlineMult, hasBloodlineSeal) *
        itemDamageMultiplier(attackerCharacter.itemDamagePct) *
        Math.max(0, Number(partyDamageScale) || 0)
    ));
    const armorRawDR = armorRawDrFromCharacter(defenderCharacter);
    const rawTotalDR = armorRawDR + Math.max(0, rawStatusDR);
    return {
        baseDmg,
        effectiveDR: effectiveDrFromRaw(rawTotalDR),
        offStats: attackerStats,
        offense,
        defense,
        statFactor,
        armorRawDR,
        rawTotalDR,
    };
}

export type DirectDamageNumberInput = {
    damageIn: number;
    pierce: boolean;
    offenseComposite: number;
    jutsuAp: number;
    masteryLevel: number;
    effectiveDR: number;
    ampMultiplier: number;
    guardDefensePct?: unknown;
};

export function directDamageNumberFormula(input: DirectDamageNumberInput): number {
    if (input.pierce) {
        return pierceTrueDamage(input.offenseComposite, input.jutsuAp, input.masteryLevel);
    }
    const base = Math.max(0, Math.floor(input.damageIn * (1 - input.effectiveDR) * input.ampMultiplier));
    const guardMit = guardDefenseMitigationPct(input.guardDefensePct);
    return guardMit > 0 ? Math.max(0, Math.floor(base * (1 - guardMit))) : base;
}

export function healMultiplierFromStatuses(
    statuses: readonly FormulaStatus[],
    nameMatches: FormulaStatusNameMatcher = exactNameMatches,
): number {
    return statuses
        .filter(status => nameMatches(status.name, 'Increase Heal'))
        .reduce((mult, status) => mult * (1 + (status.percent ?? 0) / 100), 1);
}

export function clampedPercent(value: unknown): number {
    return Math.max(0, Math.min(100, Number(value ?? 0)));
}

export type PostDamageFormulaInput = {
    damage: number;
    shield: number;
    pierce: boolean;
    reflectPct: number;
    absorbPct: number;
    itemAbsorbPct?: unknown;
    itemReflectPct?: unknown;
    itemLifeStealPct?: unknown;
};

export type PostDamageFormulaResult = {
    blocked: number;
    finalDmg: number;
    reflectedDmg: number;
    absorbHeal: number;
    itemAbsorbHeal: number;
    itemReflectedDmg: number;
    itemLifeStealHeal: number;
};

export function postDamageFormula(input: PostDamageFormulaInput): PostDamageFormulaResult {
    const blocked = input.pierce ? 0 : Math.min(input.shield, input.damage);
    const finalDmg = Math.max(0, input.damage - blocked);
    const reflectedDmg = input.reflectPct > 0 && !input.pierce ? cappedPostDamage(finalDmg, input.reflectPct) : 0;
    const absorbHeal = input.absorbPct > 0 && !input.pierce ? cappedPostDamage(finalDmg, input.absorbPct) : 0;
    const itemAbsorbPct = clampedPercent(input.itemAbsorbPct);
    const itemReflectPct = clampedPercent(input.itemReflectPct);
    const itemLifeStealPct = clampedPercent(input.itemLifeStealPct);
    return {
        blocked,
        finalDmg,
        reflectedDmg,
        absorbHeal,
        itemAbsorbHeal: !input.pierce && itemAbsorbPct > 0 ? Math.floor(cappedPostDamage(finalDmg, itemAbsorbPct)) : 0,
        itemReflectedDmg: !input.pierce && itemReflectPct > 0 ? Math.floor(cappedPostDamage(finalDmg, itemReflectPct)) : 0,
        itemLifeStealHeal: !input.pierce && itemLifeStealPct > 0 ? Math.floor(cappedPostDamage(finalDmg, itemLifeStealPct)) : 0,
    };
}

export function postDamagePercentAmount(finalDmg: number, percent: number, multiplier = 1): number {
    return Math.floor(cappedPostDamage(finalDmg, percent || 30) * multiplier);
}

export function woundAmountForFinalDamage(finalDmg: number, rawPercent: number | undefined, jutsu: { bloodlineRank?: string | null }): number {
    const effectivePct = Math.min(rawPercent || 30, woundCapForJutsu(jutsu), WOUND_HARD_CAP_PCT);
    return cappedPostDamage(finalDmg, effectivePct);
}
