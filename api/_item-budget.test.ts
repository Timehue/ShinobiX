import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { budgetItemBonuses } from './_item-budget.js';
import { sanitizeCharacterSave } from './save/[name].js';
import { buildItemLookup } from './pvp/_multipliers.js';

describe('_item-budget — budgetItemBonuses (P0.1 sub-5)', () => {
    it('a built-in-baseline custom item is unchanged (no clip)', () => {
        // legendary armor shape: 8 specialty @30 (= 240, under the 280 Named Armor budget) + 1% passive
        const item = {
            id: 'c1', slot: 'body', bonuses: {
                ninjutsuOffense: 30, taijutsuOffense: 30, genjutsuOffense: 30, bukijutsuOffense: 30,
                ninjutsuDefense: 30, taijutsuDefense: 30, genjutsuDefense: 30, bukijutsuDefense: 30,
                reflectPercent: 1,
            },
        };
        assert.deepEqual(budgetItemBonuses(item).bonuses, item.bonuses);
    });

    it('clamps forged passive %s to the legitimate Named Armor 2% ceiling', () => {
        const out = budgetItemBonuses({ id: 'c2', slot: 'body', bonuses: { lifeStealPercent: 100, reflectPercent: 50 } });
        const b = out.bonuses as Record<string, number>;
        assert.equal(b.lifeStealPercent, 2);
        assert.equal(b.reflectPercent, 2);
    });

    it('clamps forged shield and vitals to 150', () => {
        const out = budgetItemBonuses({ id: 'c3', slot: 'aura', bonuses: { shield: 99999, maxChakra: 99999, maxHp: 5000 } });
        const b = out.bonuses as Record<string, number>;
        assert.equal(b.shield, 150);
        assert.equal(b.maxChakra, 150);
        assert.equal(b.maxHp, 150);
    });

    it('scales an over-budget specialty total down to the slot budget (armor 280)', () => {
        const out = budgetItemBonuses({ id: 'c4', slot: 'body', bonuses: { ninjutsuOffense: 1000, taijutsuOffense: 1000 } });
        const b = out.bonuses as Record<string, number>;
        assert.ok(b.ninjutsuOffense + b.taijutsuOffense <= 280, 'specialty total within the armor budget');
        assert.ok(b.ninjutsuOffense > 0 && b.taijutsuOffense > 0, 'scaled proportionally, not zeroed');
    });

    it('the hand slot gets the larger 420 budget (gloves baseline not clipped)', () => {
        const item = {
            id: 'c5', slot: 'hand', bonuses: {
                ninjutsuOffense: 75, taijutsuOffense: 75, genjutsuOffense: 75, bukijutsuOffense: 75,
                ninjutsuDefense: 30, taijutsuDefense: 30, genjutsuDefense: 30, bukijutsuDefense: 30,
            },
        };
        assert.deepEqual(budgetItemBonuses(item).bonuses, item.bonuses); // 420 == budget → unchanged
    });

    it('a maximum legitimate Named Armor roll is unchanged', () => {
        const bonuses = {
            ninjutsuOffense: 35, taijutsuOffense: 35, genjutsuOffense: 35, bukijutsuOffense: 35,
            ninjutsuDefense: 35, taijutsuDefense: 35, genjutsuDefense: 35, bukijutsuDefense: 35,
            reflectPercent: 2,
        };
        assert.deepEqual(budgetItemBonuses({ id: 'named', slot: 'body', bonuses }).bonuses, bonuses);
    });

    it('no-op for an item without object bonuses', () => {
        const item = { id: 'c6', slot: 'body' };
        assert.equal(budgetItemBonuses(item), item);
    });

    it('does not mutate the input', () => {
        const item = { id: 'c7', slot: 'body', bonuses: { lifeStealPercent: 100, ninjutsuOffense: 1000 } };
        const before = JSON.stringify(item);
        budgetItemBonuses(item);
        assert.equal(JSON.stringify(item), before);
    });

    it('is always applied when creator items are persisted', () => {
        const saved = sanitizeCharacterSave(
            {
                character: { name: 'Audit' },
                creatorItems: [{ id: 'forged', slot: 'body', bonuses: { lifeStealPercent: 100, shield: 99_999, ninjutsuOffense: 1000 } }],
            },
            { character: { name: 'Audit' }, creatorItems: [] },
            { adminContentSlot: true },
        ) as Record<string, any>;
        assert.deepEqual(saved.creatorItems[0].bonuses, { lifeStealPercent: 2, shield: 150, ninjutsuOffense: 280 });
    });

    it('is always re-applied when a pre-existing creator item enters combat', () => {
        const getItem = buildItemLookup([
            { id: 'forged', slot: 'body', bonuses: { reflectPercent: 50, shield: 5000 } },
        ]);
        assert.deepEqual((getItem('forged') as Record<string, unknown>).bonuses, { reflectPercent: 2, shield: 150 });
    });
});
