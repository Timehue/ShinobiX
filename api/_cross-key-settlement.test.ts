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

    it('reports which call actually moved value and which merely replayed', async () => {
        // Callers need this to decide whether to run side effects that live
        // OUTSIDE the saga. Both treasury doors charge the sender's rolling 24h
        // transfer budget after this returns, and neither client sends a
        // requestId — so the idempotency key is a content fingerprint and a
        // repeat gift of the same amount to the same player resolves as a
        // replay. Billing that would charge an officer for a gift that moved
        // nothing, and five repeats would exhaust a day's ceiling having sent
        // money once.
        const f = fixture();
        const first = await settleCrossKeyTransfer(f.options);
        assert.equal(first.replayed, false, 'the call that moved value is not a replay');

        const again = await settleCrossKeyTransfer(f.options);
        assert.equal(again.replayed, true);
        assert.deepEqual(again.result, first.result, 'and it returns the stored result unchanged');
        assert.equal(f.getSource().balance, 5, 'nothing moved the second time');
        assert.equal(f.getRecipient().balance, 5);
    });

    it('marks every duplicate in a concurrent burst as a replay', async () => {
        const f = fixture();
        const results = await Promise.all(Array.from({ length: 6 }, () => settleCrossKeyTransfer(f.options)));
        const moved = results.filter((r) => !r.replayed);
        assert.equal(moved.length, 1, 'exactly one call may report that it moved value');
    });

    it('locks the shared source row before the recipient save, even when the recipient sorts first', async () => {
        // 'test-cross-key:recipient' sorts before 'test-cross-key:source'. A
        // member save and its clan row share the `save:` namespace the same
        // way, and every other path nesting those two rows takes the clan row
        // first — see api/clan/_lock-order.test.ts.
        const f = fixture();
        const originalSet = kv.set.bind(kv);
        const acquired: string[] = [];
        kv.set = async (key, value, options) => {
            const out = await originalSet(key, value, options);
            if (options?.nx && key.startsWith('lock:test-cross-key:') && out) acquired.push(key);
            return out;
        };
        try {
            await settleCrossKeyTransfer(f.options);
        } finally {
            kv.set = originalSet;
        }
        assert.deepEqual(acquired, ['lock:test-cross-key:source', 'lock:test-cross-key:recipient']);
    });
});

describe('cross-key settlement resumes without applying a side twice', { concurrency: false }, () => {
    /** The first attempt debits the source, then its credit write fails before landing. */
    async function debitThenFailCredit(f: ReturnType<typeof fixture>) {
        const saveRecipient = f.options.saveRecipient;
        f.options.saveRecipient = async () => { throw new Error('injected: recipient write failed'); };
        await assert.rejects(() => settleCrossKeyTransfer(f.options), /recipient write failed/);
        f.options.saveRecipient = saveRecipient;
        assert.equal(f.getSource().balance, 5, 'the debit landed');
        assert.equal(f.getRecipient().balance, 0, 'the credit did not');
    }

    async function journal() {
        const key = (await kv.keys('economy-settlement:*')).find((entry) => entry !== 'economy-settlement:index'
            && entry !== 'economy-settlement:reconciliation-status');
        return key ? kv.get<{ state?: string; createdAt?: number }>(key) : null;
    }

    it('refuses to debit again when the earlier debit receipt was pushed out of the capped list', async () => {
        const f = fixture();
        f.options.debitSource = (current, receipt) => ({
            ...current,
            balance: Number(current.balance) - 5,
            settlementReceipts: [receipt, ...(Array.isArray(current.settlementReceipts) ? current.settlementReceipts : [])].slice(0, 100),
        });
        await debitThenFailCredit(f);
        // A hundred newer transfers from the same source evict the receipt.
        const createdAt = Number((await journal())?.createdAt);
        const source = await f.options.loadSource();
        source.settlementReceipts = Array.from({ length: 100 }, (_, i) => ({
            transactionId: `newer-${i}`, fingerprint: 'other', resource: 'ryo', amount: 1, appliedAt: createdAt + 1 + i,
        }));
        source.balance = 50;

        await assert.rejects(() => settleCrossKeyTransfer(f.options), (error: unknown) => {
            assert.ok(error instanceof SettlementValidationError);
            assert.equal(error.status, 409);
            assert.equal(error.details?.reconcile, true);
            return true;
        });
        assert.equal(f.getSource().balance, 50, 'the source was not debited a second time');
        assert.equal(f.getRecipient().balance, 0);
        assert.equal((await journal())?.state, 'reconciliation-required', 'left for an operator, not cancelled');
    });

    it('refuses to credit again when the earlier credit receipt was pushed out of the capped list', async () => {
        const f = fixture();
        const first = await settleCrossKeyTransfer(f.options);
        assert.equal(first.replayed, false);
        // The completion was lost after both writes landed, and the journal
        // never recorded credit-applied: fifty newer receipts then evict the
        // member's receipt.
        const key = (await kv.keys('economy-settlement:test-cross-key-*'))[0];
        const record = await kv.get<Record<string, unknown>>(key);
        await kv.set(key, { ...record, state: 'debit-applied', result: undefined });
        const createdAt = Number(record?.createdAt);
        const recipient = await f.options.loadRecipient();
        recipient.character.serverSettlementReceipts = Array.from({ length: 50 }, (_, i) => ({
            requestId: `newer-receipt-${String(i).padStart(4, '0')}`, fingerprint: 'other', value: { amount: 1 }, settledAt: createdAt + 1 + i,
        }));

        await assert.rejects(() => settleCrossKeyTransfer(f.options), (error: unknown) => {
            assert.ok(error instanceof SettlementValidationError);
            assert.equal(error.details?.reconcile, true);
            return true;
        });
        assert.equal(f.getSource().balance, 5);
        assert.equal(f.getRecipient().balance, 5, 'the recipient was not credited a second time');
    });

    it('finishes from the journal when only the completion was lost after the credit', async () => {
        const f = fixture();
        await settleCrossKeyTransfer(f.options);
        const key = (await kv.keys('economy-settlement:test-cross-key-*'))[0];
        const record = await kv.get<Record<string, unknown>>(key);
        await kv.set(key, { ...record, state: 'credit-applied' });
        // Both receipts have been pushed out since.
        const source = await f.options.loadSource();
        source.settlementReceipts = [];
        const recipient = await f.options.loadRecipient();
        recipient.character.serverSettlementReceipts = [];

        const resumed = await settleCrossKeyTransfer(f.options);
        assert.deepEqual(resumed.result, record?.result);
        assert.equal(resumed.transaction.state, 'completed');
        assert.equal(f.getSource().balance, 5, 'nothing moved again');
        assert.equal(f.getRecipient().balance, 5);
    });

    it('never cancels a transfer whose debit landed when the recipient has since vanished', async () => {
        const f = fixture();
        await debitThenFailCredit(f);
        f.options.loadRecipient = async () => null as never;
        await assert.rejects(() => settleCrossKeyTransfer(f.options), /Recipient save not found/);
        // A cancelled journal is final and the stale sweep skips it, so the
        // five already debited would be stranded with nobody told.
        assert.equal((await journal())?.state, 'reconciliation-required');
        assert.equal(f.getSource().balance, 5);
    });
});
