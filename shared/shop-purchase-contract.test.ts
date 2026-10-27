import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shopPurchaseRequestContract as request, shopPurchaseResponseContract as response } from './shop-purchase-contract.js';

const input = { playerName: 'Shinobi', requestId: 'shop-00000001', itemId: 'shinobi-vest', qty: 1 };
const receipt = {
    ok: true, replayed: false, purchase: { id: input.itemId, currency: 'ryo', qty: 1, unitCost: 100, totalCost: 100 },
    character: { name: input.playerName, ryo: 900, inventory: [input.itemId], futureField: { keep: true } }, _saveVersion: 2,
};

test('purchase request preserves legacy quantity and identity normalization', () => {
    for (const [qty, expected] of [[undefined, 1], [null, 1], ['2.9', 2], [-1, 1], [1e9, 1e9]] as const) {
        assert.equal(request.parse({ ...input, qty }).qty, expected);
    }
    assert.equal(request.parse({ ...input, requestId: `  ${'a'.repeat(100)}  ` }).requestId, 'a'.repeat(96));
});

test('malformed purchase requests fail before catalog mutation', () => {
    for (const value of [null, [], { ...input, playerName: [] }, { ...input, requestId: 'short' },
        { ...input, itemId: {} }, { ...input, qty: {} }, { ...input, qty: 'NaN' }, { ...input, qty: Infinity }]) {
        assert.equal(request.safeParse(value).success, false);
    }
});

test('purchase response retains authoritative game fields and validates the complete receipt', () => {
    assert.deepEqual(response.parse(receipt), receipt);
    const replay = { ...receipt, replayed: true, character: { ...receipt.character, ryo: 900.5 } };
    assert.deepEqual(response.parse(replay), replay, 'replays preserve a current legacy Ryo balance');
    for (const value of [null, { ...receipt, ok: false }, { ...receipt, replayed: undefined },
        { ...receipt, _saveVersion: '2' }, { ...receipt, _saveVersion: 0 },
        { ...receipt, character: { ...receipt.character, ryo: -1 } },
        ...[{ qty: 0 }, { unitCost: NaN }, { totalCost: 99 }, { currency: 'gold' }]
            .map(patch => ({ ...receipt, purchase: { ...receipt.purchase, ...patch } }))]) {
        assert.equal(response.safeParse(value).success, false);
    }
});
