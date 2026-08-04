import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'economy-settlement-admin-test';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let beginDurableSettlement: typeof import('../_durable-settlement.js').beginDurableSettlement;
let durableSettlementKey: typeof import('../_durable-settlement.js').durableSettlementKey;
let settlementTransactionId: typeof import('../_durable-settlement.js').settlementTransactionId;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ beginDurableSettlement, durableSettlementKey, settlementTransactionId } = await import('../_durable-settlement.js'));
    handler = (await import('./economy-settlements.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('economy-settlement:*')) await kv.del(key);
});

after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

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

async function request(method: 'GET' | 'POST', options: { body?: Record<string, unknown>; query?: Record<string, unknown>; admin?: boolean } = {}) {
    const { res, out } = fakeRes();
    const req = {
        method,
        body: options.body,
        query: options.query ?? {},
        headers: options.admin === false ? {} : { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    await handler(req, res);
    return out;
}

async function seedStaleSettlement() {
    const transactionId = settlementTransactionId('admin-scan-test', 'request-1');
    const created = await beginDurableSettlement({
        transactionId,
        idempotencyKey: 'request-1',
        operationType: 'admin-scan-test',
        fingerprint: 'admin-scan-fingerprint',
        actorIds: ['alice'],
        resource: 'ryo',
        amount: 10,
    }, { kv });
    await kv.set(durableSettlementKey(transactionId), {
        ...created.record,
        createdAt: Date.now() - 120_000,
        updatedAt: Date.now() - 120_000,
    });
    return transactionId;
}

describe('admin durable settlement operator surface', { concurrency: false }, () => {
    it('requires full admin authentication', async () => {
        assert.equal((await request('GET', { admin: false })).statusCode, 403);
    });

    it('lists journals and runs a bounded stale scan', async () => {
        const transactionId = await seedStaleSettlement();
        const initial = await request('GET');
        assert.equal(initial.statusCode, 200);
        assert.equal(initial.body?.total, 1);

        const scan = await request('POST', { body: { action: 'scan', staleAfterMs: 60_000, limit: 10 } });
        assert.equal(scan.statusCode, 200);
        assert.equal((scan.body?.summary as { markedRequired?: number }).markedRequired, 1);

        const filtered = await request('GET', { query: { state: 'reconciliation-required' } });
        assert.equal(filtered.statusCode, 200);
        const records = filtered.body?.records as Array<{ transactionId?: string; state?: string }>;
        assert.equal(records[0]?.transactionId, transactionId);
        assert.equal(records[0]?.state, 'reconciliation-required');
    });
});
