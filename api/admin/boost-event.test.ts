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

async function startTraining(name: string, tierId: string, character: Record<string, unknown> = {}) {
    const start = (await import('../training/start.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    await kv.set(`save:${name}`, { _saveVersion: 1, character: {
        name, level: 1, stamina: 100, unspentStats: 0, totalStatsTrained: 0,
        stats: { strength: 10, speed: 10, intelligence: 10, willpower: 10 }, ...character,
    } });
    const out = { status: 200, body: {} as any };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: unknown) { out.body = value; return res; }, end() { return res; } };
    await start({ method: 'POST', body: { playerName: name, stat: 'strength', tierId }, query: {},
        headers: { 'x-admin-password': 'boost-test-full' }, socket: { remoteAddress: '127.0.0.95' } } as never, res as never);
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const saved = await kv.get<{ activeTraining?: { statGain?: number } }>(`save:${name}`);
    return saved?.activeTraining?.statGain;
}

test('TRAINING_RATE_TABLE=legacy is the no-deploy rollback for new 8h starts', async () => {
    const { rookieStatMultiplier } = await import('../_training-config.js');
    const rookie = rookieStatMultiplier(1); // the fixture's ledger level
    const previous = process.env.TRAINING_RATE_TABLE;
    try {
        delete process.env.TRAINING_RATE_TABLE;
        assert.equal(await startTraining('ratetablev2', '8h'), Math.round(65 * rookie));
        process.env.TRAINING_RATE_TABLE = 'legacy';
        assert.equal(await startTraining('ratetablelegacy', '8h'), Math.round(72 * rookie));
        process.env.TRAINING_RATE_TABLE = 'v3-typo';
        assert.equal(await startTraining('ratetabletypo', '8h'), Math.round(65 * rookie), 'an unknown value reads as v2');
    } finally {
        if (previous === undefined) delete process.env.TRAINING_RATE_TABLE; else process.env.TRAINING_RATE_TABLE = previous;
    }
});

test('a rallying village seals the morale-scaled gain the Training preview shows', async () => {
    const { earnedForLevel, levelForEarned } = await import('../_xp-engine.js');
    const { TRAINING_TIERS, previewTrainingGain } = await import('../../shinobij.client/src/lib/training-config.js');
    const village = 'Stormveil Village';
    await kv.set('game:village-state:stormveilvillage', { warLossDebuffUntil: Date.now() + 3_600_000 });
    try {
        const ledger = { level: 40, unspentStats: earnedForLevel(40), village };
        const ledgerLevel = levelForEarned(earnedForLevel(40));
        const eightHour = TRAINING_TIERS.find((tier) => tier.id === '8h')!;
        const preview = (eventBoost: number) => previewTrainingGain({
            tier: eightHour, bonusPct: 0, ledgerLevel, eraDial: 1, moraleXpMult: 1.1, eventBoost,
        });
        const rallying = await startTraining('moralerally', '8h', ledger);
        assert.equal(rallying, 72, '65 × 1.1 = 71.5 → 72');
        assert.equal(rallying, preview(1));
        await request({ action: 'start', multiplier: 2, targets: ['training'], hours: 1 });
        const rallyingEvent = await startTraining('moralerallyevent', '8h', ledger);
        assert.equal(rallyingEvent, 143, '65 × 1.1 × 2 = 143');
        assert.equal(rallyingEvent, preview(2));
    } finally {
        await kv.del('game:village-state:stormveilvillage');
    }
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
    // Casual PvP win growth, judged at the battle's end: the event scales the
    // request before the 18/day budget; the era dial never applies (I-12).
    const pvp = src('pvp', 'claim-rewards.ts');
    assert.match(pvp, /boostMultiplier\('growth', rewardEventAt\)/);
    assert.match(pvp, /PVP_CASUAL_STAT_POINTS_PER_WIN \* growthEventBoost/);
    assert.ok(
        pvp.indexOf('PVP_CASUAL_STAT_POINTS_PER_WIN * growthEventBoost') < pvp.indexOf('reserveCombatStatBudget(kv'),
        'the event scales the request, which the budget then bounds',
    );
    assert.doesNotMatch(pvp, /statGainMultiplier\(/);
    // Training (proven end to end above) reads it once, outside the save lock.
    const training = src('training', 'start.ts');
    assert.ok(training.indexOf("boostMultiplier('training'") < training.indexOf('withKvLock(saveKey'), 'read before the save lock');
});

test('a corrupt stored row boosts nothing', async () => {
    await kv.set(store.BOOST_EVENT_KEY, { multiplier: 50, targets: ['training'], startsAt: 0, endsAt: Number.MAX_SAFE_INTEGER });
    clearCache();
    assert.equal(await store.boostMultiplier('training'), 1);
});
