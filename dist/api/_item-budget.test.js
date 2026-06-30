"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _item_budget_js_1 = require("./_item-budget.js");
(0, node_test_1.describe)('_item-budget — budgetItemBonuses (P0.1 sub-5)', () => {
    (0, node_test_1.it)('a built-in-baseline custom item is unchanged (no clip)', () => {
        // legendary armor shape: 8 specialty @30 (= 240, the armor budget) + 1% passive
        const item = {
            id: 'c1', slot: 'body', bonuses: {
                ninjutsuOffense: 30, taijutsuOffense: 30, genjutsuOffense: 30, bukijutsuOffense: 30,
                ninjutsuDefense: 30, taijutsuDefense: 30, genjutsuDefense: 30, bukijutsuDefense: 30,
                reflectPercent: 1,
            },
        };
        node_assert_1.strict.deepEqual((0, _item_budget_js_1.budgetItemBonuses)(item).bonuses, item.bonuses);
    });
    (0, node_test_1.it)('clamps forged passive %s to the 1% baseline', () => {
        const out = (0, _item_budget_js_1.budgetItemBonuses)({ id: 'c2', slot: 'body', bonuses: { lifeStealPercent: 100, reflectPercent: 50 } });
        const b = out.bonuses;
        node_assert_1.strict.equal(b.lifeStealPercent, 1);
        node_assert_1.strict.equal(b.reflectPercent, 1);
    });
    (0, node_test_1.it)('clamps forged shield to 100 and vitals to 150', () => {
        const out = (0, _item_budget_js_1.budgetItemBonuses)({ id: 'c3', slot: 'aura', bonuses: { shield: 99999, maxChakra: 99999, maxHp: 5000 } });
        const b = out.bonuses;
        node_assert_1.strict.equal(b.shield, 100);
        node_assert_1.strict.equal(b.maxChakra, 150);
        node_assert_1.strict.equal(b.maxHp, 150);
    });
    (0, node_test_1.it)('scales an over-budget specialty total down to the slot budget (armor 240)', () => {
        const out = (0, _item_budget_js_1.budgetItemBonuses)({ id: 'c4', slot: 'body', bonuses: { ninjutsuOffense: 1000, taijutsuOffense: 1000 } });
        const b = out.bonuses;
        node_assert_1.strict.ok(b.ninjutsuOffense + b.taijutsuOffense <= 240, 'specialty total within the armor budget');
        node_assert_1.strict.ok(b.ninjutsuOffense > 0 && b.taijutsuOffense > 0, 'scaled proportionally, not zeroed');
    });
    (0, node_test_1.it)('the hand slot gets the larger 420 budget (gloves baseline not clipped)', () => {
        const item = {
            id: 'c5', slot: 'hand', bonuses: {
                ninjutsuOffense: 75, taijutsuOffense: 75, genjutsuOffense: 75, bukijutsuOffense: 75,
                ninjutsuDefense: 30, taijutsuDefense: 30, genjutsuDefense: 30, bukijutsuDefense: 30,
            },
        };
        node_assert_1.strict.deepEqual((0, _item_budget_js_1.budgetItemBonuses)(item).bonuses, item.bonuses); // 420 == budget → unchanged
    });
    (0, node_test_1.it)('no-op for an item without object bonuses', () => {
        const item = { id: 'c6', slot: 'body' };
        node_assert_1.strict.equal((0, _item_budget_js_1.budgetItemBonuses)(item), item);
    });
    (0, node_test_1.it)('does not mutate the input', () => {
        const item = { id: 'c7', slot: 'body', bonuses: { lifeStealPercent: 100, ninjutsuOffense: 1000 } };
        const before = JSON.stringify(item);
        (0, _item_budget_js_1.budgetItemBonuses)(item);
        node_assert_1.strict.equal(JSON.stringify(item), before);
    });
});
