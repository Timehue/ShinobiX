import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * GET /api/festival/black-market — the read-only crate count behind the player
 * card's "Sealed Crates" cell. It must read the same per-day key the POST pull
 * enforces, never touch the save, and never spend the pull's rate limit.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'black-market-usage-integration-only';
delete process.env.ADMIN_PASSWORD;
type Obj = Record<string, any>;
type Handler = typeof import('./black-market.js').default;
let kv: typeof import('../_storage.js').kv;
let blackMarket: Handler;
let issue: typeof import('../_auth.js').issuePlayerToken;
const realNow = Date.now;
let now = realNow();
const player = 'broker-usage-test';
let ip = 0;
const today = () => new Date(now).toISOString().slice(0, 10);

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken: issue } = await import('../_auth.js'));
    blackMarket = (await import('./black-market.js')).default as unknown as Handler;
    Date.now = () => now;
});
beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    now += 86_400_000;
    ip += 1;
    await kv.set(`save:${player}`, { _saveVersion: 1, _saveAt: now, character: { name: player, level: 30, ryo: 1_000_000, fateShards: 0 } });
});
after(() => { Date.now = realNow; });

async function call(method: 'GET' | 'POST', options: { as?: string; unauth?: boolean; payment?: unknown; requestId?: unknown } = {}) {
    const output: { status: number; body: Obj } = { status: 200, body: {} };
    const res = { setHeader() { return this; }, status(code: number) { output.status = code; return this; }, json(data: Obj) { output.body = data; return this; }, end() { return this; } };
    const as = options.as ?? player;
    await blackMarket({
        method,
        query: method === 'GET' ? { playerName: player } : {},
        body: method === 'POST' ? { playerName: player, ...(options.payment !== undefined ? { payment: options.payment } : {}), ...(options.requestId !== undefined ? { requestId: options.requestId } : {}) } : undefined,
        headers: options.unauth ? {} : { 'x-player-name': as, 'x-player-token': issue(as)! },
        socket: { remoteAddress: `127.0.1.${ip}` },
    } as never, res as never);
    return output;
}

test('the count read needs a signed session for the same player', async () => {
    assert.equal((await call('GET', { unauth: true })).status, 401);
    assert.equal((await call('GET', { as: 'someone-else' })).status, 403);
});

const requestId = (suffix: string) => `${today()}_request_${suffix}`;
// A certificate covers half the stake, so each one is seeded with exactly the
// other half in ryo.
const CERTIFICATE_STAKE = 37_500;
async function certificates(count: number) {
    const record = await kv.get<Obj>(`save:${player}`);
    record!.character.brokerCertificates = count;
    record!.character.ryo = count * CERTIFICATE_STAKE;
    await kv.set(`save:${player}`, record);
}

test('concurrent retries recover one crate, one certificate debit and one counted pull', async () => {
    await certificates(1);
    const options = { payment: 'certificate', requestId: requestId('concurrent') };
    const results = await Promise.all([call('POST', options), call('POST', options)]);
    for (const result of results) assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(results[0].body.reward, results[1].body.reward);
    assert.equal(results.filter(result => result.body.replayed).length, 1);
    const stored = await kv.get<Obj>(`save:${player}`);
    assert.equal(stored!.character.brokerCertificates, 0);
    assert.equal(stored!.character.brokerCrateLedger.used, 1);
    assert.equal(stored!.character.brokerCrateLedger.receipts.length, 1);
    assert.equal((await call('GET')).body.dailyUsed, 1);
    const replay = await call('POST', options);
    assert.equal(replay.body.character.brokerCertificates, 0);
    assert.equal(replay.body._saveVersion, stored!._saveVersion);
    assert.equal((await call('POST', { ...options, payment: 'ryo' })).status, 409);
});

test('distinct simultaneous requests cannot spend the same last certificate', async () => {
    await certificates(1);
    const results = await Promise.all(['first', 'second'].map(suffix => call('POST', { payment: 'certificate', requestId: requestId(suffix) })));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
    const stored = await kv.get<Obj>(`save:${player}`);
    assert.equal(stored!.character.brokerCertificates, 0);
    assert.equal(stored!.character.brokerCrateLedger.used, 1);
});

test('a failed compatibility counter write cannot lose a pull or exceed the daily cap', async () => {
    await certificates(2);
    await kv.set(`bm:count:${player}:${today()}`, 9);
    const original = kv.set;
    kv.set = (async (...args: Parameters<typeof original>) => {
        if (String(args[0]).startsWith('bm:count:')) throw new Error('counter mirror unavailable');
        return original.apply(kv, args);
    }) as typeof original;
    let pull: Awaited<ReturnType<typeof call>>;
    try { pull = await call('POST', { payment: 'certificate', requestId: requestId('mirror_failure') }); }
    finally { kv.set = original; }
    assert.equal(pull!.status, 200, JSON.stringify(pull!.body));
    assert.equal(pull!.body.dailyUsed, 10);
    assert.equal((await call('GET')).body.dailyUsed, 10);
    assert.equal((await call('POST', { payment: 'certificate' })).status, 429);
    assert.equal((await kv.get<Obj>(`save:${player}`))!.character.brokerCertificates, 1);
});

test('a lost save acknowledgement and unavailable readback recover the committed crate on retry', async () => {
    await certificates(1);
    const originalCas = kv.compareSetMany!, originalGet = kv.get;
    let committed = false, readbackFailed = false;
    kv.compareSetMany = (async (...args: Parameters<typeof originalCas>) => {
        const result = await originalCas.apply(kv, args);
        if (result && !committed) { committed = true; throw new Error('lost save acknowledgement'); }
        return result;
    }) as typeof originalCas;
    kv.get = (async (...args: Parameters<typeof originalGet>) => {
        if (committed && !readbackFailed && args[0] === `save:${player}`) { readbackFailed = true; throw new Error('readback unavailable'); }
        return originalGet.apply(kv, args);
    }) as typeof originalGet;
    const options = { payment: 'certificate', requestId: requestId('lost_reply') };
    let first: Awaited<ReturnType<typeof call>>;
    try { first = await call('POST', options); }
    finally { kv.compareSetMany = originalCas; kv.get = originalGet; }
    assert.equal(first!.status, 500);
    const before = await kv.get<Obj>(`save:${player}`);
    const replay = await call('POST', options);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.dailyUsed, 1);
    assert.equal(replay.body.character.brokerCertificates, 0);
    assert.deepEqual(replay.body.reward, before!.character.brokerCrateLedger.receipts[0].reward);
    assert.deepEqual(await kv.get(`save:${player}`), before);
});

test('a definite save conflict spends neither a certificate nor a daily pull', async () => {
    await certificates(1);
    const before = await kv.get(`save:${player}`);
    const original = kv.compareSetMany;
    kv.compareSetMany = async () => false;
    const options = { payment: 'certificate', requestId: requestId('save_conflict') };
    let first: Awaited<ReturnType<typeof call>>;
    try { first = await call('POST', options); } finally { kv.compareSetMany = original; }
    assert.equal(first!.status, 503);
    assert.deepEqual(await kv.get(`save:${player}`), before);
    assert.equal((await call('GET')).body.dailyUsed, 0);
    assert.equal((await call('POST', options)).status, 200);
});

test('a request waiting for its save across UTC midnight uses the new day and replays safely', async () => {
    await certificates(1);
    now = Date.parse(`${today()}T23:59:59.999Z`);
    const oldDay = today(), options = { payment: 'certificate', requestId: requestId('midnight') };
    await kv.set(`bm:count:${player}:${oldDay}`, 10);
    const original = kv.get;
    let advanced = false;
    kv.get = (async (...args: Parameters<typeof original>) => {
        if (!advanced && args[0] === `save:${player}`) { advanced = true; now += 2; }
        return original.apply(kv, args);
    }) as typeof original;
    let pull: Awaited<ReturnType<typeof call>>;
    try { pull = await call('POST', options); } finally { kv.get = original; }
    assert.notEqual(today(), oldDay);
    assert.equal(pull!.status, 200, JSON.stringify(pull!.body));
    assert.equal(pull!.body.day, today());
    assert.equal(pull!.body.dailyUsed, 1);
    now += 86_400_000;
    const replay = await call('POST', options);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.dailyUsed, 0, 'recovering yesterday’s pull does not consume today’s allowance');
});

test('expired unrecorded requests are refused without spending anything', async () => {
    await certificates(1);
    const id = requestId('expired');
    now += 2 * 86_400_000;
    const before = await kv.get(`save:${player}`);
    assert.equal((await call('POST', { payment: 'certificate', requestId: id })).status, 409);
    assert.deepEqual(await kv.get(`save:${player}`), before);
});

test('bounded receipts retain every retry allowed today and yesterday without reopening older purchases', async () => {
    await certificates(30);
    const firstId = requestId('oldest');
    for (let dayIndex = 0; dayIndex < 3; dayIndex++) {
        if (dayIndex > 0) now += 86_400_000;
        for (let index = 0; index < 10; index++) {
            const id = dayIndex === 0 && index === 0 ? firstId : requestId(`day_${dayIndex}_pull_${index}`);
            const pull = await call('POST', { payment: 'certificate', requestId: id });
            assert.equal(pull.status, 200, JSON.stringify(pull.body));
        }
        if (dayIndex === 1) assert.equal((await call('POST', { payment: 'certificate', requestId: firstId })).body.replayed, true);
    }
    const before = await kv.get<Obj>(`save:${player}`);
    assert.equal(before!.character.brokerCrateLedger.receipts.length, 20);
    assert.equal(before!.character.brokerCertificates, 0);
    assert.equal((await call('POST', { payment: 'certificate', requestId: firstId })).status, 409);
    assert.deepEqual(await kv.get(`save:${player}`), before);
});

test('the count starts at zero and follows every pull', async () => {
    const fresh = await call('GET');
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    assert.deepEqual(fresh.body, { ok: true, dailyUsed: 0, dailyCap: 10, day: today() });

    const pull = await call('POST');
    assert.equal(pull.status, 200, JSON.stringify(pull.body));
    assert.equal(pull.body.dailyUsed, 1);
    assert.equal((await call('GET')).body.dailyUsed, 1);
});

test('the count is read-only: it changes neither the save nor the counter', async () => {
    const before = await kv.get(`save:${player}`);
    for (let i = 0; i < 3; i++) assert.equal((await call('GET')).status, 200);
    assert.deepEqual(await kv.get(`save:${player}`), before);
    assert.equal(await kv.get(`bm:count:${player}:${today()}`), null);
});

test('the count reads the same per-day key the pull enforces', async () => {
    await kv.set(`bm:count:${player}:${today()}`, 10);
    assert.equal((await call('GET')).body.dailyUsed, 10);
    const refused = await call('POST');
    assert.equal(refused.status, 429);
    assert.equal(refused.body.dailyUsed, 10);
});

test('reading the count never spends the rate limit a pull needs', async () => {
    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) limited = (await call('GET')).status === 429;
    assert.ok(limited, 'the read has a rate limit of its own');
    const pull = await call('POST');
    assert.equal(pull.status, 200, JSON.stringify(pull.body));
});

test('certificate and ryo purchases share the daily cap and certificates survive the UTC reset', async () => {
    const record = await kv.get<Obj>(`save:${player}`);
    record!.character.brokerCertificates = 2;
    await kv.set(`save:${player}`, record);
    await kv.set(`bm:count:${player}:${today()}`, 8);
    assert.equal((await call('POST')).body.dailyUsed, 9);
    const before = await kv.get<Obj>(`save:${player}`);
    const half = await call('POST', { payment: 'certificate' });
    assert.equal(half.status, 200, JSON.stringify(half.body));
    assert.equal(half.body.cost, CERTIFICATE_STAKE);
    assert.equal(half.body.dailyUsed, 10);
    assert.equal(half.body.character.brokerCertificates, 1);
    assert.equal(half.body.character.ryo, before!.character.ryo - CERTIFICATE_STAKE + half.body.reward.ryo);
    assert.equal((await call('GET')).body.dailyUsed, 10);
    const saved = await kv.get(`save:${player}`);
    assert.equal((await call('POST', { payment: 'certificate' })).status, 429);
    assert.equal((await call('POST')).status, 429);
    assert.deepEqual(await kv.get(`save:${player}`), saved);
    now += 86_400_000;
    const tomorrow = await call('POST', { payment: 'certificate' });
    assert.equal(tomorrow.status, 200, JSON.stringify(tomorrow.body));
    assert.equal(tomorrow.body.dailyUsed, 1);
    assert.equal(tomorrow.body.character.brokerCertificates, 0);
});

test('missing certificates and unsupported payment methods cannot award a crate or charge a stake', async () => {
    const before = await kv.get(`save:${player}`);
    for (const payment of ['certificate', 'free', '', false, null]) {
        const result = await call('POST', { payment });
        assert.equal(result.status, 400, JSON.stringify(result.body));
        assert.deepEqual(await kv.get(`save:${player}`), before);
        assert.equal((await call('GET')).body.dailyUsed, 0);
    }
});

test('a certificate pull without its half stake keeps the certificate and the daily pull', async () => {
    await certificates(1);
    const record = await kv.get<Obj>(`save:${player}`);
    record!.character.ryo = CERTIFICATE_STAKE - 1;
    await kv.set(`save:${player}`, record);
    const result = await call('POST', { payment: 'certificate', requestId: requestId('short_stake') });
    assert.equal(result.status, 400);
    assert.match(String(result.body.error), /certificate crate costs 37,500/);
    assert.deepEqual(await kv.get(`save:${player}`), record);
    assert.equal((await call('GET')).body.dailyUsed, 0);
});

test('a refusal returns the current balance without writing so a stale device can reconcile', async () => {
    await certificates(0);
    const before = await kv.get<Obj>(`save:${player}`);
    const result = await call('POST', { payment: 'certificate', requestId: requestId('stale_device') });
    assert.equal(result.status, 400);
    assert.equal(result.body.character.brokerCertificates, 0);
    assert.equal(result.body._saveVersion, before!._saveVersion);
    assert.deepEqual(await kv.get(`save:${player}`), before);
});
