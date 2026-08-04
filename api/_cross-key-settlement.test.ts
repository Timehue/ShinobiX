import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('./_storage.js').kv;
let settleCrossKeyTransfer: typeof import('./_cross-key-settlement.js').settleCrossKeyTransfer;
let SettlementValidationError: typeof import('./_cross-key-settlement.js').SettlementValidationError;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ settleCrossKeyTransfer, SettlementValidationError } = await import('./_cross-key-settlement.js'));
});

beforeEach(async () => {
    for (const key of await kv.keys('economy-settlement:*')) await kv.del(key);
    for (const key of await kv.keys('lock:test-cross-key:*')) await kv.del(key);
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fixture(validateRecipient: () => void = () => undefined) {
    let source: Record<string, unknown> = { balance: 10 };
    let recipientRecord: Record<string, unknown> = { _saveVersion: 1 };
    let recipient: Record<string, unknown> = { balance: 0 };
    const options = {
        operationType: 'test-cross-key',
        idempotencyKey: 'cross-key-request-01',
        fingerprint: 'cross-key-fingerprint-01',
        actorIds: ['source', 'recipient'],
        resource: 'ryo',
        amount: 5,
        sourceKey: 'test-cross-key:source',
        recipientKey: 'test-cross-key:recipient',
        loadSource: async () => source,
        validateSource: () => {
            if (Number(source.balance) < 5) throw new SettlementValidationError(400, 'Insufficient source balance.');
        },
        debitSource: (current: Record<string, unknown>, receipt: Record<string, unknown>) => ({
            ...current,
            balance: Number(current.balance) - 5,
            settlementReceipts: [receipt],
        }),
        saveSource: async (next: Record<string, unknown>) => { source = next; },
        loadRecipient: async () => ({ record: recipientRecord, character: recipient }),
        validateRecipient,
        creditRecipient: (character: Record<string, unknown>) => ({
            character: { ...character, balance: Number(character.balance) + 5 },
            result: { amount: 5 },
        }),
        saveRecipient: async (record: Record<string, unknown>, character: Record<string, unknown>) => {
            recipient = character;
            recipientRecord = { ...record, _saveVersion: Number(record._saveVersion) + 1, character };
            return recipientRecord;
        },
    };
    return { options, getSource: () => source, getRecipient: () => recipient };
}

describe('cross-key durable settlement orchestration', { concurrency: false }, () => {
    it('validates the locked recipient before applying the source debit', async () => {
        const f = fixture(() => { throw new SettlementValidationError(403, 'Recipient is ineligible.'); });
        await assert.rejects(() => settleCrossKeyTransfer(f.options), /Recipient is ineligible/);
        assert.equal(f.getSource().balance, 10);
        assert.equal(f.getRecipient().balance, 0);
        const records = await kv.keys('economy-settlement:*');
        const journalKeys = records.filter((key) => key !== 'economy-settlement:index');
        const journal = await kv.get<{ state?: string }>(journalKeys[0]);
        assert.equal(journal?.state, 'cancelled');
    });

    it('serializes concurrent identical requests and moves value exactly once', async () => {
        const f = fixture();
        const results = await Promise.all(Array.from({ length: 6 }, () => settleCrossKeyTransfer(f.options)));
        assert.equal(results.length, 6);
        assert.equal(f.getSource().balance, 5);
        assert.equal(f.getRecipient().balance, 5);
        assert.ok(results.every((result) => result.transaction.state === 'completed'));
    });
});
