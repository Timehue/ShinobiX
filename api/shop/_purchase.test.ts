import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { purchaseCatalogItem } from './_purchase.js';

describe('catalog shop purchase', () => {
    it('atomically debits ryo and grants an ordinary catalog item', () => {
        const result = purchaseCatalogItem({ level: 10, ryo: 1000, inventory: [] }, 'shinobi-vest', 99);
        assert.equal(result.ok, true);
        if (result.ok) { assert.equal(result.item.qty, 1); assert.equal(result.character.ryo, 820); assert.deepEqual(result.character.inventory, ['shinobi-vest']); }
    });
    it('derives premium currency and stored discounts', () => {
        const result = purchaseCatalogItem({ level: 100, fateShards: 1000, elderFocus: 'trade', inventory: [] }, 'golden-apple', 1);
        assert.equal(result.ok, true);
        if (result.ok) { assert.equal(result.item.currency, 'fateShards'); assert.equal(result.item.unitCost, 19); }
    });
    it('sells the profession approval for 200 Fate Shards from level 13', () => {
        const result = purchaseCatalogItem({ level: 13, fateShards: 200, inventory: [] }, 'profession-change-approval', 1);
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.item.currency, 'fateShards');
            assert.equal(result.item.unitCost, 200);
            assert.equal(result.character.fateShards, 0);
            assert.deepEqual(result.character.inventory, ['profession-change-approval']);
        }
    });
    it('enforces consumable caps and rejects free reward items', () => {
        const capped = purchaseCatalogItem({ level: 100, ryo: 100000, inventory: Array(50).fill('item-attack-pill') }, 'item-attack-pill', 5);
        assert.equal(capped.ok, false);
        assert.equal(purchaseCatalogItem({ level: 100, ryo: 100000, inventory: [] }, 'dungeon-key', 1).ok, false);
    });
    it('routes a stackable buy into itemStacks so a bulk order costs no inventory slots', () => {
        // The whole point: combat consumables are what a player buys 50 of, and
        // they stack. Pushing 50 raw copies into `inventory[]` (as this used to)
        // made a bulk order read as +50 slots, so the capacity gate in
        // purchase.ts refused potions and shuriken to a full-bag veteran — the
        // one thing an inventory cap must never block.
        const result = purchaseCatalogItem({ level: 100, ryo: 100_000, inventory: ['keepsake'], itemStacks: [] }, 'thrown-shuriken', 50);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.item.qty, 50);
        assert.deepEqual(result.character.inventory, ['keepsake'], 'inventory[] is untouched by a stackable buy');
        assert.deepEqual(result.character.itemStacks, [{ itemId: 'thrown-shuriken', count: 50 }]);
    });

    it('adds to an existing stack rather than starting a second one', () => {
        const result = purchaseCatalogItem(
            { level: 100, ryo: 100_000, inventory: [], itemStacks: [{ itemId: 'other', count: 3 }, { itemId: 'thrown-shuriken', count: 10 }] },
            'thrown-shuriken', 5,
        );
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.deepEqual(result.character.itemStacks, [{ itemId: 'other', count: 3 }, { itemId: 'thrown-shuriken', count: 15 }]);
    });

    it('still spends a real inventory slot for non-stackable gear', () => {
        const result = purchaseCatalogItem({ level: 10, ryo: 1000, inventory: [], itemStacks: [] }, 'shinobi-vest', 1);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.deepEqual(result.character.inventory, ['shinobi-vest'], 'gear is the only thing the capacity gate should ever see');
    });

    it('counts a stacked holding against the per-item hold cap', () => {
        // `itemCount` reads both halves, so routing to itemStacks must not turn
        // the 50-shuriken cap into an unlimited faucet.
        const capped = purchaseCatalogItem(
            { level: 100, ryo: 100_000, inventory: [], itemStacks: [{ itemId: 'thrown-shuriken', count: 50 }] },
            'thrown-shuriken', 5,
        );
        assert.equal(capped.ok, false);
    });

    it('fails closed on insufficient funds and duplicate gear', () => {
        assert.equal(purchaseCatalogItem({ level: 100, ryo: 0, inventory: [] }, 'shinobi-vest', 1).ok, false);
        assert.equal(purchaseCatalogItem({ level: 100, ryo: 1000, inventory: ['shinobi-vest'] }, 'shinobi-vest', 1).ok, false);
    });
});
