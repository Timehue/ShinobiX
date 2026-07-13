"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _item_budget_js_1 = require("./_item-budget.js");
const _name__js_1 = require("./save/[name].js");
const _multipliers_js_1 = require("./pvp/_multipliers.js");
(0, node_test_1.describe)('_item-budget — budgetItemBonuses (P0.1 sub-5)', () => {
    (0, node_test_1.it)('a built-in-baseline custom item is unchanged (no clip)', () => {
        // legendary armor shape: 8 specialty @30 (= 240, under the 280 Named Armor budget) + 1% passive
        const item = {
            id: 'c1', slot: 'body', bonuses: {
                ninjutsuOffense: 30, taijutsuOffense: 30, genjutsuOffense: 30, bukijutsuOffense: 30,
                ninjutsuDefense: 30, taijutsuDefense: 30, genjutsuDefense: 30, bukijutsuDefense: 30,
                reflectPercent: 1,
            },
        };
        node_assert_1.strict.deepEqual((0, _item_budget_js_1.budgetItemBonuses)(item).bonuses, item.bonuses);
    });
    (0, node_test_1.it)('clamps forged passive %s to the legitimate Named Armor 2% ceiling', () => {
        const out = (0, _item_budget_js_1.budgetItemBonuses)({ id: 'c2', slot: 'body', bonuses: { lifeStealPercent: 100, reflectPercent: 50 } });
        const b = out.bonuses;
        node_assert_1.strict.equal(b.lifeStealPercent, 2);
        node_assert_1.strict.equal(b.reflectPercent, 2);
    });
    (0, node_test_1.it)('clamps forged shield and vitals to 150', () => {
        const out = (0, _item_budget_js_1.budgetItemBonuses)({ id: 'c3', slot: 'aura', bonuses: { shield: 99999, maxChakra: 99999, maxHp: 5000 } });
        const b = out.bonuses;
        node_assert_1.strict.equal(b.shield, 150);
        node_assert_1.strict.equal(b.maxChakra, 150);
        node_assert_1.strict.equal(b.maxHp, 150);
    });
    (0, node_test_1.it)('scales an over-budget specialty total down to the slot budget (armor 280)', () => {
        const out = (0, _item_budget_js_1.budgetItemBonuses)({ id: 'c4', slot: 'body', bonuses: { ninjutsuOffense: 1000, taijutsuOffense: 1000 } });
        const b = out.bonuses;
        node_assert_1.strict.ok(b.ninjutsuOffense + b.taijutsuOffense <= 280, 'specialty total within the armor budget');
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
    (0, node_test_1.it)('a maximum legitimate Named Armor roll is unchanged', () => {
        const bonuses = {
            ninjutsuOffense: 35, taijutsuOffense: 35, genjutsuOffense: 35, bukijutsuOffense: 35,
            ninjutsuDefense: 35, taijutsuDefense: 35, genjutsuDefense: 35, bukijutsuDefense: 35,
            reflectPercent: 2,
        };
        node_assert_1.strict.deepEqual((0, _item_budget_js_1.budgetItemBonuses)({ id: 'named', slot: 'body', bonuses }).bonuses, bonuses);
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
    (0, node_test_1.it)('is always applied when creator items are persisted', () => {
        const saved = (0, _name__js_1.sanitizeCharacterSave)({
            character: { name: 'Audit' },
            creatorItems: [{ id: 'forged', slot: 'body', bonuses: { lifeStealPercent: 100, shield: 99_999, ninjutsuOffense: 1000 } }],
        }, { character: { name: 'Audit' }, creatorItems: [] });
        node_assert_1.strict.deepEqual(saved.creatorItems[0].bonuses, { lifeStealPercent: 2, shield: 150, ninjutsuOffense: 280 });
    });
    (0, node_test_1.it)('is always re-applied when a pre-existing creator item enters combat', () => {
        const getItem = (0, _multipliers_js_1.buildItemLookup)([
            { id: 'forged', slot: 'body', bonuses: { reflectPercent: 50, shield: 5000 } },
        ]);
        node_assert_1.strict.deepEqual(getItem('forged').bonuses, { reflectPercent: 2, shield: 150 });
    });
});
