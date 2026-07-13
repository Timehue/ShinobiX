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
    it('enforces consumable caps and rejects free reward items', () => {
        const capped = purchaseCatalogItem({ level: 100, ryo: 100000, inventory: Array(50).fill('item-attack-pill') }, 'item-attack-pill', 5);
        assert.equal(capped.ok, false);
        assert.equal(purchaseCatalogItem({ level: 100, ryo: 100000, inventory: [] }, 'dungeon-key', 1).ok, false);
    });
    it('fails closed on insufficient funds and duplicate gear', () => {
        assert.equal(purchaseCatalogItem({ level: 100, ryo: 0, inventory: [] }, 'shinobi-vest', 1).ok, false);
        assert.equal(purchaseCatalogItem({ level: 100, ryo: 1000, inventory: ['shinobi-vest'] }, 'shinobi-vest', 1).ok, false);
    });
});
