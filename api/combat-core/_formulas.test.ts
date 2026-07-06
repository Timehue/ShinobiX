import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ampMultiplierFromStatuses,
    ampTagCapForRank,
    armorRawDrFromCharacter,
    bloodlineDamageMultiplier,
    cappedPostDamage,
    dotMitigationFromRawDr,
    drainTick,
    drContributionFromStatuses,
    effectiveDrFromRaw,
    directDamageBaseFormula,
    directDamageNumberFormula,
    generalsBonusFromStatuses,
    getDefense,
    getOffense,
    guardDefenseMitigationPct,
    healAmountForMastery,
    healMultiplierFromStatuses,
    homeTerrainMultiplier,
    isZeroDamageFortyApJutsu,
    itemDamageMultiplier,
    jutsuLevelCapForLevel,
    masteryDamageFrac,
    perRankStatCap,
    pierceTrueDamage,
    postDamageFormula,
    postDamagePercentAmount,
    scaledTagPercent,
    shieldAmountForMastery,
    statFactorFromComposites,
    statCapForLevel,
    terrainMultiplier,
    weatherMultiplier,
    withDisciplineBonuses,
    withGeneralsBonus,
    woundAmountForFinalDamage,
    woundCapForJutsu,
    disciplineBonusesFromStatuses,
} from './formulas.js';

function close(actual: number, expected: number, epsilon = 1e-12): void {
    assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
}

test('rank caps, stat caps, and mastery ramp preserve pinned combat values', () => {
    assert.equal(jutsuLevelCapForLevel(1), 10);
    assert.equal(jutsuLevelCapForLevel(15), 20);
    assert.equal(jutsuLevelCapForLevel(30), 30);
    assert.equal(jutsuLevelCapForLevel(50), 50);

    assert.equal(statCapForLevel(1), 350);
    assert.equal(statCapForLevel(15), 700);
    assert.equal(statCapForLevel(30), 1300);
    assert.equal(statCapForLevel(50), 2100);
    assert.equal(statCapForLevel(80), 2500);
    assert.deepEqual(perRankStatCap({ strength: 999, speed: 100, custom: 999 }, 1), {
        strength: 350,
        speed: 100,
        custom: 999,
    });

    assert.equal(masteryDamageFrac(0), 0.3);
    assert.equal(masteryDamageFrac(50), 1);
    assert.equal(isZeroDamageFortyApJutsu({ id: 'utility', ap: 40 }), true);
    assert.equal(isZeroDamageFortyApJutsu({ id: 'basic-attack', ap: 40 }), false);
    assert.equal(isZeroDamageFortyApJutsu({ id: 'blast', ap: 40, isUtility: false }), false);
});

test('offense, defense, terrain, weather, home terrain, bloodline, and item multipliers stay pure', () => {
    const stats = {
        strength: 100,
        speed: 200,
        intelligence: 300,
        willpower: 400,
        taijutsuOffense: 500,
        taijutsuDefense: 600,
        bukijutsuOffense: 700,
        bukijutsuDefense: 800,
        genjutsuOffense: 900,
        genjutsuDefense: 1000,
        ninjutsuOffense: 1100,
        ninjutsuDefense: 1200,
    };
    assert.equal(getOffense(stats, 'Taijutsu'), 800);
    assert.equal(getDefense(stats, 'Genjutsu'), 1700);
    assert.equal(getOffense(stats, 'Ninjutsu'), 1700);

    assert.equal(terrainMultiplier({ type: 'Ninjutsu' }, 'volcano'), 1.1);
    assert.equal(terrainMultiplier({ type: 'Ninjutsu' }, 'forest'), 1);
    assert.equal(weatherMultiplier('Fire', 'Fire', 'Water'), 1.05);
    assert.equal(weatherMultiplier('Water', 'Fire', 'Water'), 0.98);
    assert.equal(homeTerrainMultiplier('Ninjutsu', { type: 'Ninjutsu' }), 1.1);
    assert.equal(homeTerrainMultiplier('', { type: 'Ninjutsu' }), 1);
    assert.equal(bloodlineDamageMultiplier(1.2, false), 1.2);
    assert.equal(bloodlineDamageMultiplier(1.2, true), 1);
    assert.equal(itemDamageMultiplier(25), 1.25);
});

test('DR, amp, armor, guard, and DoT mitigation helpers preserve the soft caps', () => {
    assert.equal(armorRawDrFromCharacter({ armorRawDR: 2 }), 1.5);
    close(armorRawDrFromCharacter({ armorFactor: 0.7 }), 0.30000000000000004);
    assert.equal(effectiveDrFromRaw(0.5), 0.5);
    assert.equal(guardDefenseMitigationPct(200), 0.5);
    close(dotMitigationFromRawDr(0.5, 0.5), 2 / 3);

    assert.equal(drContributionFromStatuses(
        [{ name: 'Decrease Damage Given', percent: 20 }],
        [{ name: 'Decrease Damage Taken', percent: 30 }],
    ), 0.5);
    close(ampMultiplierFromStatuses(
        [{ name: 'Increase Damage Given', percent: 35 }],
        [{ name: 'Increase Damage Taken', percent: 35 }, { name: 'Ignition', percent: 35 }],
    ), 1 + 1.05 / 1.55);
    assert.equal(statFactorFromComposites(2500, 2500), 1);
    assert.equal(statFactorFromComposites(10000, 0), 1.85);
});

test('tag scaling, Pierce, Wound, Heal, Shield, Drain, and post-damage caps are pinned', () => {
    assert.equal(pierceTrueDamage(3000, 60, 50), 900);
    assert.equal(pierceTrueDamage(300, 40, 0), 100);

    assert.equal(woundCapForJutsu({}), 25);
    assert.equal(woundCapForJutsu({ bloodlineRank: 'A Rank' }), 30);
    assert.equal(woundCapForJutsu({ bloodlineRank: 'S Rank' }), 35);
    assert.equal(cappedPostDamage(1000, 80), 600);

    const capped = new Set(['Reflect']);
    assert.equal(ampTagCapForRank('S Rank'), 40);
    assert.equal(scaledTagPercent(40, 0, 'Reflect', 'S Rank', capped), 30);
    assert.equal(scaledTagPercent(40, 50, 'Reflect', 'A Rank', capped), 35);
    assert.equal(scaledTagPercent(20, 0, 'Poison'), 10);

    assert.equal(healAmountForMastery(0, 1), 225);
    assert.equal(shieldAmountForMastery(0), 225);
    assert.equal(healAmountForMastery(50, 2), 750);
    assert.equal(healMultiplierFromStatuses([{ name: 'Increase Heal', percent: 30 }]), 1.3);
    assert.equal(drainTick(0), 50);
    assert.equal(drainTick(50), 300);
});

test('aggregate direct-damage formulas preserve current PvP numbers', () => {
    const attackerStats = { willpower: 1000, speed: 1000, ninjutsuOffense: 500 };
    const defenderStats = { willpower: 1000, speed: 1000, ninjutsuDefense: 500 };
    const jutsu = { id: 'ninjutsu-blast', name: 'Blast', type: 'Ninjutsu', ap: 60, effectPower: 20 };
    const base = directDamageBaseFormula({
        jutsu,
        attackerStats,
        defenderStats,
        attackerCharacter: {},
        defenderCharacter: {},
        masteryLevel: 50,
    });
    assert.equal(base.baseDmg, 960);
    assert.equal(base.effectiveDR, 0);
    assert.equal(base.statFactor, 1);

    const armored = directDamageBaseFormula({
        jutsu,
        attackerStats,
        defenderStats,
        attackerCharacter: { bloodlineMult: 1.5 },
        defenderCharacter: { armorRawDR: 0.5 },
        masteryLevel: 50,
    });
    assert.equal(armored.baseDmg, 1440);
    assert.equal(armored.effectiveDR, 0.5);
    assert.equal(directDamageNumberFormula({
        damageIn: armored.baseDmg,
        pierce: false,
        offenseComposite: base.offense,
        jutsuAp: 60,
        masteryLevel: 50,
        effectiveDR: armored.effectiveDR,
        ampMultiplier: 1,
        guardDefensePct: 5,
    }), 684);

    const sealed = directDamageBaseFormula({
        jutsu,
        attackerStats,
        defenderStats,
        attackerCharacter: { bloodlineMult: 1.5 },
        defenderCharacter: {},
        masteryLevel: 50,
        hasBloodlineSeal: true,
    });
    assert.equal(sealed.baseDmg, 960);

    const utility = directDamageBaseFormula({
        jutsu: { ...jutsu, id: 'utility', ap: 40 },
        attackerStats,
        defenderStats,
        attackerCharacter: {},
        defenderCharacter: {},
        masteryLevel: 50,
    });
    assert.equal(utility.baseDmg, 0);
});

test('aggregate post-damage formulas preserve current caps and ordering math', () => {
    assert.deepEqual(postDamageFormula({
        damage: 1000,
        shield: 250,
        pierce: false,
        reflectPct: 30,
        absorbPct: 20,
        itemAbsorbPct: 10,
        itemReflectPct: 5,
        itemLifeStealPct: 15,
    }), {
        blocked: 250,
        finalDmg: 750,
        reflectedDmg: 225,
        absorbHeal: 150,
        itemAbsorbHeal: 75,
        itemReflectedDmg: 37,
        itemLifeStealHeal: 112,
    });
    assert.equal(postDamagePercentAmount(1000, 80), 600);
    assert.equal(postDamagePercentAmount(1000, 80, 2), 1200);
    assert.equal(woundAmountForFinalDamage(1000, 50, { bloodlineRank: 'A Rank' }), 300);
    assert.equal(woundAmountForFinalDamage(1000, undefined, {}), 250);
});

test('Generals and Discipline status bonuses stay pooled and Seal-gated', () => {
    assert.equal(generalsBonusFromStatuses([{ name: 'Increase Generals', percent: 30 }]), 937);
    assert.deepEqual(withGeneralsBonus({ strength: 10, speed: 20 }, 5), {
        strength: 15,
        speed: 25,
        intelligence: 5,
        willpower: 5,
    });
    assert.equal(generalsBonusFromStatuses([
        { name: 'Seal' },
        { name: 'Increase Generals', percent: 30 },
    ], (actual, expected) => actual === expected || (actual === 'Seal' && expected === 'Bloodline Seal')), 0);

    const bonuses = disciplineBonusesFromStatuses([{ name: 'Increase Discipline', percent: 30, discipline: 'Ninjutsu' }]);
    assert.deepEqual(bonuses, { ninjutsuOffense: 1874 });
    assert.deepEqual(withDisciplineBonuses({ ninjutsuOffense: 10 }, bonuses), { ninjutsuOffense: 1884 });
});
