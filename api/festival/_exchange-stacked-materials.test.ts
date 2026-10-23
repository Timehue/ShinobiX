/*
 * Sunscar Exchange and the hunt-material stacks (owner ruling A12): a listing
 * counts and removes the seller's units across both stores, and the buyer's
 * units always land in a stack, even when the seller's were legacy copies.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { grantAsset, ownedQuantity, removeAsset, sealAsset } from './_exchange-assets.js';
import type { SettlementCatalogs } from '../shop/_catalog.js';

const LM = 'hunt-legendary-material';
const catalogs = {
    items: new Map([[LM, { id: LM, name: 'Legendary Material', slot: 'item', rarity: 'legendary', cost: 0, bonuses: {} }]]),
    cards: new Map(),
} as unknown as SettlementCatalogs;

describe('Exchange listings read and write the hunt-material stack', () => {
    it('a seller holding legacy copies and a stack lists from both, and the buyer receives a stack', () => {
        const seller = { inventory: [LM, LM, 'rustfang-kunai'], itemStacks: [{ itemId: LM, count: 3 }] };
        const sealed = sealAsset({ character: seller }, catalogs, 'item', LM);
        assert.equal(sealed.stackable, true);
        assert.equal(ownedQuantity(seller, 'item', LM), 5);
        const after = removeAsset(seller, sealed, 4);
        assert.equal(ownedQuantity(after, 'item', LM), 1);

        const legacyOnly = sealAsset({ character: { inventory: [LM], itemStacks: [] } }, catalogs, 'item', LM);
        assert.equal(legacyOnly.stackable, true, 'a material is stackable even when no stack exists yet');
        const buyer = grantAsset({ level: 1, inventory: [LM, 'gear'], itemStacks: [] }, legacyOnly, 4);
        assert.deepEqual(buyer.inventory, ['gear'], 'the buyer\'s legacy copy folds in');
        assert.deepEqual(buyer.itemStacks, [{ itemId: LM, count: 5 }]);
    });
});
