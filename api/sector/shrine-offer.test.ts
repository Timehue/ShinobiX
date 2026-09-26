import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'shrine-offer-retry-test-secret-32bytes!';

/*
 * /api/sector/shrine-offer through the real handler and the real storage
 * adapter (issue #179): the same request id never charges twice, a failed
 * ledger write gives the offering back, and a stop between the two writes is
 * finished by the retry.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const PLAYER = 'shrinepilgrim';
const OTHER = 'shrineother';
const SHRINE = 'heartwood'; // sector 15
const SHRINE_KEY = `world:shrine:${SHRINE}`;

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let resetRateLimits: () => void;
let handler: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    handler = (await import('./shrine-offer.js')).default as unknown as Handler;
});

beforeEach(async () => {
    // The shrine allows 10 offerings a minute per player; each test starts fresh.
    resetRateLimits();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const name of [PLAYER, OTHER]) {
        await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, level: 30, ryo: 10_000 } });
        onlineStore.remove(name);
        onlineStore.upsert({ name, sector: 15, tile: 5, character: { level: 30 } } as never);
    }
});

after(async () => {
    for (const name of [PLAYER, OTHER]) onlineStore.remove(name);
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

async function call(body: Record<string, unknown>, as = PLAYER): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: { playerName: PLAYER, shrineId: SHRINE, ...body },
        headers: { 'x-player-name': as, 'x-player-token': issuePlayerToken(as) ?? '' },
        socket: { remoteAddress: '127.0.0.15' },
    } as never, res as never);
    return out;
}

const ryo = async (name = PLAYER) => Number((await kv.get<{ character: { ryo: number } }>(`save:${name}`))?.character.ryo);
const ledger = async () => (await kv.get<{ total?: number; topWeek?: Array<{ name: string; amount: number }> }>(SHRINE_KEY)) ?? {};

test('an offering debits once and credits the shrine ledger once', async () => {
    const out = await call({ amount: 1_000, requestId: 'shrine-first-offering-01' });
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    assert.equal(out.body?.ryo, 9_000);
    assert.equal(out.body?._saveVersion, 2);
    assert.equal((out.body?.shrine as { total: number }).total, 1_000);
    assert.equal(await ryo(), 9_000);
    assert.equal((await ledger()).total, 1_000);
    assert.deepEqual((await ledger()).topWeek, [{ name: PLAYER, amount: 1_000 }]);
});

test('a retry after a lost response returns the original result and charges nothing', async () => {
    const first = await call({ amount: 1_000, requestId: 'shrine-lost-response-01' });
    assert.equal(first.statusCode, 200);
    const retry = await call({ amount: 1_000, requestId: 'shrine-lost-response-01' });
    assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
    assert.equal(retry.body?.replayed, true);
    assert.equal(retry.body?.ryo, 9_000);
    assert.equal(await ryo(), 9_000, 'exactly one debit');
    assert.equal((await ledger()).total, 1_000, 'exactly one credit');
});

test('a retry is answered even after the pilgrim walked away, while a new offering is refused', async () => {
    assert.equal((await call({ amount: 500, requestId: 'shrine-walked-away-001' })).statusCode, 200);
    onlineStore.remove(PLAYER);
    onlineStore.upsert({ name: PLAYER, sector: 16, tile: 5, character: { level: 30 } } as never);
    const retry = await call({ amount: 500, requestId: 'shrine-walked-away-001' });
    assert.equal(retry.statusCode, 200, 'co-presence is judged when the offering is made, not on its replay');
    const fresh = await call({ amount: 500, requestId: 'shrine-walked-away-002' });
    assert.equal(fresh.statusCode, 409);
    assert.equal(await ryo(), 9_500);
    assert.equal((await ledger()).total, 500);
});

test('concurrent duplicates of one offering settle once', async () => {
    const outs = await Promise.all(Array.from({ length: 5 }, () => call({ amount: 2_000, requestId: 'shrine-double-click-001' })));
    for (const out of outs) assert.ok(out.statusCode === 200 || out.statusCode === 503, JSON.stringify(out));
    assert.equal(outs.filter((o) => o.statusCode === 200 && !o.body?.replayed).length, 1);
    assert.equal(await ryo(), 8_000);
    assert.equal((await ledger()).total, 2_000);
});

test('a failed ledger write does not keep the debit, and the retry settles once', async (t) => {
    const original = kv.set.bind(kv);
    let fail = true;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (fail && args[0] === SHRINE_KEY) { fail = false; throw new Error('injected ledger write failure'); }
        return original(...args);
    });
    const failed = await call({ amount: 3_000, requestId: 'shrine-ledger-fails-001' });
    assert.equal(failed.statusCode, 503, JSON.stringify(failed.body));
    assert.equal(failed.body?.refunded, true);
    assert.equal(await ryo(), 10_000, 'the offering was given back');
    assert.equal((await ledger()).total, undefined, 'the ledger never recorded it');
    const retry = await call({ amount: 3_000, requestId: 'shrine-ledger-fails-001' });
    assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
    assert.equal(await ryo(), 7_000);
    assert.equal((await ledger()).total, 3_000);
});

test('a stop between the debit and the ledger write is finished by the retry, exactly once', async (t) => {
    const originalSet = kv.set.bind(kv);
    const originalCompareSet = kv.compareSet.bind(kv);
    let broken = true;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (broken && args[0] === SHRINE_KEY) throw new Error('process stopped');
        return originalSet(...args);
    });
    let saveWrites = 0;
    t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
        if (broken && args[0] === `save:${PLAYER}` && ++saveWrites > 1) throw new Error('refund never ran');
        return originalCompareSet(...args);
    });
    const stuck = await call({ amount: 4_000, requestId: 'shrine-process-stop-001' });
    assert.equal(stuck.statusCode, 503, JSON.stringify(stuck.body));
    assert.equal(stuck.body?.pending, true);
    assert.equal(await ryo(), 6_000, 'the debit landed');
    assert.equal((await ledger()).total, undefined, 'the credit did not');

    broken = false;
    const retry = await call({ amount: 4_000, requestId: 'shrine-process-stop-001' });
    assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
    assert.equal(await ryo(), 6_000, 'the retry charges nothing more');
    assert.equal((await ledger()).total, 4_000, 'the retry records the offering');
    assert.equal((await call({ amount: 4_000, requestId: 'shrine-process-stop-001' })).body?.replayed, true);
    assert.equal((await ledger()).total, 4_000);
});

test('insufficient funds, forged identities and bad ids move nothing', async () => {
    const poor = await call({ amount: 200_000, requestId: 'shrine-too-poor-000001' });
    assert.equal(poor.statusCode, 400);
    const forged = await call({ amount: 1_000, requestId: 'shrine-forged-identity1' }, OTHER);
    assert.ok(forged.statusCode === 401 || forged.statusCode === 403, JSON.stringify(forged));
    const badId = await call({ amount: 1_000, requestId: 'short' });
    assert.equal(badId.statusCode, 400);
    await call({ amount: 1_000, requestId: 'shrine-reused-id-000001' });
    const reused = await call({ amount: 2_000, requestId: 'shrine-reused-id-000001' });
    assert.equal(reused.statusCode, 409, 'one id, one offering');
    assert.equal(await ryo(), 9_000);
    assert.equal(await ryo(OTHER), 10_000);
    assert.equal((await ledger()).total, 1_000);
});

test('a client that sends no request id still settles exactly once per request', async () => {
    assert.equal((await call({ amount: 100 })).statusCode, 200);
    assert.equal((await call({ amount: 100 })).statusCode, 200);
    assert.equal(await ryo(), 9_800);
    assert.equal((await ledger()).total, 200);
});
