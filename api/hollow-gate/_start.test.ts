import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { consumeHollowGateKey, normalizePublishedEventGate } from './start.js';

describe('Hollow Gate server entry debit', () => {
    it('retains the bounded published event label for immutable run sealing', () => {
        const event = normalizePublishedEventGate({ id: 'mirror-event', active: true, label: '  Mirror Trial  ', bossAiId: 'rift-boss-mirror-shard' }, 'mirror-event');
        assert.equal(event?.label, 'Mirror Trial');
        assert.equal(normalizePublishedEventGate({ id: 'mirror-event', active: true, label: 'x'.repeat(200) }, 'mirror-event')?.label?.length, 120);
    });
    it('consumes exactly one counted Key', () => {
        const next = consumeHollowGateKey({ itemStacks: [{ itemId: 'hollow-gate-key', count: 2 }, { itemId: 'other', count: 4 }] });
        assert.deepEqual(next?.itemStacks, [{ itemId: 'hollow-gate-key', count: 1 }, { itemId: 'other', count: 4 }]);
    });

    it('supports legacy inventory Keys and rejects a missing Key', () => {
        assert.deepEqual(consumeHollowGateKey({ inventory: ['other', 'hollow-gate-key', 'other'] })?.inventory, ['other', 'other']);
        assert.equal(consumeHollowGateKey({ inventory: ['other'], itemStacks: [] }), null);
    });
});
