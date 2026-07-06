"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_DURATIONS_OVERRIDE = exports.MAX_WOUND_STACKS = exports.STUN_AP_PENALTY = exports.GUARD_DEFENSE_MAX_MIT = exports.WOUND_HARD_CAP_PCT = exports.WOUND_CAP_BY_RANK = exports.DRAIN_MAX_TICK = exports.DRAIN_PER_LEVEL = exports.DRAIN_BASE_TICK = exports.SHIELD_FLAT = exports.HEAL_FLAT = exports.DR_DOT_SCALE = exports.DISCIPLINE_OFFENSE_FIELD = exports.DISCIPLINE_BONUS_SCALE = exports.K_DISCIPLINE = exports.GENERAL_STAT_FIELDS = exports.K_GENERALS = exports.K_AMP = exports.K_DR = exports.STAT_CAP_FIELDS = exports.STAT_CAP_SPECIAL_JONIN = exports.STAT_CAP_JONIN = exports.STAT_CAP_CHUNIN = exports.STAT_CAP_GENIN = exports.STAT_CAP_ACADEMY = exports.JUTSU_LEVEL_CAP_JONIN = exports.JUTSU_LEVEL_CAP_CHUNIN = exports.JUTSU_LEVEL_CAP_GENIN = exports.JUTSU_LEVEL_CAP_ACADEMY = exports.MASTERY_MIN_DAMAGE_FRAC = exports.JUTSU_MAX_LEVEL = exports.EP_MULTIPLIER = exports.MAX_STAT = void 0;
exports.masteryDamageFraction = masteryDamageFraction;
exports.masteryDamageFrac = masteryDamageFrac;
exports.jutsuLevelCapForLevel = jutsuLevelCapForLevel;
exports.statCapForLevel = statCapForLevel;
exports.perRankStatCap = perRankStatCap;
exports.isZeroDamageFortyApJutsu = isZeroDamageFortyApJutsu;
exports.getOffense = getOffense;
exports.getDefense = getDefense;
exports.statFactorFromComposites = statFactorFromComposites;
exports.statusDurationFor = statusDurationFor;
exports.hasFormulaStatus = hasFormulaStatus;
exports.generalsBonusFromStatuses = generalsBonusFromStatuses;
exports.withGeneralsBonus = withGeneralsBonus;
exports.disciplineBonusesFromStatuses = disciplineBonusesFromStatuses;
exports.withDisciplineBonuses = withDisciplineBonuses;
exports.cappedPostDamage = cappedPostDamage;
exports.woundCapForJutsu = woundCapForJutsu;
exports.pierceTrueDamage = pierceTrueDamage;
exports.weatherMultiplier = weatherMultiplier;
exports.terrainMultiplier = terrainMultiplier;
exports.homeTerrainMultiplier = homeTerrainMultiplier;
exports.armorRawDrFromCharacter = armorRawDrFromCharacter;
exports.drContributionFromStatuses = drContributionFromStatuses;
exports.effectiveDrFromRaw = effectiveDrFromRaw;
exports.ampMultiplierFromStatuses = ampMultiplierFromStatuses;
exports.ampTagCapForRank = ampTagCapForRank;
exports.scaledTagPercent = scaledTagPercent;
exports.drainTick = drainTick;
exports.healAmountForMastery = healAmountForMastery;
exports.shieldAmountForMastery = shieldAmountForMastery;
exports.itemDamageMultiplier = itemDamageMultiplier;
exports.bloodlineDamageMultiplier = bloodlineDamageMultiplier;
exports.guardDefenseMitigationPct = guardDefenseMitigationPct;
exports.dotMitigationFromRawDr = dotMitigationFromRawDr;
exports.directDamageBaseFormula = directDamageBaseFormula;
exports.directDamageNumberFormula = directDamageNumberFormula;
exports.healMultiplierFromStatuses = healMultiplierFromStatuses;
exports.clampedPercent = clampedPercent;
exports.postDamageFormula = postDamageFormula;
exports.postDamagePercentAmount = postDamagePercentAmount;
exports.woundAmountForFinalDamage = woundAmountForFinalDamage;
exports.MAX_STAT = 2500;
exports.EP_MULTIPLIER = 32;
exports.JUTSU_MAX_LEVEL = 50;
exports.MASTERY_MIN_DAMAGE_FRAC = 0.3;
exports.JUTSU_LEVEL_CAP_ACADEMY = 10;
exports.JUTSU_LEVEL_CAP_GENIN = 20;
exports.JUTSU_LEVEL_CAP_CHUNIN = 30;
exports.JUTSU_LEVEL_CAP_JONIN = 50;
exports.STAT_CAP_ACADEMY = 350;
exports.STAT_CAP_GENIN = 700;
exports.STAT_CAP_CHUNIN = 1300;
exports.STAT_CAP_JONIN = 2100;
exports.STAT_CAP_SPECIAL_JONIN = 2500;
exports.STAT_CAP_FIELDS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
];
exports.K_DR = 0.5;
exports.K_AMP = 0.5;
exports.K_GENERALS = 0.5;
exports.GENERAL_STAT_FIELDS = ['strength', 'speed', 'intelligence', 'willpower'];
exports.K_DISCIPLINE = 0.5;
exports.DISCIPLINE_BONUS_SCALE = 2;
exports.DISCIPLINE_OFFENSE_FIELD = {
    Taijutsu: 'taijutsuOffense',
    Bukijutsu: 'bukijutsuOffense',
    Genjutsu: 'genjutsuOffense',
    Ninjutsu: 'ninjutsuOffense',
};
exports.DR_DOT_SCALE = 0.5;
exports.HEAL_FLAT = 750;
exports.SHIELD_FLAT = 750;
exports.DRAIN_BASE_TICK = 50;
exports.DRAIN_PER_LEVEL = 5;
exports.DRAIN_MAX_TICK = 300;
exports.WOUND_CAP_BY_RANK = {
    basic: 25,
    AB: 30,
    S: 35,
};
exports.WOUND_HARD_CAP_PCT = 60;
exports.GUARD_DEFENSE_MAX_MIT = 0.5;
exports.STUN_AP_PENALTY = 40;
exports.MAX_WOUND_STACKS = 2;
exports.STATUS_DURATIONS_OVERRIDE = {
    'Increase Damage Given': 2,
    'Increase Damage Taken': 2,
    'Decrease Damage Given': 2,
    'Decrease Damage Taken': 2,
    'Increase Generals': 2,
    'Increase Discipline': 2,
};
const exactNameMatches = (actual, expected) => actual === expected;
function masteryDamageFraction(masteryLevel, maxLevel, minFraction) {
    return minFraction + (1 - minFraction) * (Math.max(0, Math.min(maxLevel, masteryLevel)) / maxLevel);
}
function masteryDamageFrac(masteryLevel) {
    return exports.MASTERY_MIN_DAMAGE_FRAC + (1 - exports.MASTERY_MIN_DAMAGE_FRAC) * (Math.max(0, Math.min(exports.JUTSU_MAX_LEVEL, masteryLevel)) / exports.JUTSU_MAX_LEVEL);
}
function jutsuLevelCapForLevel(level) {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    if (lvl >= 50)
        return exports.JUTSU_LEVEL_CAP_JONIN;
    if (lvl >= 30)
        return exports.JUTSU_LEVEL_CAP_CHUNIN;
    if (lvl >= 15)
        return exports.JUTSU_LEVEL_CAP_GENIN;
    return exports.JUTSU_LEVEL_CAP_ACADEMY;
}
function statCapForLevel(level) {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    if (lvl >= 80)
        return exports.STAT_CAP_SPECIAL_JONIN;
    if (lvl >= 50)
        return exports.STAT_CAP_JONIN;
    if (lvl >= 30)
        return exports.STAT_CAP_CHUNIN;
    if (lvl >= 15)
        return exports.STAT_CAP_GENIN;
    return exports.STAT_CAP_ACADEMY;
}
function perRankStatCap(stats, level) {
    const cap = statCapForLevel(level);
    const out = { ...stats };
    for (const key of exports.STAT_CAP_FIELDS) {
        if (typeof out[key] === 'number')
            out[key] = Math.min(out[key], cap);
    }
    return out;
}
function isZeroDamageFortyApJutsu(jutsu) {
    if (jutsu.isUtility === true)
        return true;
    if (jutsu.isUtility === false)
        return false;
    return jutsu.ap === 40 && jutsu.id !== 'basic-attack' && !jutsu.id.startsWith('item-');
}
function getOffense(stats, type) {
    if (type === 'Taijutsu')
        return (stats.taijutsuOffense ?? 0) + (stats.strength ?? 0) + (stats.speed ?? 0);
    if (type === 'Bukijutsu')
        return (stats.bukijutsuOffense ?? 0) + (stats.intelligence ?? 0) + (stats.strength ?? 0);
    if (type === 'Genjutsu')
        return (stats.genjutsuOffense ?? 0) + (stats.intelligence ?? 0) + (stats.willpower ?? 0);
    return (stats.ninjutsuOffense ?? 0) + (stats.willpower ?? 0) + (stats.speed ?? 0);
}
function getDefense(stats, type) {
    if (type === 'Taijutsu')
        return (stats.taijutsuDefense ?? 0) + (stats.strength ?? 0) + (stats.speed ?? 0);
    if (type === 'Bukijutsu')
        return (stats.bukijutsuDefense ?? 0) + (stats.intelligence ?? 0) + (stats.strength ?? 0);
    if (type === 'Genjutsu')
        return (stats.genjutsuDefense ?? 0) + (stats.intelligence ?? 0) + (stats.willpower ?? 0);
    return (stats.ninjutsuDefense ?? 0) + (stats.willpower ?? 0) + (stats.speed ?? 0);
}
function statFactorFromComposites(offense, defense) {
    return Math.max(0.35, Math.min(1.85, 1 + ((offense - defense) / (exports.MAX_STAT * 2)) * 0.85));
}
function statusDurationFor(name, fallback = 2) {
    return exports.STATUS_DURATIONS_OVERRIDE[name] ?? fallback;
}
function hasFormulaStatus(statuses, name, nameMatches = exactNameMatches) {
    return statuses.some(status => nameMatches(status.name, name));
}
function generalsBonusFromStatuses(statuses, nameMatches = exactNameMatches) {
    if (hasFormulaStatus(statuses, 'Bloodline Seal', nameMatches))
        return 0;
    let rawFrac = 0;
    for (const status of statuses) {
        if (status.name === 'Increase Generals')
            rawFrac += (status.percent ?? 0) / 100;
    }
    if (rawFrac <= 0)
        return 0;
    const effFrac = rawFrac / (rawFrac + exports.K_GENERALS);
    return Math.floor(effFrac * exports.MAX_STAT);
}
function withGeneralsBonus(stats, bonus) {
    if (bonus <= 0)
        return stats;
    const out = { ...stats };
    for (const key of exports.GENERAL_STAT_FIELDS)
        out[key] = (out[key] ?? 0) + bonus;
    return out;
}
function disciplineBonusesFromStatuses(statuses, nameMatches = exactNameMatches) {
    if (hasFormulaStatus(statuses, 'Bloodline Seal', nameMatches))
        return {};
    const rawFrac = {};
    for (const status of statuses) {
        if (status.name !== 'Increase Discipline')
            continue;
        const field = exports.DISCIPLINE_OFFENSE_FIELD[status.discipline ?? ''];
        if (field)
            rawFrac[field] = (rawFrac[field] ?? 0) + (status.percent ?? 0) / 100;
    }
    const out = {};
    for (const [field, raw] of Object.entries(rawFrac)) {
        if (raw <= 0)
            continue;
        const effFrac = raw / (raw + exports.K_DISCIPLINE);
        out[field] = Math.floor(effFrac * exports.MAX_STAT * exports.DISCIPLINE_BONUS_SCALE);
    }
    return out;
}
function withDisciplineBonuses(stats, bonuses) {
    const entries = Object.entries(bonuses);
    if (!entries.length)
        return stats;
    const out = { ...stats };
    for (const [field, bonus] of entries)
        out[field] = (out[field] ?? 0) + bonus;
    return out;
}
function cappedPostDamage(damage, percent) {
    return Math.floor(Math.min(damage * (percent / 100), damage * 0.6));
}
function woundCapForJutsu(jutsu) {
    const rank = (jutsu.bloodlineRank ?? '').trim();
    if (/^S/i.test(rank))
        return exports.WOUND_CAP_BY_RANK.S;
    if (/^[AB]/i.test(rank))
        return exports.WOUND_CAP_BY_RANK.AB;
    return exports.WOUND_CAP_BY_RANK.basic;
}
function pierceTrueDamage(offenseComposite, jutsuAp, masteryLevel) {
    const apFactor = Math.max(0.5, (jutsuAp || 60) / 60);
    const masteryFactor = 1 + Math.max(0, Math.min(50, masteryLevel)) * 0.005;
    const raw = offenseComposite * 0.35 * apFactor * masteryFactor;
    return Math.floor(Math.max(100, Math.min(900, raw)));
}
function weatherMultiplier(element, positiveEl, negativeEl) {
    if (!element || (!positiveEl && !negativeEl))
        return 1;
    if (positiveEl && element === positiveEl)
        return 1.05;
    if (negativeEl && element === negativeEl)
        return 0.98;
    return 1;
}
function terrainMultiplier(jutsu, biome) {
    switch (biome) {
        case 'forest': return jutsu.type === 'Taijutsu' ? 1.1 : 1;
        case 'snow': return jutsu.type === 'Bukijutsu' ? 1.1 : 1;
        case 'volcano': return jutsu.type === 'Ninjutsu' ? 1.1 : 1;
        case 'shadow': return jutsu.type === 'Genjutsu' ? 1.1 : 1;
        default: return 1;
    }
}
function homeTerrainMultiplier(homeTerrainType, jutsu) {
    return typeof homeTerrainType === 'string' && homeTerrainType !== '' && jutsu.type === homeTerrainType ? 1.1 : 1;
}
function armorRawDrFromCharacter(character) {
    return character.armorRawDR !== undefined && character.armorRawDR !== null
        ? Math.min(1.5, Math.max(0, Number(character.armorRawDR)))
        : Math.max(0, 1 - Math.min(1.0, Math.max(0.25, Number(character.armorFactor ?? 1.0))));
}
function drContributionFromStatuses(attackerStatuses, defenderStatuses) {
    let dr = 0;
    for (const status of attackerStatuses) {
        if (status.name === 'Decrease Damage Given')
            dr += (status.percent ?? 0) / 100;
    }
    for (const status of defenderStatuses) {
        if (status.name === 'Decrease Damage Taken')
            dr += (status.percent ?? 0) / 100;
    }
    return dr;
}
function effectiveDrFromRaw(rawTotalDR) {
    return rawTotalDR > 0 ? rawTotalDR / (rawTotalDR + exports.K_DR) : 0;
}
function ampMultiplierFromStatuses(attackerStatuses, defenderStatuses, nameMatches = exactNameMatches) {
    let rawAmp = 0;
    for (const status of attackerStatuses) {
        if (status.name === 'Increase Damage Given')
            rawAmp += (status.percent ?? 0) / 100;
    }
    for (const status of defenderStatuses) {
        if (status.name === 'Increase Damage Taken')
            rawAmp += (status.percent ?? 0) / 100;
        else if (nameMatches(status.name, 'Ignition'))
            rawAmp += (status.percent ?? 0) / 100;
    }
    if (rawAmp <= 0)
        return 1;
    return 1 + rawAmp / (rawAmp + exports.K_AMP);
}
function ampTagCapForRank(rank) {
    const trimmed = (rank ?? '').trim();
    if (/^S/i.test(trimmed))
        return 40;
    if (/^[AB]/i.test(trimmed))
        return 35;
    return 30;
}
function scaledTagPercent(rawPct, masteryLevel, tagName, bloodlineRank, cappedTagNames) {
    const raw = rawPct > 0 ? rawPct : 30;
    const levelScaled = Math.max(0, raw - (50 - masteryLevel) * 0.2);
    if (tagName && cappedTagNames?.has(tagName)) {
        return Math.min(levelScaled, ampTagCapForRank(bloodlineRank));
    }
    return levelScaled;
}
function drainTick(masteryLevel) {
    return Math.max(exports.DRAIN_BASE_TICK, Math.min(exports.DRAIN_MAX_TICK, exports.DRAIN_BASE_TICK + masteryLevel * exports.DRAIN_PER_LEVEL));
}
function healAmountForMastery(masteryLevel, healBoost) {
    return Math.min(exports.HEAL_FLAT, Math.floor(exports.HEAL_FLAT * masteryDamageFrac(masteryLevel) * healBoost));
}
function shieldAmountForMastery(masteryLevel) {
    return Math.min(exports.SHIELD_FLAT, Math.floor(exports.SHIELD_FLAT * masteryDamageFrac(masteryLevel)));
}
function itemDamageMultiplier(itemDamagePct) {
    return 1 + Math.max(0, Number(itemDamagePct ?? 0)) / 100;
}
function bloodlineDamageMultiplier(bloodlineMult, isSealed) {
    return isSealed ? 1.0 : Math.max(1.0, Number(bloodlineMult ?? 1.0));
}
function guardDefenseMitigationPct(guardDefensePct) {
    return Math.min(exports.GUARD_DEFENSE_MAX_MIT, Math.max(0, Number(guardDefensePct ?? 0) / 100));
}
function dotMitigationFromRawDr(rawArmorDR, rawStatusDR) {
    const ownEffDR = effectiveDrFromRaw(Math.max(0, rawArmorDR) + Math.max(0, rawStatusDR));
    return Math.max(0, 1 - ownEffDR * exports.DR_DOT_SCALE);
}
function directDamageBaseFormula(input) {
    const { jutsu, attackerStats, defenderStats, attackerCharacter, defenderCharacter, masteryLevel, wMult = 1, biome = 'central', rawStatusDR = 0, hasBloodlineSeal = false, partyDamageScale = 1, } = input;
    const epAtMax = (jutsu.effectPower ?? 20) + exports.JUTSU_MAX_LEVEL * 0.2;
    const scaledEp = isZeroDamageFortyApJutsu(jutsu) ? 0 : Math.max(0, epAtMax * masteryDamageFrac(masteryLevel));
    const offense = getOffense(attackerStats, jutsu.type);
    const defense = getDefense(defenderStats, jutsu.type);
    const statFactor = statFactorFromComposites(offense, defense);
    const baseDmg = Math.max(0, Math.floor(scaledEp *
        exports.EP_MULTIPLIER *
        statFactor *
        wMult *
        terrainMultiplier(jutsu, biome) *
        homeTerrainMultiplier(attackerCharacter.homeTerrainType, jutsu) *
        bloodlineDamageMultiplier(attackerCharacter.bloodlineMult, hasBloodlineSeal) *
        itemDamageMultiplier(attackerCharacter.itemDamagePct) *
        Math.max(0, Number(partyDamageScale) || 0)));
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
function directDamageNumberFormula(input) {
    if (input.pierce) {
        return pierceTrueDamage(input.offenseComposite, input.jutsuAp, input.masteryLevel);
    }
    const base = Math.max(0, Math.floor(input.damageIn * (1 - input.effectiveDR) * input.ampMultiplier));
    const guardMit = guardDefenseMitigationPct(input.guardDefensePct);
    return guardMit > 0 ? Math.max(0, Math.floor(base * (1 - guardMit))) : base;
}
function healMultiplierFromStatuses(statuses, nameMatches = exactNameMatches) {
    return statuses
        .filter(status => nameMatches(status.name, 'Increase Heal'))
        .reduce((mult, status) => mult * (1 + (status.percent ?? 0) / 100), 1);
}
function clampedPercent(value) {
    return Math.max(0, Math.min(100, Number(value ?? 0)));
}
function postDamageFormula(input) {
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
function postDamagePercentAmount(finalDmg, percent, multiplier = 1) {
    return Math.floor(cappedPostDamage(finalDmg, percent || 30) * multiplier);
}
function woundAmountForFinalDamage(finalDmg, rawPercent, jutsu) {
    const effectivePct = Math.min(rawPercent || 30, woundCapForJutsu(jutsu), exports.WOUND_HARD_CAP_PCT);
    return cappedPostDamage(finalDmg, effectivePct);
}
