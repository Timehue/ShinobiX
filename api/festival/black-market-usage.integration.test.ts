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

async function call(method: 'GET' | 'POST', options: { as?: string; unauth?: boolean } = {}) {
    const output: { status: number; body: Obj } = { status: 200, body: {} };
    const res = { setHeader() { return this; }, status(code: number) { output.status = code; return this; }, json(data: Obj) { output.body = data; return this; }, end() { return this; } };
    const as = options.as ?? player;
    await blackMarket({
        method,
        query: method === 'GET' ? { playerName: player } : {},
        body: method === 'POST' ? { playerName: player } : undefined,
        headers: options.unauth ? {} : { 'x-player-name': as, 'x-player-token': issue(as)! },
        socket: { remoteAddress: `127.0.1.${ip}` },
    } as never, res as never);
    return output;
}

test('the count read needs a signed session for the same player', async () => {
    assert.equal((await call('GET', { unauth: true })).status, 401);
    assert.equal((await call('GET', { as: 'someone-else' })).status, 403);
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
