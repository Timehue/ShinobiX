import assert from 'node:assert/strict';
import test from 'node:test';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { buildSettlementCatalogs } from './_catalog.js';

test('settlement catalog trusts built-ins, merges admin content, and honors deletions', () => {
    const builtinId = Object.keys(ITEM_CATALOG)[0]!;
    const catalogs = buildSettlementCatalogs([
        {
            creatorItems: [
                { id: builtinId, name: 'forged override', slot: 'hand', rarity: 'legendary', cost: 1 },
                { id: 'admin-item', name: 'Admin Item', slot: 'item', rarity: 'common', cost: 40 },
            ],
            creatorCards: [{ id: 'admin-card', rarity: 'epic' }],
        },
        {
            creatorItems: [{ id: 'admin-item', name: '__ADMIN_DELETED_ITEM__' }],
            creatorCards: [{ id: 'admin-card', rarity: 'legendary' }],
        },
    ]);
    assert.equal(catalogs.items.get(builtinId)?.name, ITEM_CATALOG[builtinId]!.name);
    assert.equal(catalogs.items.has('admin-item'), false);
    assert.equal(catalogs.cards.get('admin-card')?.rarity, 'legendary');
});

test('invalid admin prices and slots never enter the authoritative catalog', () => {
    const catalogs = buildSettlementCatalogs([{ creatorItems: [
        { id: 'negative', name: 'Bad', slot: 'hand', rarity: 'common', cost: -1 },
        { id: 'wrong-slot', name: 'Bad', slot: 'wallet', rarity: 'common', cost: 10 },
    ] }]);
    assert.equal(catalogs.items.has('negative'), false);
    assert.equal(catalogs.items.has('wrong-slot'), false);
});

test('a later stale source cannot resurrect a tombstoned custom item', () => {
    const catalogs = buildSettlementCatalogs([
        { creatorItems: [{ id: 'deleted-custom', name: '__ADMIN_DELETED_ITEM__' }] },
        { creatorItems: [{ id: 'deleted-custom', name: 'Stale', slot: 'item', rarity: 'common', cost: 1 }] },
    ]);
    assert.equal(catalogs.items.has('deleted-custom'), false);
});
