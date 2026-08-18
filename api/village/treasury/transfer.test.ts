import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDurableSettlement, settlementTransactionId } from '../../_durable-settlement.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'village-transfer-handler-test-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };
let handler: Handler;
let kv: typeof import('../../_storage.js').kv;
const VILLAGE_KEY = 'game:village-state:leaf';
const RECIPIENT_KEY = 'save:recipient';

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    handler = (await import('./transfer.js')).default as unknown as Handler;
});

beforeEach(async () => {
    await kv.set(VILLAGE_KEY, { treasury: { ryo: 100 } });
    await kv.set(RECIPIENT_KEY, { _saveVersion: 1, character: { name: 'Recipient', village: 'Leaf', ryo: 10 } });
    for (const key of await kv.keys('economy-settlement:*')) await kv.del(key);
});

after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeReq(body: Record<string, unknown>) {
    return { method: 'POST', body, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! }, socket: { remoteAddress: '127.0.0.1' } } as never;
}
function fakeRes() {
    const out: ResponseOut = { statusCode: 200, body: undefined };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}
async function post(body: Record<string, unknown>): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    await handler(fakeReq(body), res);
    return out;
}

describe('village treasury transfer settlement', () => {
    it('debits and credits exactly once on replay', { concurrency: false }, async () => {
        const body = { village: 'Leaf', recipientName: 'Recipient', currency: 'ryo', amount: 25, requestId: 'village-transfer-replay-01' };
        const first = await post(body);
        const replay = await post(body);
        assert.equal(first.statusCode, 200);
        assert.equal(replay.statusCode, 200);
        assert.equal((await kv.get<{ treasury?: { ryo?: number } }>(VILLAGE_KEY))?.treasury?.ryo, 75);
        const recipient = await kv.get<{ _saveVersion?: number; character?: { ryo?: number } }>(RECIPIENT_KEY);
                // Gift tax (api/_treasury-gift-tax.ts, 2026-08-17): the pool loses the
        // full 25, the recipient receives 22 and 3 is BURNED. 10 + 22 = 32.
        assert.equal(recipient?.character?.ryo, 32);
        assert.equal(first.body?._saveVersion, recipient?._saveVersion, 'fresh transfer must echo the exact recipient commit version');
        assert.equal(replay.body?._saveVersion, recipient?._saveVersion, 'durable replay must preserve the original commit version');
    });

    it('retries after recipient persistence fails without duplicating the debit', { concurrency: false }, async () => {
        const originalCompareSet = kv.compareSet.bind(kv);
        let failRecipient = true;
        kv.compareSet = async (key, expected, value, options) => {
            if (failRecipient && key === RECIPIENT_KEY) throw new Error('injected recipient write failure');
            return originalCompareSet(key, expected, value, options);
        };
        const body = { village: 'Leaf', recipientName: 'Recipient', currency: 'ryo', amount: 25, requestId: 'village-transfer-fault-01' };
        try {
            assert.equal((await post(body)).statusCode, 500);
            assert.equal((await kv.get<{ treasury?: { ryo?: number } }>(VILLAGE_KEY))?.treasury?.ryo, 75);
            assert.equal((await getDurableSettlement(
                settlementTransactionId('village-treasury-transfer', 'village-transfer-fault-01'),
                { kv },
            ))?.state, 'reconciliation-required');
            failRecipient = false;
            assert.equal((await post(body)).statusCode, 200);
        } finally {
            kv.compareSet = originalCompareSet;
        }
        assert.equal((await kv.get<{ treasury?: { ryo?: number } }>(VILLAGE_KEY))?.treasury?.ryo, 75);
        assert.equal((await kv.get<{ character?: { ryo?: number } }>(RECIPIENT_KEY))?.character?.ryo, 32);
    });
});
