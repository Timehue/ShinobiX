"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _jutsu_points_js_1 = require("./_jutsu-points.js");
(0, node_test_1.describe)('_jutsu-points — point math', () => {
    (0, node_test_1.it)('pointBudgetForRank: S 11 / A 10 / B 7 / none 7', () => {
        node_assert_1.strict.equal((0, _jutsu_points_js_1.pointBudgetForRank)('S Rank'), 11);
        node_assert_1.strict.equal((0, _jutsu_points_js_1.pointBudgetForRank)('A Rank'), 10);
        node_assert_1.strict.equal((0, _jutsu_points_js_1.pointBudgetForRank)('B Rank'), 7);
        node_assert_1.strict.equal((0, _jutsu_points_js_1.pointBudgetForRank)(null), 7);
        node_assert_1.strict.equal((0, _jutsu_points_js_1.pointBudgetForRank)(undefined), 7);
    });
    (0, node_test_1.it)('tagPointValue: control + capped-amp + Wound tiers', () => {
        node_assert_1.strict.equal((0, _jutsu_points_js_1.tagPointValue)({ name: 'Copy' }, 'A Rank'), 3);
        node_assert_1.strict.equal((0, _jutsu_points_js_1.tagPointValue)({ name: 'Mirror' }, 'A Rank'), 3);
        node_assert_1.strict.equal((0, _jutsu_points_js_1.tagPointValue)({ name: 'Stun' }, 'A Rank'), 2);
        node_assert_1.strict.equal((0, _jutsu_points_js_1.tagPointValue)({ name: 'Bloodline Seal' }, 'A Rank'), 2);
        // capped amp: at/above the rank cap costs more than below it
        node_assert_1.strict.equal((0, _jutsu_points_js_1.tagPointValue)({ name: 'Increase Damage Given', percent: 35 }, 'A Rank'), 0.75);
        node_assert_1.strict.equal((0, _jutsu_points_js_1.tagPointValue)({ name: 'Increase Damage Given', percent: 30 }, 'A Rank'), 0.25);
        node_assert_1.strict.equal((0, _jutsu_points_js_1.tagPointValue)({ name: 'Increase Damage Given', percent: 40 }, 'S Rank'), 0.75);
        node_assert_1.strict.equal((0, _jutsu_points_js_1.tagPointValue)({ name: 'Increase Damage Given', percent: 35 }, 'S Rank'), 0.25);
        // Wound tiers
        node_assert_1.strict.equal((0, _jutsu_points_js_1.tagPointValue)({ name: 'Wound', percent: 35 }, 'S Rank'), 1);
        node_assert_1.strict.equal((0, _jutsu_points_js_1.tagPointValue)({ name: 'Wound', percent: 30 }, 'A Rank'), 0.5);
        node_assert_1.strict.equal((0, _jutsu_points_js_1.tagPointValue)({ name: 'Wound', percent: 25 }, 'B Rank'), 0.25);
    });
    (0, node_test_1.it)('canonicalizes aliases (Seal -> Bloodline Seal = 2)', () => {
        node_assert_1.strict.equal((0, _jutsu_points_js_1.tagPointValue)({ name: 'Seal' }, 'A Rank'), 2);
    });
    (0, node_test_1.it)('jutsuPoints adds structural costs (40-AP utility, nuke, low cooldown)', () => {
        // 40-AP utility (+1) with one capped amp below cap (0.25), cooldown 7 (no +0.5)
        node_assert_1.strict.equal((0, _jutsu_points_js_1.jutsuPoints)({ ap: 40, range: 4, effectPower: 0, cooldown: 7, tags: [{ name: 'Increase Damage Given', percent: 30 }] }, 'A Rank'), 1.25);
        // 60-AP nuke (effectPower 50 → +1), cooldown 1 (+0.5), no tags
        node_assert_1.strict.equal((0, _jutsu_points_js_1.jutsuPoints)({ ap: 60, range: 4, effectPower: 50, cooldown: 1, tags: [] }, 'A Rank'), 1.5);
        // fixed-effect (Stun) jutsu does NOT get the nuke point even at EP 50
        node_assert_1.strict.equal((0, _jutsu_points_js_1.jutsuPoints)({ ap: 60, range: 4, effectPower: 50, cooldown: 7, tags: [{ name: 'Stun' }] }, 'A Rank'), 2);
    });
    (0, node_test_1.it)('honest within-budget bloodline is unchanged (deep-equal, no-op)', () => {
        const jutsus = [
            { ap: 60, range: 4, effectPower: 36, cooldown: 7, tags: [{ name: 'Wound', percent: 30 }] },
            { ap: 60, range: 4, effectPower: 36, cooldown: 7, tags: [{ name: 'Poison' }] },
        ];
        node_assert_1.strict.ok((0, _jutsu_points_js_1.bloodlinePoints)(jutsus, 'B Rank') <= (0, _jutsu_points_js_1.pointBudgetForRank)('B Rank'));
        node_assert_1.strict.deepEqual((0, _jutsu_points_js_1.enforceBloodlineBudget)(jutsus, 'B Rank'), jutsus);
    });
    (0, node_test_1.it)('RED-TEAM: forged over-budget bloodline is clamped down (never rejected, jutsu never dropped)', () => {
        // 5 jutsu × {Copy 3, Mirror 3, Stun 2} = 40 pts vs B-rank budget 7.
        const jutsus = Array.from({ length: 5 }, () => ({
            ap: 60, range: 4, effectPower: 36, cooldown: 7,
            tags: [{ name: 'Copy' }, { name: 'Mirror' }, { name: 'Stun' }],
        }));
        const out = (0, _jutsu_points_js_1.enforceBloodlineBudget)(jutsus, 'B Rank');
        node_assert_1.strict.equal(out.length, 5, 'jutsu are never dropped — only tags are stripped');
        node_assert_1.strict.ok((0, _jutsu_points_js_1.bloodlinePoints)(out, 'B Rank') <= (0, _jutsu_points_js_1.pointBudgetForRank)('B Rank'), 'clamped within budget');
    });
    (0, node_test_1.it)('strip is deterministic (same input → same output)', () => {
        const mk = () => Array.from({ length: 5 }, () => ({
            ap: 60, range: 4, effectPower: 36, cooldown: 7,
            tags: [{ name: 'Copy' }, { name: 'Stun' }, { name: 'Wound', percent: 35 }],
        }));
        node_assert_1.strict.deepEqual((0, _jutsu_points_js_1.enforceBloodlineBudget)(mk(), 'A Rank'), (0, _jutsu_points_js_1.enforceBloodlineBudget)(mk(), 'A Rank'));
    });
    (0, node_test_1.it)('does not mutate the input', () => {
        const jutsus = [{ ap: 60, range: 4, effectPower: 36, cooldown: 7, tags: [{ name: 'Copy' }, { name: 'Mirror' }, { name: 'Stun' }] }];
        const before = JSON.stringify(jutsus);
        (0, _jutsu_points_js_1.enforceBloodlineBudget)(jutsus, 'B Rank');
        node_assert_1.strict.equal(JSON.stringify(jutsus), before);
    });
    (0, node_test_1.it)('empty / non-array input is a no-op', () => {
        node_assert_1.strict.deepEqual((0, _jutsu_points_js_1.enforceBloodlineBudget)([], 'A Rank'), []);
        node_assert_1.strict.equal((0, _jutsu_points_js_1.enforceBloodlineBudget)(undefined, 'A Rank'), undefined);
    });
});
