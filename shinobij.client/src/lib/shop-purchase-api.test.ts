import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readShopPurchaseReply } from './shop-purchase-api';

const request = { playerName: 'PurchaseQA', requestId: 'purchase-0001', itemId: 'shinobi-vest', qty: 1 };
const reply = {
    ok: true, replayed: true, purchase: { id: request.itemId, currency: 'ryo', qty: 1, unitCost: 100, totalCost: 100 },
    character: { name: 'purchaseqa', ryo: 40, inventory: [] }, _saveVersion: 8,
};

test('a replay returns the current character even when its receipt describes an older purchase', () => {
    assert.deepEqual(readShopPurchaseReply({ ok: true }, reply, request), reply);
});

test('unconfirmed purchase replies cannot reach the character coordinator', () => {
    for (const raw of [null, { character: reply.character, _saveVersion: 999 },
        { ...reply, _saveVersion: '8' }, { ...reply, character: { ...reply.character, name: 'OtherPlayer' } },
        { ...reply, purchase: { ...reply.purchase, id: 'another-item' } }]) {
        assert.equal(readShopPurchaseReply({ ok: true }, raw, request), null);
    }
});

test('only a validated error is a confirmed refusal', () => {
    assert.deepEqual(readShopPurchaseReply({ ok: false }, { error: 'hold-cap' }, request), { error: 'hold-cap' });
    for (const raw of [null, [], { error: 4 }, reply]) assert.equal(readShopPurchaseReply({ ok: false }, raw, request), null);
});
