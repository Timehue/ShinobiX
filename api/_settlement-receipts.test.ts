import assert from 'node:assert/strict';
import test from 'node:test';
import {
    appendSettlementReceipt,
    inspectSettlementReceipt,
    parseSettlementRequestId,
    SERVER_SETTLEMENT_RECEIPT_LIMIT,
} from './_settlement-receipts.js';

test('settlement request IDs are strict and receipt lookup distinguishes replay from conflict', () => {
    const requestId = '0123456789abcdef';
    assert.equal(parseSettlementRequestId(` ${requestId} `), requestId);
    assert.equal(parseSettlementRequestId('too-short'), null);
    assert.equal(parseSettlementRequestId('0123456789abcde!'), null);

    const character = appendSettlementReceipt({}, [], {
        requestId,
        fingerprint: 'shop:item:kunai:1',
        value: { kind: 'item-purchase', totalCost: 10 },
        settledAt: 1,
    });
    assert.equal(inspectSettlementReceipt(character, requestId, 'shop:item:kunai:1').status, 'replay');
    assert.equal(inspectSettlementReceipt(character, requestId, 'shop:item:other:1').status, 'conflict');
    assert.equal(inspectSettlementReceipt(character, 'fedcba9876543210', 'new').status, 'fresh');
});

test('receipt history is immutable, bounded, and malformed stored data fails closed', () => {
    let character: Record<string, unknown> = {};
    for (let index = 0; index < SERVER_SETTLEMENT_RECEIPT_LIMIT + 5; index += 1) {
        const inspected = inspectSettlementReceipt(character, `${index}`.padStart(16, '0'), `action:${index}`);
        assert.equal(inspected.status, 'fresh');
        character = appendSettlementReceipt(character, inspected.receipts, {
            requestId: `${index}`.padStart(16, '0'),
            fingerprint: `action:${index}`,
            value: { index },
            settledAt: index + 1,
        });
    }
    assert.equal((character.serverSettlementReceipts as unknown[]).length, SERVER_SETTLEMENT_RECEIPT_LIMIT);
    assert.equal(inspectSettlementReceipt({ serverSettlementReceipts: [{}] }, '0123456789abcdef', 'x').status, 'invalid');
});
