import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { budgetItemBonuses } from './_item-budget.js';
import { sanitizeCharacterSave } from './save/[name].js';
import { buildItemLookup } from './pvp/_multipliers.js';
import { buildNamedItem } from './craft/_named.js';
import { hydrateCharacterFromSave } from './pvp/session.js';
import { sealTowerFighter } from './towers/_seal.js';
import { NAMED_WEAPON_OFFENSE } from '../shared/named-forge-roll.js';

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

    it('every legitimate named weapon offense roll survives budgeting, saving, and shared combat hydration', () => {
        const fields = ['ninjutsuOffense', 'taijutsuOffense', 'genjutsuOffense', 'bukijutsuOffense'];
        const previous = process.env.STRICT_RAW_SAVE_LEDGER;
        process.env.STRICT_RAW_SAVE_LEDGER = '0';
        try {
            for (let offenseVal = NAMED_WEAPON_OFFENSE.min; offenseVal <= NAMED_WEAPON_OFFENSE.max; offenseVal++) {
                const item = buildNamedItem({ kind: 'weapon', ep: 26, range: 4, offenseVal,
                    tags: [{ name: 'Siphon', percent: 19 }, { name: 'Poison', percent: 12 }] }, 'Budget Blade', '');
                assert.deepEqual(budgetItemBonuses(item).bonuses, item.bonuses);
                const character = { name: 'BudgetProbe', level: 100, specialty: 'Ninjutsu', inventory: [item.id],
                    equipment: { hand: item.id }, stats: Object.fromEntries(fields.map(field => [field, 100])), jutsuMastery: [] };
                const saved = sanitizeCharacterSave({ character, creatorItems: [item] }, { character, creatorItems: [item] });
                const savedItem = (saved.creatorItems as Record<string, unknown>[])[0];
                assert.deepEqual(savedItem.bonuses, item.bonuses, `save must retain +${offenseVal}`);
                const pvp = hydrateCharacterFromSave(character, {}, saved, null);
                const tower = sealTowerFighter(character, saved, {}, null);
                assert.deepEqual(tower, pvp, 'shared PvE/Tower and PvP hydration must agree');
                for (const field of fields) assert.equal((pvp.stats as Record<string, number>)[field], 100 + offenseVal);
                const weapon = (pvp.pvpItems as Record<string, unknown>[])[0];
                assert.equal(weapon.weaponEp, 26);
                assert.deepEqual(weapon.weaponTags, item.weaponTags);
            }
        } finally {
            if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
            else process.env.STRICT_RAW_SAVE_LEDGER = previous;
        }
    });

    it('bounds inflated named weapon bonuses while leaving other item budgets unchanged', () => {
        const id = 'named-weapon-00000000000040008000000000000001';
        const bonuses = { ninjutsuOffense: 1000, taijutsuOffense: 1000, genjutsuOffense: 1000, bukijutsuOffense: 1000 };
        const out = budgetItemBonuses({ id, slot: 'hand', bonuses });
        assert.deepEqual(out.bonuses, Object.fromEntries(Object.keys(bonuses).map(field => [field, NAMED_WEAPON_OFFENSE.max])));
        for (const other of [
            { id: 'named-weapon-not-a-uuid', slot: 'hand' },
            { id: id.replace('weapon', 'armor'), slot: 'hand' },
            { id: 'custom-hand-item', slot: 'hand' },
        ]) {
            const bounded = budgetItemBonuses({ ...other, bonuses }).bonuses;
            assert.equal(Object.values(bounded).reduce((sum, value) => sum + value, 0), 420);
        }
        assert.equal(Object.values(budgetItemBonuses({ id, slot: 'body', bonuses }).bonuses).reduce((sum, value) => sum + value, 0), 280);
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
