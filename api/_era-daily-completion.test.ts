import { before, beforeEach, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ENABLE_LEGACY = '1';
process.env.DISABLE_SNAPSHOT_CRON = '1';
delete process.env.DISCORD_ANNOUNCE_WEBHOOK_URL;
let kv: typeof import('./_storage.js').kv;
let era: typeof import('./_era.js');
let scheduler: typeof import('./cron/_scheduler.js');
const eraId = 'mythic-legacies';
const doneKey = `era:effects-done:${eraId}`;
before(async () => {
    ({ kv } = await import('./_storage.js'));
    era = await import('./_era.js');
    scheduler = await import('./cron/_scheduler.js');
});
beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    await kv.set('game:era-state', { overrides: { [eraId]: { status: 'unlocked', unlockedBy: 'erafinisher', unlockedAt: 100 } } });
    await kv.set('save:erafinisher', { character: { name: 'erafinisher', serverTitles: [], earnedTitles: [] } });
});

function injectFailure(t: TestContext, kind: string) {
    if (kind === 'contribution read') {
        const mget = kv.mget.bind(kv);
        return t.mock.method(kv, 'mget', async (...keys: string[]) => {
            if (keys.some(key => key.startsWith('era:contrib:'))) throw new Error('injected-era-contribution-read');
            return mget(...keys);
        });
    }
    if (kind === 'title grant refusal') {
        const compareSet = kv.compareSet.bind(kv);
        return t.mock.method(kv, 'compareSet', async (key: string, expected: unknown, value: unknown, opts?: Parameters<typeof kv.compareSet>[3]) => {
            if (key === 'save:erafinisher') return false;
            return compareSet(key, expected, value, opts);
        });
    }
    if (kind === 'unconfirmed effects receipt') {
        const set = kv.set.bind(kv);
        return t.mock.method(kv, 'set', async (key: string, value: unknown, opts?: Parameters<typeof kv.set>[2]) => {
            if (key === doneKey) return null;
            return set(key, value, opts);
        });
    }
    const get = kv.get.bind(kv);
    return t.mock.method(kv, 'get', async (key: string) => {
        if (key === (kind === 'state read' ? era.ERA_STATE_KEY : doneKey)) throw new Error(`injected-era-${kind}`);
        return get(key);
    });
}

for (const kind of ['state read', 'contribution read', 'effects receipt read', 'title grant refusal', 'unconfirmed effects receipt']) {
    test(`era ${kind} failure cannot publish daily completion or retain its success lease`, async t => {
        const now = Date.UTC(2026, 10, 8, 9);
        t.mock.timers.enable({ apis: ['Date'], now });
        const fault = injectFailure(t, kind);
        assert.equal(await scheduler.fireDailyPassCatchUp(now), true);
        assert.equal(await kv.get(scheduler.dailyPassMarkerKey(now)), null, 'an incomplete era pass must not mark the whole pass complete');
        assert.equal(await kv.get('cron:lease:era-daily'), null, 'reported failure releases only the era success-dedupe lease');
        assert.ok(await kv.get('cron:lease:ranked-rollover'), 'other successful jobs retain their existing dedupe leases');
        fault.mock.restore();
        const repaired = await era.runEraDailyPass();
        assert.equal(repaired.complete, true);
        assert.equal(await kv.get(doneKey), true);
        assert.equal((await era.runEraDailyPass()).complete, true, 'already completed effects are successful no-ops');
        const feed = await kv.get<Array<{ meta?: { eraId?: string } }>>('game:announcements');
        const hall = await kv.get<Array<{ meta?: { eraId?: string } }>>('hall:entries');
        assert.equal(feed?.filter(entry => entry.meta?.eraId === eraId).length, 1);
        assert.equal(hall?.filter(entry => entry.meta?.eraId === eraId).length, 1);
        const saved = await kv.get<{ character: { serverTitles: string[] } }>('save:erafinisher');
        assert.deepEqual(saved?.character.serverTitles, ['Herald of the Mythic Age']);
    });
}

test('a newly unlocked era is incomplete until its effects receipt commits', async t => {
    await kv.set(era.ERA_STATE_KEY, { overrides: { [eraId]: { status: 'milestone_active' } } });
    const def = era.ERA_BY_ID.get(eraId)!;
    for (const milestone of def.milestones) await kv.set(`era:contrib:${milestone.metric}`, milestone.required);
    await kv.set(`era:trigger:${eraId}`, { player: 'erafinisher', ts: 100 });
    const fault = injectFailure(t, 'unconfirmed effects receipt');
    const result = await era.runEraDailyPass();
    assert.deepEqual(result.unlocked, [eraId], 'the committed transition is still reported');
    assert.equal(result.complete, false, 'a transition alone does not prove effect delivery');
    assert.equal(await kv.get(doneKey), null);
    fault.mock.restore();
    assert.deepEqual(await era.runEraDailyPass(), { enabled: true, unlocked: [], complete: true });
    assert.equal(await kv.get(doneKey), true);
    assert.equal((await kv.get<unknown[]>('game:announcements'))?.length, 1);
});

test('unmet milestones and disabled eras are successful no-op passes', async t => {
    await kv.set(era.ERA_STATE_KEY, { overrides: {} });
    assert.deepEqual(await era.runEraDailyPass(), { enabled: true, unlocked: [], complete: true });
    process.env.ENABLE_LEGACY = '0';
    try {
        t.mock.method(kv, 'get', async () => { throw new Error('disabled eras must not read storage'); });
        assert.deepEqual(await era.runEraDailyPass(), { enabled: false, unlocked: [], complete: true });
    } finally { process.env.ENABLE_LEGACY = '1'; }
});

test('healthy era delivery permits daily completion and retains its success lease', async t => {
    const now = Date.UTC(2026, 10, 8, 9);
    t.mock.timers.enable({ apis: ['Date'], now });
    assert.equal(await scheduler.fireDailyPassCatchUp(now), true);
    assert.equal(await kv.get(doneKey), true);
    assert.equal((await kv.get<{ completedAt: number }>(scheduler.dailyPassMarkerKey(now)))?.completedAt, now);
    assert.ok(await kv.get('cron:lease:era-daily'));
});

test('effects completed by another caller during the scan are healthy', async t => {
    const get = kv.get.bind(kv);
    let raced = false;
    t.mock.method(kv, 'get', async (key: string) => {
        if (key === doneKey && !raced) {
            raced = true;
            await kv.set(doneKey, true);
            return null;
        }
        return get(key);
    });
    assert.deepEqual(await era.runEraDailyPass(), { enabled: true, unlocked: [], complete: true });
    assert.equal(raced, true);
});
