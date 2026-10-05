import { before, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ENABLE_LEGACY = '1';
delete process.env.DISCORD_ANNOUNCE_WEBHOOK_URL;
let kv: typeof import('./_storage.js').kv;
let era: typeof import('./_era.js');
before(async () => { kv = (await import('./_storage.js')).kv; era = await import('./_era.js'); });
async function reset() {
    for (const key of await kv.keys('*')) await kv.del(key);
    await kv.set('game:era-state', { overrides: { 'mythic-legacies': { status: 'unlocked', unlockedBy: 'EraFinisher', unlockedAt: 100 } } });
    await kv.set('save:EraFinisher', { character: { name: 'EraFinisher', serverTitles: [], earnedTitles: [] } });
}
for (const destination of ['game:announcements', 'hall:entries', 'save:EraFinisher', 'chat:village:stormveil-village']) {
    test(`failed ${destination} remains recoverable without duplicate history or credit`, async t => {
        await reset();
        const original = kv.set.bind(kv);
        const patch = t.mock.method(kv, 'set', async (key: string, value: unknown, opts?: Parameters<typeof kv.set>[2]) => {
            if (key === destination) throw new Error('injected-era-delivery-failure');
            return original(key, value, opts);
        });
        await era.checkEraUnlocks();
        assert.equal(await kv.get('era:effects-done:mythic-legacies'), null);
        patch.mock.restore();
        await era.checkEraUnlocks();
        await era.checkEraUnlocks();
        assert.equal(await kv.get('era:effects-done:mythic-legacies'), true);
        const feed = await kv.get<any[]>('game:announcements');
        const hall = await kv.get<any[]>('hall:entries');
        const finisher = await kv.get<any>('save:EraFinisher');
        assert.equal(feed?.length, 1);
        assert.equal(hall?.length, 1);
        assert.deepEqual(finisher.character.serverTitles, ['Herald of the Mythic Age']);
        const state = await era.getEraState();
        assert.equal(state.overrides['mythic-legacies'].unlockedAt, 100);
        for (const village of ['stormveil', 'ashen-leaf', 'frostfang', 'moonshadow']) {
            assert.equal((await kv.get<any[]>(`chat:village:${village}-village`))?.length, 1);
        }
    });
}

test('legacy preclaimed announcement marker cannot suppress missing delivery', async () => {
    await reset();
    await kv.set('era:announced:mythic-legacies', '1');
    await era.checkEraUnlocks();
    assert.equal((await kv.get<any[]>('game:announcements'))?.length, 1);
    assert.equal(await kv.get('era:effects-done:mythic-legacies'), true);
});

for (const destination of ['save:EraFinisher', 'era:effects-done:mythic-legacies']) {
    test(`an unconfirmed ${destination} write cannot mark delivery complete`, async t => {
        await reset();
        const original = kv.set.bind(kv);
        const patch = t.mock.method(kv, 'set', async (key: string, value: unknown, opts?: Parameters<typeof kv.set>[2]) => {
            return key === destination ? null : original(key, value, opts);
        });
        await era.checkEraUnlocks();
        assert.equal(await kv.get('era:effects-done:mythic-legacies'), null);
        patch.mock.restore();
        await era.checkEraUnlocks();
        assert.equal(await kv.get('era:effects-done:mythic-legacies'), true);
        assert.equal((await kv.get<any[]>('game:announcements'))?.length, 1);
        assert.deepEqual((await kv.get<any>('save:EraFinisher')).character.serverTitles, ['Herald of the Mythic Age']);
    });
}

test('a rejected world-state write cannot claim an unlock or emit its effects', async t => {
    await reset();
    await kv.set('game:era-state', { overrides: { 'mythic-legacies': { status: 'milestone_active' } } });
    const original = kv.set.bind(kv);
    const patch = t.mock.method(kv, 'set', async (key: string, value: unknown, opts?: Parameters<typeof kv.set>[2]) => key === 'game:era-state' ? null : original(key, value, opts));
    const def = era.ERA_BY_ID.get('mythic-legacies')!;
    await assert.rejects(era.unlockEra(def, { player: 'EraFinisher', ts: 100 }, 'milestone'), /not committed/);
    assert.equal(await kv.get('game:announcements'), null);
    assert.equal((await era.getEraState()).overrides['mythic-legacies'].status, 'milestone_active');
    patch.mock.restore();
    assert.equal(await era.unlockEra(def, { player: 'EraFinisher', ts: 100 }, 'milestone'), true);
    assert.equal(await era.currentEraNumber(), 5);
});

test('unavailable world authority cannot invent status, a birth era or a finisher', async t => {
    await reset();
    const stored = await kv.get('game:era-state');
    const original = kv.get.bind(kv);
    const patch = t.mock.method(kv, 'get', async (key: string) => {
        if (key === 'game:era-state') throw new Error('injected-era-state-read-failure');
        return original(key);
    });
    await assert.rejects(era.getEraViews(), /state-read-failure/);
    await assert.rejects(era.currentEraNumber(), /state-read-failure/);
    assert.equal(await era.recordEraTrigger('first-mythic-awakening', { player: 'Unverified' }), false);
    assert.deepEqual(await era.checkEraUnlocks(), []);
    patch.mock.restore();
    assert.deepEqual(await kv.get('game:era-state'), stored);
    assert.equal(await kv.get('era:trigger:mythic-legacies'), null);
    assert.equal(await kv.get('game:announcements'), null);
});

test('damaged override authority is rejected instead of resetting to launch defaults', async () => {
    await reset();
    for (const state of [{ overrides: [] }, { overrides: { 'mythic-legacies': null } },
        { overrides: { 'mythic-legacies': { status: 'unknown' } } },
        { overrides: { 'mythic-legacies': { milestoneOverrides: { missions: -1 } } } }]) {
        await kv.set('game:era-state', state);
        await assert.rejects(era.getEraState(), /Invalid era/);
        await assert.rejects(era.currentEraNumber(), /Invalid era/);
    }
});

test('a lost trigger write retries without losing the first credited finisher', async t => {
    await reset();
    await kv.set('game:era-state', { overrides: {} });
    const original = kv.set.bind(kv);
    const patch = t.mock.method(kv, 'set', async (key: string, value: unknown, opts?: Parameters<typeof kv.set>[2]) => key === 'era:trigger:mythic-legacies' ? null : original(key, value, opts));
    assert.equal(await era.recordEraTrigger('first-mythic-awakening', { player: 'EraFinisher' }), false);
    assert.equal(await kv.get('era:trigger:mythic-legacies'), null);
    patch.mock.restore();
    assert.equal(await era.recordEraTrigger('first-mythic-awakening', { player: 'EraFinisher' }), true);
    assert.equal(await era.recordEraTrigger('first-mythic-awakening', { player: 'LaterFinisher' }), true);
    const def = era.ERA_BY_ID.get('mythic-legacies')!;
    for (const milestone of def.milestones) await kv.set(`era:contrib:${milestone.metric}`, milestone.required);
    assert.deepEqual(await era.checkEraUnlocks(), ['mythic-legacies']);
    assert.equal((await era.getEraState()).overrides['mythic-legacies'].unlockedBy, 'EraFinisher');
    assert.equal(await era.currentEraNumber(), 5);
    await era.checkEraUnlocks();
    assert.equal((await kv.get<any[]>('hall:entries'))?.length, 1);
});

test('an unfinished title delivery repairs the earned list without duplicating its server vault', async () => {
    await reset();
    await kv.set('save:EraFinisher', { _saveVersion: 1, character: { name: 'EraFinisher', serverTitles: ['Herald of the Mythic Age'], earnedTitles: [] } });
    await era.checkEraUnlocks();
    const saved = await kv.get<any>('save:EraFinisher');
    assert.deepEqual(saved.character.serverTitles, ['Herald of the Mythic Age']);
    assert.deepEqual(saved.character.earnedTitles, ['Herald of the Mythic Age']);
    await era.checkEraUnlocks();
    assert.deepEqual(await kv.get('save:EraFinisher'), saved);
});
