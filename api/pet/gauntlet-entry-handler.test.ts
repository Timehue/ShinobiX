import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'gauntlet-entry-test-session-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let token = '';
const PLAYER = 'gauntletfeeprobe';

function response() {
    const out: { statusCode: number; body?: Record<string, unknown> } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    token = (await import('../_auth.js')).issuePlayerToken(PLAYER)!;
    handler = (await import('./gauntlet.js')).default as unknown as Handler;
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: { name: PLAYER, ryo: 2_000 } });
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

function request(body: Record<string, unknown> = {}, authToken = token) {
    return {
        method: 'POST', body: { action: 'start', ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': authToken },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

test('Gauntlet start debits the stored wallet after the daily free run', async (t) => {
    // gauntlet.ts stamps and checks the free run's day with a no-argument
    // `new Date()`. A run that straddles UTC midnight between two starts would
    // hand out a second free run, so neither the fee nor the 409 would follow.
    // Freeze Date (Date.now and new Date alike) for the whole check.
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const first = response();
    await handler(request(), first.res);
    assert.equal(first.out.statusCode, 200);
    assert.equal(first.out.body?.chargedRyo, 0);

    const second = response();
    await handler(request(), second.res);
    assert.equal(second.out.statusCode, 200);
    assert.equal(second.out.body?.chargedRyo, 1_500);
    assert.equal((second.out.body?.balances as { ryo?: number })?.ryo, 500);

    const denied = response();
    await handler(request(), denied.res);
    assert.equal(denied.out.statusCode, 409);
    const stored = await kv.get<{ character?: { ryo?: number; petGauntletEntryCount?: number } }>(`save:${PLAYER}`);
    assert.equal(stored?.character?.ryo, 500);
    assert.equal(stored?.character?.petGauntletEntryCount, 2);
});

test('repeated, concurrent and interrupted Gauntlet admissions keep one seal and charge each new entry once', async () => {
    const player = 'gauntletentryretry';
    const auth = (await import('../_auth.js')).issuePlayerToken(player)!;
    await kv.set(`save:${player}`, { _saveVersion: 1, character: { name: player, ryo: 10000 } });
    const start = async (requestId: string) => {
        const result = response(); await handler(request({ requestId }, auth), result.res); return result.out;
    };
    const freeId = randomUUID();
    const free = await start(freeId), freeRetry = await start(freeId);
    assert.equal(free.statusCode, 200); assert.equal(freeRetry.statusCode, 200);
    assert.equal(freeRetry.body?.resumed, true);
    assert.equal(freeRetry.body?.seed, free.body?.seed);
    assert.equal(freeRetry.body?._saveVersion, free.body?._saveVersion);
    const paidId = randomUUID();
    const paid = await start(paidId), paidRetry = await start(paidId);
    assert.equal(paid.body?.chargedRyo, 1500);
    assert.equal(paidRetry.body?.chargedRyo, 0);
    assert.equal((paidRetry.body?.character as { ryo: number }).ryo, 8500);
    assert.equal(paidRetry.body?._saveVersion, paid.body?._saveVersion);
    const concurrentId = randomUUID();
    const pair = await Promise.all([start(concurrentId), start(concurrentId)]);
    assert.ok(pair.every(result => result.statusCode === 200));
    assert.equal(pair[0].body?.seed, pair[1].body?.seed);
    assert.equal((await kv.get<any>(`save:${player}`)).character.ryo, 7000);
    const interruptedId = randomUUID();
    const before = await kv.get(`save:${player}`);
    const realCommit = kv.compareSetMany!.bind(kv);
    kv.compareSetMany = async operations => {
        if (operations.some(operation => operation.key === `petgauntlet:tok:${interruptedId}`)) throw new Error('Controlled entry transaction outage');
        return realCommit(operations);
    };
    try { assert.equal((await start(interruptedId)).statusCode, 500); }
    finally { kv.compareSetMany = realCommit; }
    assert.deepEqual(await kv.get(`save:${player}`), before);
    assert.equal(await kv.get(`petgauntlet:tok:${interruptedId}`), null);
    assert.equal((await start(interruptedId)).statusCode, 200);
    assert.equal((await kv.get<any>(`save:${player}`)).character.ryo, 5500);
    const lostAckId = randomUUID();
    kv.compareSetMany = async operations => {
        const result = await realCommit(operations);
        if (result && operations.some(operation => operation.key === `petgauntlet:tok:${lostAckId}`)) throw new Error('Controlled lost transaction acknowledgment');
        return result;
    };
    try { assert.equal((await start(lostAckId)).statusCode, 200); }
    finally { kv.compareSetMany = realCommit; }
    const recovered = await start(lostAckId);
    assert.equal(recovered.statusCode, 200);
    assert.equal(recovered.body?.resumed, true);
    assert.equal((await kv.get<any>(`save:${player}`)).character.ryo, 4000);
});
