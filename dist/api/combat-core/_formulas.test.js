"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const formulas_js_1 = require("./formulas.js");
function close(actual, expected, epsilon = 1e-12) {
    strict_1.default.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
}
(0, node_test_1.default)('rank caps, stat caps, and mastery ramp preserve pinned combat values', () => {
    strict_1.default.equal((0, formulas_js_1.jutsuLevelCapForLevel)(1), 10);
    strict_1.default.equal((0, formulas_js_1.jutsuLevelCapForLevel)(15), 20);
    strict_1.default.equal((0, formulas_js_1.jutsuLevelCapForLevel)(30), 30);
    strict_1.default.equal((0, formulas_js_1.jutsuLevelCapForLevel)(50), 50);
    strict_1.default.equal((0, formulas_js_1.statCapForLevel)(1), 350);
    strict_1.default.equal((0, formulas_js_1.statCapForLevel)(15), 700);
    strict_1.default.equal((0, formulas_js_1.statCapForLevel)(30), 1300);
    strict_1.default.equal((0, formulas_js_1.statCapForLevel)(50), 2100);
    strict_1.default.equal((0, formulas_js_1.statCapForLevel)(80), 2500);
    strict_1.default.deepEqual((0, formulas_js_1.perRankStatCap)({ strength: 999, speed: 100, custom: 999 }, 1), {
        strength: 350,
        speed: 100,
        custom: 999,
    });
    strict_1.default.equal((0, formulas_js_1.masteryDamageFrac)(0), 0.3);
    strict_1.default.equal((0, formulas_js_1.masteryDamageFrac)(50), 1);
    strict_1.default.equal((0, formulas_js_1.isZeroDamageFortyApJutsu)({ id: 'utility', ap: 40 }), true);
    strict_1.default.equal((0, formulas_js_1.isZeroDamageFortyApJutsu)({ id: 'basic-attack', ap: 40 }), false);
    strict_1.default.equal((0, formulas_js_1.isZeroDamageFortyApJutsu)({ id: 'blast', ap: 40, isUtility: false }), false);
});
(0, node_test_1.default)('offense, defense, terrain, weather, home terrain, bloodline, and item multipliers stay pure', () => {
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
    strict_1.default.equal((0, formulas_js_1.getOffense)(stats, 'Taijutsu'), 800);
    strict_1.default.equal((0, formulas_js_1.getDefense)(stats, 'Genjutsu'), 1700);
    strict_1.default.equal((0, formulas_js_1.getOffense)(stats, 'Ninjutsu'), 1700);
    strict_1.default.equal((0, formulas_js_1.terrainMultiplier)({ type: 'Ninjutsu' }, 'volcano'), 1.1);
    strict_1.default.equal((0, formulas_js_1.terrainMultiplier)({ type: 'Ninjutsu' }, 'forest'), 1);
    strict_1.default.equal((0, formulas_js_1.weatherMultiplier)('Fire', 'Fire', 'Water'), 1.05);
    strict_1.default.equal((0, formulas_js_1.weatherMultiplier)('Water', 'Fire', 'Water'), 0.98);
    strict_1.default.equal((0, formulas_js_1.homeTerrainMultiplier)('Ninjutsu', { type: 'Ninjutsu' }), 1.1);
    strict_1.default.equal((0, formulas_js_1.homeTerrainMultiplier)('', { type: 'Ninjutsu' }), 1);
    strict_1.default.equal((0, formulas_js_1.bloodlineDamageMultiplier)(1.2, false), 1.2);
    strict_1.default.equal((0, formulas_js_1.bloodlineDamageMultiplier)(1.2, true), 1);
    strict_1.default.equal((0, formulas_js_1.itemDamageMultiplier)(25), 1.25);
});
(0, node_test_1.default)('DR, amp, armor, guard, and DoT mitigation helpers preserve the soft caps', () => {
    strict_1.default.equal((0, formulas_js_1.armorRawDrFromCharacter)({ armorRawDR: 2 }), 1.5);
    close((0, formulas_js_1.armorRawDrFromCharacter)({ armorFactor: 0.7 }), 0.30000000000000004);
    strict_1.default.equal((0, formulas_js_1.effectiveDrFromRaw)(0.5), 0.5);
    strict_1.default.equal((0, formulas_js_1.guardDefenseMitigationPct)(200), 0.5);
    close((0, formulas_js_1.dotMitigationFromRawDr)(0.5, 0.5), 2 / 3);
    strict_1.default.equal((0, formulas_js_1.drContributionFromStatuses)([{ name: 'Decrease Damage Given', percent: 20 }], [{ name: 'Decrease Damage Taken', percent: 30 }]), 0.5);
    close((0, formulas_js_1.ampMultiplierFromStatuses)([{ name: 'Increase Damage Given', percent: 35 }], [{ name: 'Increase Damage Taken', percent: 35 }, { name: 'Ignition', percent: 35 }]), 1 + 1.05 / 1.55);
    strict_1.default.equal((0, formulas_js_1.statFactorFromComposites)(2500, 2500), 1);
    strict_1.default.equal((0, formulas_js_1.statFactorFromComposites)(10000, 0), 1.85);
});
(0, node_test_1.default)('tag scaling, Pierce, Wound, Heal, Shield, Drain, and post-damage caps are pinned', () => {
    strict_1.default.equal((0, formulas_js_1.pierceTrueDamage)(3000, 60, 50), 900);
    strict_1.default.equal((0, formulas_js_1.pierceTrueDamage)(300, 40, 0), 100);
    strict_1.default.equal((0, formulas_js_1.woundCapForJutsu)({}), 25);
    strict_1.default.equal((0, formulas_js_1.woundCapForJutsu)({ bloodlineRank: 'A Rank' }), 30);
    strict_1.default.equal((0, formulas_js_1.woundCapForJutsu)({ bloodlineRank: 'S Rank' }), 35);
    strict_1.default.equal((0, formulas_js_1.cappedPostDamage)(1000, 80), 600);
    const capped = new Set(['Reflect']);
    strict_1.default.equal((0, formulas_js_1.ampTagCapForRank)('S Rank'), 40);
    strict_1.default.equal((0, formulas_js_1.scaledTagPercent)(40, 0, 'Reflect', 'S Rank', capped), 30);
    strict_1.default.equal((0, formulas_js_1.scaledTagPercent)(40, 50, 'Reflect', 'A Rank', capped), 35);
    strict_1.default.equal((0, formulas_js_1.scaledTagPercent)(20, 0, 'Poison'), 10);
    strict_1.default.equal((0, formulas_js_1.healAmountForMastery)(0, 1), 225);
    strict_1.default.equal((0, formulas_js_1.shieldAmountForMastery)(0), 225);
    strict_1.default.equal((0, formulas_js_1.healAmountForMastery)(50, 2), 750);
    strict_1.default.equal((0, formulas_js_1.healMultiplierFromStatuses)([{ name: 'Increase Heal', percent: 30 }]), 1.3);
    strict_1.default.equal((0, formulas_js_1.drainTick)(0), 50);
    strict_1.default.equal((0, formulas_js_1.drainTick)(50), 300);
});
(0, node_test_1.default)('aggregate direct-damage formulas preserve current PvP numbers', () => {
    const attackerStats = { willpower: 1000, speed: 1000, ninjutsuOffense: 500 };
    const defenderStats = { willpower: 1000, speed: 1000, ninjutsuDefense: 500 };
    const jutsu = { id: 'ninjutsu-blast', name: 'Blast', type: 'Ninjutsu', ap: 60, effectPower: 20 };
    const base = (0, formulas_js_1.directDamageBaseFormula)({
        jutsu,
        attackerStats,
        defenderStats,
        attackerCharacter: {},
        defenderCharacter: {},
        masteryLevel: 50,
    });
    strict_1.default.equal(base.baseDmg, 960);
    strict_1.default.equal(base.effectiveDR, 0);
    strict_1.default.equal(base.statFactor, 1);
    const armored = (0, formulas_js_1.directDamageBaseFormula)({
        jutsu,
        attackerStats,
        defenderStats,
        attackerCharacter: { bloodlineMult: 1.5 },
        defenderCharacter: { armorRawDR: 0.5 },
        masteryLevel: 50,
    });
    strict_1.default.equal(armored.baseDmg, 1440);
    strict_1.default.equal(armored.effectiveDR, 0.5);
    strict_1.default.equal((0, formulas_js_1.directDamageNumberFormula)({
        damageIn: armored.baseDmg,
        pierce: false,
        offenseComposite: base.offense,
        jutsuAp: 60,
        masteryLevel: 50,
        effectiveDR: armored.effectiveDR,
        ampMultiplier: 1,
        guardDefensePct: 5,
    }), 684);
    const sealed = (0, formulas_js_1.directDamageBaseFormula)({
        jutsu,
        attackerStats,
        defenderStats,
        attackerCharacter: { bloodlineMult: 1.5 },
        defenderCharacter: {},
        masteryLevel: 50,
        hasBloodlineSeal: true,
    });
    strict_1.default.equal(sealed.baseDmg, 960);
    const utility = (0, formulas_js_1.directDamageBaseFormula)({
        jutsu: { ...jutsu, id: 'utility', ap: 40 },
        attackerStats,
        defenderStats,
        attackerCharacter: {},
        defenderCharacter: {},
        masteryLevel: 50,
    });
    strict_1.default.equal(utility.baseDmg, 0);
});
(0, node_test_1.default)('aggregate post-damage formulas preserve current caps and ordering math', () => {
    strict_1.default.deepEqual((0, formulas_js_1.postDamageFormula)({
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
    strict_1.default.equal((0, formulas_js_1.postDamagePercentAmount)(1000, 80), 600);
    strict_1.default.equal((0, formulas_js_1.postDamagePercentAmount)(1000, 80, 2), 1200);
    strict_1.default.equal((0, formulas_js_1.woundAmountForFinalDamage)(1000, 50, { bloodlineRank: 'A Rank' }), 300);
    strict_1.default.equal((0, formulas_js_1.woundAmountForFinalDamage)(1000, undefined, {}), 250);
});
(0, node_test_1.default)('Generals and Discipline status bonuses stay pooled and Seal-gated', () => {
    strict_1.default.equal((0, formulas_js_1.generalsBonusFromStatuses)([{ name: 'Increase Generals', percent: 30 }]), 937);
    strict_1.default.deepEqual((0, formulas_js_1.withGeneralsBonus)({ strength: 10, speed: 20 }, 5), {
        strength: 15,
        speed: 25,
        intelligence: 5,
        willpower: 5,
    });
    strict_1.default.equal((0, formulas_js_1.generalsBonusFromStatuses)([
        { name: 'Seal' },
        { name: 'Increase Generals', percent: 30 },
    ], (actual, expected) => actual === expected || (actual === 'Seal' && expected === 'Bloodline Seal')), 0);
    const bonuses = (0, formulas_js_1.disciplineBonusesFromStatuses)([{ name: 'Increase Discipline', percent: 30, discipline: 'Ninjutsu' }]);
    strict_1.default.deepEqual(bonuses, { ninjutsuOffense: 1874 });
    strict_1.default.deepEqual((0, formulas_js_1.withDisciplineBonuses)({ ninjutsuOffense: 10 }, bonuses), { ninjutsuOffense: 1884 });
});
