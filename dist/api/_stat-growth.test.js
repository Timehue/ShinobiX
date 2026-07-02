"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _stat_growth_js_1 = require("./_stat-growth.js");
// Pins combat-use stat growth (Stage 4). See docs/leveling-training-redesign-plan.md.
const baseStats = () => Object.fromEntries(_stat_growth_js_1.STAT_GROWTH_KEYS.map((k) => [k, 10]));
const usedTotal = (a) => Object.values(a).reduce((s, n) => s + (n ?? 0), 0);
(0, node_test_1.describe)('statCapForLevel — mirrors the canonical per-rank cap table', () => {
    (0, node_test_1.it)('bands match 350/700/1300/2100/2500', () => {
        for (const [lvl, cap] of [[1, 350], [14, 350], [15, 700], [29, 700], [30, 1300], [49, 1300], [50, 2100], [79, 2100], [80, 2500], [100, 2500]]) {
            node_assert_1.strict.equal((0, _stat_growth_js_1.statCapForLevel)(lvl), cap, `L${lvl}`);
        }
    });
});
(0, node_test_1.describe)('computeCombatStatGrowth', () => {
    (0, node_test_1.it)('splits ~60/40 used/pool and spends exactly `earned`', () => {
        const g = (0, _stat_growth_js_1.computeCombatStatGrowth)(baseStats(), 100, 8, 999);
        node_assert_1.strict.equal(g.spent, 8, 'spent = earned');
        node_assert_1.strict.equal(usedTotal(g.allocated), Math.round(8 * _stat_growth_js_1.COMBAT_USED_STAT_RATIO), 'used share = round(earned·0.6)');
        node_assert_1.strict.equal(g.unspentGain, 8 - usedTotal(g.allocated), 'pool = remainder');
    });
    (0, node_test_1.it)('is bounded by the remaining daily budget', () => {
        node_assert_1.strict.deepEqual((0, _stat_growth_js_1.computeCombatStatGrowth)(baseStats(), 100, 8, 0), { allocated: {}, unspentGain: 0, spent: 0 }, '0 budget → nothing');
        node_assert_1.strict.equal((0, _stat_growth_js_1.computeCombatStatGrowth)(baseStats(), 100, 8, 3).spent, 3, 'clamped to remaining');
    });
    (0, node_test_1.it)('spreads across the invested stats ("how you fight"), not just the top one', () => {
        const stats = { ...baseStats(), strength: 500, speed: 300 };
        const g = (0, _stat_growth_js_1.computeCombatStatGrowth)(stats, 100, 10, 999); // usedShare = round(10·0.6)=6
        node_assert_1.strict.equal(usedTotal(g.allocated), 6);
        node_assert_1.strict.deepEqual(Object.keys(g.allocated).sort(), ['speed', 'strength'], 'only invested stats grow');
        node_assert_1.strict.equal(g.allocated.strength, 3);
        node_assert_1.strict.equal(g.allocated.speed, 3);
    });
    (0, node_test_1.it)('rolls used-points into the pool when every stat is at its rank cap', () => {
        const capped = Object.fromEntries(_stat_growth_js_1.STAT_GROWTH_KEYS.map((k) => [k, 350]));
        const g = (0, _stat_growth_js_1.computeCombatStatGrowth)(capped, 1, 10, 999); // level 1 → cap 350, all at cap
        node_assert_1.strict.deepEqual(g.allocated, {}, 'no stat can grow');
        node_assert_1.strict.equal(g.unspentGain, 10, 'all rolls to the pool');
        node_assert_1.strict.equal(g.spent, 10, 'still counts against the daily budget');
    });
    (0, node_test_1.it)('never grows a stat past its per-rank cap', () => {
        const stats = { ...baseStats(), strength: 349 }; // 1 below Academy cap 350
        const g = (0, _stat_growth_js_1.computeCombatStatGrowth)(stats, 1, 10, 999);
        node_assert_1.strict.ok((g.allocated.strength ?? 0) <= 1, 'strength grows at most to the cap');
    });
    (0, node_test_1.it)('daily cap constant is 60', () => {
        node_assert_1.strict.equal(_stat_growth_js_1.DAILY_COMBAT_STAT_CAP, 60);
    });
});
