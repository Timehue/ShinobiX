/*
 * Server-authoritative PvP consumable budget — the Rejuvenation Potion's
 * 2-uses-per-fight cap and the throwable/consumable "destroy on use" deduction.
 *
 * sealItemCharges (session.ts) seals each fighter's per-fight charges at create
 * time; move.ts decrements one per use and rejects at 0; deductUsedItems
 * (claim-rewards.ts) removes what was spent from the save at settlement.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sealItemCharges, ownedItemCount } from './session.js';
import { deductUsedItems } from './claim-rewards.js';

describe('sealItemCharges — per-fight consumable budget', () => {
    it('caps the potion at 2 even when more are owned', () => {
        const char = {
            equipment: { potion: 'potion-rejuvenation' },
            itemStacks: [{ itemId: 'potion-rejuvenation', count: 9 }],
        };
        assert.equal(sealItemCharges(char, char)['potion-rejuvenation'], 2);
    });

    it('potion owned 1 → only 1 charge (min(owned, 2))', () => {
        const char = {
            equipment: { potion: 'potion-rejuvenation' },
            itemStacks: [{ itemId: 'potion-rejuvenation', count: 1 }],
        };
        assert.equal(sealItemCharges(char, char)['potion-rejuvenation'], 1);
    });

    it('seals throwables at the full owned count (no cap)', () => {
        const char = {
            equipment: { thrown: 'thrown-shuriken' },
            itemStacks: [{ itemId: 'thrown-shuriken', count: 5 }],
        };
        assert.equal(sealItemCharges(char, char)['thrown-shuriken'], 5);
    });

    it('owned count spans both inventory[] and itemStacks', () => {
        const char = { inventory: ['x', 'x'], itemStacks: [{ itemId: 'x', count: 3 }] };
        assert.equal(ownedItemCount(char, 'x'), 5);
    });

    it('NPC (no save inventory) still caps the potion at 2', () => {
        const equipChar = { equipment: { potion: 'potion-rejuvenation' } };
        assert.equal(sealItemCharges(equipChar, null)['potion-rejuvenation'], 2);
    });

    it('NPC non-potion consumables stay unsealed (reusable, prior AI behaviour)', () => {
        const equipChar = { equipment: { thrown: 'thrown-shuriken', item: 'item-smoke-bomb' } };
        const charges = sealItemCharges(equipChar, null);
        assert.equal(charges['thrown-shuriken'], undefined);
        assert.equal(charges['item-smoke-bomb'], undefined);
    });
});

describe('deductUsedItems — settlement consumption', () => {
    it('drains the counted stack first and drops emptied stacks', () => {
        const char = {
            itemStacks: [{ itemId: 'potion-rejuvenation', count: 2 }, { itemId: 'k', count: 1 }],
            inventory: [],
        };
        const out = deductUsedItems(char, { 'potion-rejuvenation': 2 });
        assert.deepEqual(out.itemStacks, [{ itemId: 'k', count: 1 }]);
    });

    it('falls back to inventory[] copies once the stack runs out', () => {
        const char = { itemStacks: [{ itemId: 'x', count: 1 }], inventory: ['x', 'x'] };
        const out = deductUsedItems(char, { x: 2 });
        assert.deepEqual(out.itemStacks, []);   // 1 drained from the stack
        assert.deepEqual(out.inventory, ['x']); // 1 drained from inventory[]
    });

    it('never goes negative when more is reported used than owned', () => {
        const char = { itemStacks: [{ itemId: 'x', count: 1 }], inventory: [] };
        const out = deductUsedItems(char, { x: 5 });
        assert.deepEqual(out.itemStacks, []);
    });

    it('leaves unrelated items untouched', () => {
        const char = { itemStacks: [{ itemId: 'a', count: 3 }, { itemId: 'b', count: 4 }], inventory: ['c'] };
        const out = deductUsedItems(char, { a: 1 });
        assert.deepEqual(out.itemStacks, [{ itemId: 'a', count: 2 }, { itemId: 'b', count: 4 }]);
        assert.deepEqual(out.inventory, ['c']);
    });
});
