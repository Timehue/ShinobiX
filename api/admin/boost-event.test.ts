import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'boost-test-full';
process.env.ADMIN_CONTENT_PASSWORD = 'boost-test-content';
process.env.SESSION_SECRET = 'boost-test-session-secret-at-least-32-characters';

let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./boost-event.js').default;
let store: typeof import('../_boost-event.js');
let clearCache: () => void;

const full = { 'x-admin-password': 'boost-test-full' };
const content = { 'x-admin-password': 'boost-test-content' };

async function request(body?: Record<string, unknown>, headers: Record<string, string> = full) {
    const out = { status: 200, body: {} as any };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: unknown) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: body ? 'POST' : 'GET', body, headers, query: {}, socket: { remoteAddress: '127.0.0.92' } } as never, res as never);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./boost-event.js')).default as unknown as typeof handler;
    store = await import('../_boost-event.js');
    ({ __clearProcCache: clearCache } = await import('../_proc-cache.js'));
});

let clockWindow = 0;
beforeEach(async (context) => {
    if (!('mock' in context)) throw new Error('needs a per-test clock');
    // Fresh rate-limit window per test without weakening production limits.
    context.mock.timers.enable({ apis: ['Date'], now: Date.now() + (++clockWindow) * 60_001 });
    await kv.del(store.BOOST_EVENT_KEY);
    clearCache();
});

test('only a full admin can read or change the boost event', async () => {
    assert.equal((await request(undefined, {})).status, 403);
    assert.equal((await request({ action: 'start', multiplier: 2, targets: ['training'], hours: 6 }, content)).status, 403);
    assert.equal(await kv.get(store.BOOST_EVENT_KEY), null);
});

test('start → active for every reader → stop', async () => {
    const started = await request({ action: 'start', multiplier: 2, targets: ['training', 'growth'], hours: 6 });
    assert.equal(started.status, 200);
    assert.equal(started.body.event.multiplier, 2);
    assert.equal(started.body.event.endsAt - started.body.event.startsAt, 6 * 3_600_000);

    assert.equal(await store.boostMultiplier('training'), 2);
    assert.equal(await store.boostMultiplier('growth'), 2);
    assert.equal(await store.boostMultiplier('jutsu'), 1);

    const read = await request();
    assert.equal(read.body.active, true);

    const stopped = await request({ action: 'stop' });
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.stopped.id, started.body.event.id);
    assert.equal(await store.boostMultiplier('training'), 1);
    assert.equal((await request()).body.event, null);
});

test('the event switches itself off at endsAt', async (context) => {
    await request({ action: 'start', multiplier: 1.5, targets: ['jutsu'], hours: 1 });
    assert.equal(await store.boostMultiplier('jutsu'), 1.5);
    context.mock.timers.tick(3_600_000);
    clearCache();
    assert.equal(await store.boostMultiplier('jutsu'), 1);
    assert.equal((await request()).body.active, false);
});

test('out-of-range requests are refused, not clamped', async () => {
    for (const body of [
        { action: 'start', multiplier: 3, targets: ['training'], hours: 6 },
        { action: 'start', multiplier: 2, targets: ['training'], hours: 100 },
        { action: 'start', multiplier: 2, targets: [], hours: 6 },
        { action: 'start', multiplier: 2, targets: ['ryo'], hours: 6 },
        { action: 'explode' },
    ]) {
        assert.equal((await request(body)).status, 400, JSON.stringify(body));
    }
    assert.equal(await kv.get(store.BOOST_EVENT_KEY), null);
});

test('a real training start seals the boosted gain while a training event runs', async () => {
    const start = (await import('../training/start.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    const trainOnce = async (name: string) => {
        await kv.set(`save:${name}`, { _saveVersion: 1, character: {
            name, level: 1, stamina: 100, unspentStats: 0, totalStatsTrained: 0,
            stats: { strength: 10, speed: 10, intelligence: 10, willpower: 10 },
        } });
        const out = { status: 200, body: {} as any };
        const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: unknown) { out.body = value; return res; }, end() { return res; } };
        await start({ method: 'POST', body: { playerName: name, stat: 'strength', tierId: '1h' }, query: {},
            headers: { 'x-admin-password': 'boost-test-full' }, socket: { remoteAddress: '127.0.0.94' } } as never, res as never);
        assert.equal(out.status, 200, JSON.stringify(out.body));
        const saved = await kv.get<{ activeTraining?: { statGain?: number; xp?: number } }>(`save:${name}`);
        return saved?.activeTraining ?? {};
    };
    const plain = await trainOnce('boosttrainplain');
    await request({ action: 'start', multiplier: 2, targets: ['training'], hours: 1 });
    const boosted = await trainOnce('boosttrainboosted');
    assert.ok((plain.statGain ?? 0) > 0);
    assert.equal(boosted.statGain, Math.round((plain.statGain ?? 0) * 2));
    assert.equal(boosted.xp, plain.xp, 'the retired sealed XP field is never boosted');
});

test('every other grant site applies its boost (source pins)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = (...p: string[]) => readFileSync(join(process.cwd(), 'api', ...p), 'utf8');
    // Jutsu lessons: both a started and a queued lesson take the boosted time.
    const jutsu = src('training', 'jutsu-ryo.ts');
    assert.match(jutsu, /boostMultiplier\('jutsu'\)/);
    assert.equal(jutsu.match(/jutsuMorale\.jutsuTimeMult \/ jutsuEventBoost/g)?.length, 2, 'start and queue');
    // Daily checklist growth, as its own factor after the aggregate cap.
    const missions = src('missions', 'claim-mission.ts');
    assert.match(missions, /boostMultiplier\('growth'\)/);
    assert.match(missions, /combinedStatBoost\(bonusPct \+ huntRankBonusPct\) \* growthEventBoost/);
    // Casual PvP win growth, judged at the battle's end.
    const pvp = src('pvp', 'claim-rewards.ts');
    assert.match(pvp, /boostMultiplier\('growth', rewardEventAt\)/);
    assert.match(pvp, /statGainMultiplier\(\) \* growthEventBoost/);
    // Training (proven end to end above) reads it once, outside the save lock.
    const training = src('training', 'start.ts');
    assert.ok(training.indexOf("boostMultiplier('training'") < training.indexOf('withKvLock(saveKey'), 'read before the save lock');
});

test('a corrupt stored row boosts nothing', async () => {
    await kv.set(store.BOOST_EVENT_KEY, { multiplier: 50, targets: ['training'], startsAt: 0, endsAt: Number.MAX_SAFE_INTEGER });
    clearCache();
    assert.equal(await store.boostMultiplier('training'), 1);
});
