import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDurableSettlement, settlementTransactionId } from '../../_durable-settlement.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'clan-transfer-handler-test-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };
let handler: Handler;
let kv: typeof import('../../_storage.js').kv;
const CLAN_KEY = 'save:clan-ashwind';
const RECIPIENT_KEY = 'save:recipient';

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    handler = (await import('./transfer.js')).default as unknown as Handler;
});

beforeEach(async () => {
    await kv.set(CLAN_KEY, {
        founderName: 'Founder',
        members: [{ name: 'Founder', isFounder: true }, { name: 'Recipient' }],
        treasury: { ryo: 100 },
    });
    await kv.set(RECIPIENT_KEY, { _saveVersion: 1, character: { name: 'Recipient', clan: 'Ashwind', ryo: 10 } });
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

describe('clan treasury transfer settlement', () => {
    it('debits and credits exactly once on replay', { concurrency: false }, async () => {
        const body = { clanName: 'Ashwind', recipientName: 'Recipient', currency: 'ryo', amount: 25, requestId: 'clan-transfer-replay-01' };
        const first = await post(body);
        const replay = await post(body);
        assert.equal(first.statusCode, 200);
        assert.equal(replay.statusCode, 200);
        assert.equal((await kv.get<{ treasury?: { ryo?: number } }>(CLAN_KEY))?.treasury?.ryo, 75);
        const recipient = await kv.get<{ _saveVersion?: number; character?: { ryo?: number } }>(RECIPIENT_KEY);
                // Gift tax (api/_treasury-gift-tax.ts, 2026-08-17): the pool loses the
        // full 25, the recipient receives 22 and 3 is BURNED. 10 + 22 = 32.
        assert.equal(recipient?.character?.ryo, 32);
        // The burn is the POINT of this leg: the treasury lost 25 and the
        // recipient gained 22, so 3 ryo left the economy. Without it the
        // donate->gift round trip is a 0% laundering channel that undercuts the
        // taxed /api/player/trade.
        assert.equal(first.body?.burned, 3, 'the gift must report the burned amount');
        assert.equal(first.body?.amount, 22, 'the gift must report the CREDITED amount, not the raw one');
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
        const body = { clanName: 'Ashwind', recipientName: 'Recipient', currency: 'ryo', amount: 25, requestId: 'clan-transfer-fault-01' };
        try {
            assert.equal((await post(body)).statusCode, 500);
            assert.equal((await kv.get<{ treasury?: { ryo?: number } }>(CLAN_KEY))?.treasury?.ryo, 75);
            assert.equal((await getDurableSettlement(
                settlementTransactionId('clan-treasury-transfer', 'clan-transfer-fault-01'),
                { kv },
            ))?.state, 'reconciliation-required');
            failRecipient = false;
            assert.equal((await post(body)).statusCode, 200);
        } finally {
            kv.compareSet = originalCompareSet;
        }
        assert.equal((await kv.get<{ treasury?: { ryo?: number } }>(CLAN_KEY))?.treasury?.ryo, 75);
        assert.equal((await kv.get<{ character?: { ryo?: number } }>(RECIPIENT_KEY))?.character?.ryo, 32);
    });

    it('recovers after the completion journal write fails without duplicating either side', { concurrency: false }, async () => {
        const originalSet = kv.set.bind(kv);
        let failCompletion = true;
        kv.set = async (key, value, options) => {
            if (failCompletion
                && key.startsWith('economy-settlement:')
                && !Array.isArray(value)
                && (value as { state?: string }).state === 'completed') {
                failCompletion = false;
                throw new Error('injected completion journal failure');
            }
            return originalSet(key, value, options);
        };
        const body = { clanName: 'Ashwind', recipientName: 'Recipient', currency: 'ryo', amount: 25, requestId: 'clan-transfer-completion-01' };
        try {
            assert.equal((await post(body)).statusCode, 500);
            assert.equal((await kv.get<{ treasury?: { ryo?: number } }>(CLAN_KEY))?.treasury?.ryo, 75);
            assert.equal((await kv.get<{ character?: { ryo?: number } }>(RECIPIENT_KEY))?.character?.ryo, 32);
            assert.equal((await post(body)).statusCode, 200);
        } finally {
            kv.set = originalSet;
        }
        assert.equal((await kv.get<{ treasury?: { ryo?: number } }>(CLAN_KEY))?.treasury?.ryo, 75);
        assert.equal((await kv.get<{ character?: { ryo?: number } }>(RECIPIENT_KEY))?.character?.ryo, 32);
    });
});
