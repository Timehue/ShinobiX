import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDurableSettlement, settlementTransactionId } from '../../_durable-settlement.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'seal-pool-handler-test-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };

let handler: Handler;
let kv: typeof import('../../_storage.js').kv;
const PLAYER = 'sealdonor';
const CLAN = 'Ashwind';
const SAVE_KEY = `save:${PLAYER}`;
const POOL_KEY = `clan-seal-pool:${CLAN.toLowerCase()}`;

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    handler = (await import('./donate.js')).default as unknown as Handler;
});

beforeEach(async () => {
    await kv.set(SAVE_KEY, {
        character: { name: PLAYER, clan: CLAN, profession: 'vanguard', honorSeals: 100 },
        _saveVersion: 1,
    });
    await kv.set(POOL_KEY, { clanName: CLAN, balance: 0, log: [] });
    for (const key of await kv.keys('economy-settlement:*')) await kv.del(key);
});

after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeReq(body: Record<string, unknown>) {
    return {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
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

async function donor() {
    return kv.get<{ character?: { honorSeals?: number; dailyDonatedSeals?: number } }>(SAVE_KEY);
}

async function pool() {
    return kv.get<{ balance?: number; log?: unknown[] }>(POOL_KEY);
}

describe('clan seal-pool donation settlement', { concurrency: false }, () => {
    it('debits and credits exactly once, including duplicate replay and conflicting reuse', { concurrency: false }, async () => {
        const first = await post({ playerName: PLAYER, amount: 10, requestId: 'seal-donate-replay-01' });
        assert.equal(first.statusCode, 200);
        assert.equal((await donor())?.character?.honorSeals, 90);
        assert.equal((await pool())?.balance, 10);

        const replay = await post({ playerName: PLAYER, amount: 10, requestId: 'seal-donate-replay-01' });
        assert.equal(replay.statusCode, 200);
        assert.equal((await donor())?.character?.honorSeals, 90);
        assert.equal((await pool())?.balance, 10);
        assert.equal((await pool())?.log?.length, 1);

        const conflict = await post({ playerName: PLAYER, amount: 11, requestId: 'seal-donate-replay-01' });
        assert.equal(conflict.statusCode, 409);
    });

    it('retries after a pool write failure without losing the donor debit', { concurrency: false }, async () => {
        const originalSet = kv.set.bind(kv);
        let failPoolWrite = true;
        kv.set = async (key, value, options) => {
            if (failPoolWrite && key === POOL_KEY) throw new Error('injected pool write failure');
            return originalSet(key, value, options);
        };
        const failed = await post({ playerName: PLAYER, amount: 10, requestId: 'seal-donate-fault-01' });
        assert.equal(failed.statusCode, 500);
        assert.equal((await donor())?.character?.honorSeals, 90, 'donor debit is durable before the failed pool write');
        assert.equal((await pool())?.balance, 0, 'pool is unchanged at the injected boundary');
        assert.equal((await getDurableSettlement(
            settlementTransactionId('clan-seal-donate', 'seal-donate-fault-01'),
            { kv },
        ))?.state, 'reconciliation-required');

        failPoolWrite = false;
        const retry = await post({ playerName: PLAYER, amount: 10, requestId: 'seal-donate-fault-01' });
        kv.set = originalSet;
        assert.equal(retry.statusCode, 200);
        assert.equal((await donor())?.character?.honorSeals, 90);
        assert.equal((await pool())?.balance, 10);
        assert.equal((await pool())?.log?.length, 1);
    });
});
