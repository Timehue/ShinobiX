import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { consumeHollowGateKey } from './start.js';

describe('Hollow Gate server entry debit', () => {
    it('consumes exactly one counted Key', () => {
        const next = consumeHollowGateKey({ itemStacks: [{ itemId: 'hollow-gate-key', count: 2 }, { itemId: 'other', count: 4 }] });
        assert.deepEqual(next?.itemStacks, [{ itemId: 'hollow-gate-key', count: 1 }, { itemId: 'other', count: 4 }]);
    });

    it('supports legacy inventory Keys and rejects a missing Key', () => {
        assert.deepEqual(consumeHollowGateKey({ inventory: ['other', 'hollow-gate-key', 'other'] })?.inventory, ['other', 'other']);
        assert.equal(consumeHollowGateKey({ inventory: ['other'], itemStacks: [] }), null);
    });
});
