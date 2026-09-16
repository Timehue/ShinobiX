import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

test('shared game-state batches both collections once, shares concurrent builds, and preserves ETags', async t => {
    const { kv } = await import('./_storage.js');
    const { WAR_VILLAGES } = await import('./_war-map-sectors.js');
    const { leadershipVillageKey } = await import('../shared/village-anbu.js');
    const { __clearProcCache } = await import('./_proc-cache.js');
    const handler = (await import('./game-state.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    __clearProcCache();
    t.after(__clearProcCache);
    await kv.set('game:village-state:leaf', { treasury: { ryo: 9 } });
    await kv.set('game:clan-pet-battle:fox', { id: 'battle-1' });
    // This measures stable read caching, not first-use election migration.
    // Initializing a council deliberately invalidates an in-flight frame.
    for (const slug of ['leaf', ...WAR_VILLAGES.map(leadershipVillageKey)]) {
        await kv.set(`village:elder-council:${slug}`, {
            version: 1, startedAt: Date.now(), nextSelectionAt: Date.now() + 86400000,
            seats: ['', '', ''], winningScores: [0, 0],
        });
    }
    const original = kv.mget.bind(kv);
    const batch = t.mock.method(kv, 'mget', (...keys: string[]) => original(...keys));
    function response() {
        const out = { status: 200, headers: {} as Record<string, string>, body: undefined as unknown };
        const res = {
            setHeader: (key: string, value: string) => { out.headers[key] = value; return res; },
            status: (code: number) => { out.status = code; return res; },
            json: (value: unknown) => { out.body = value; return res; },
            end: () => res,
        };
        return { out, res };
    }
    const replies = Array.from({ length: 12 }, response);
    await Promise.all(replies.map(({ res }) => handler({ method: 'GET', query: {}, headers: {} } as never, res as never)));
    assert.equal(batch.mock.callCount(), 1);
    assert.deepEqual(new Set(batch.mock.calls[0].arguments), new Set(['game:village-state:leaf', 'game:clan-pet-battle:fox', 'village:kage:leaf', ...WAR_VILLAGES.flatMap(village => [`game:village-state:${leadershipVillageKey(village)}`, `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`])]));
    const defaults = Object.fromEntries(await Promise.all(WAR_VILLAGES.map(async village => {
        const slug = leadershipVillageKey(village);
        return [slug, { seatedKage: undefined, firstLiberator: undefined, kageSystemUnlocked: false,
            elderAppointees: ['', '', ''], elderTerm: await kv.get(`village:elder-council:${slug}`),
            anbuAppointees: ['', '', ''], anbuEarned: [], anbuMembers: [] }];
    })));
    for (const { out } of replies) {
        assert.equal(out.status, 200);
        assert.deepEqual(out.body, {
            villageStates: { ...defaults, leaf: { treasury: { ryo: 9 }, seatedKage: undefined, firstLiberator: undefined, kageSystemUnlocked: false, elderAppointees: ['', '', ''], elderTerm: await kv.get('village:elder-council:leaf'), anbuAppointees: ['', '', ''], anbuEarned: [], anbuMembers: [] } },
            clanPetBattles: { fox: { id: 'battle-1' } },
            arenaTournament: null, arenaActiveFights: [], weeklyBossAiId: null, dojoCircuitEnabled: false,
        });
    }
    const same = response();
    await handler({ method: 'GET', query: {}, headers: { 'if-none-match': replies[0].out.headers.ETag } } as never, same.res as never);
    assert.equal(same.out.status, 304);
    assert.equal(same.out.body, undefined);
    assert.equal(batch.mock.callCount(), 1);
});

test('shared frame uses fresh projected membership for moved/deleted leaders and fills the next earned seat', async t => {
    const { kv } = await import('./_storage.js');
    const { projectKvValue } = await import('./_storage-projection.js');
    const { buildPublicPlayerIndexEntry } = await import('./player/_public-index.js');
    const { WAR_VILLAGES } = await import('./_war-map-sectors.js');
    const { leadershipVillageKey } = await import('../shared/village-anbu.js');
    const { __clearProcCache } = await import('./_proc-cache.js');
    const handler = (await import('./game-state.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    __clearProcCache();
    t.after(__clearProcCache);
    const village = WAR_VILLAGES[0];
    const slug = leadershipVillageKey(village);
    const now = Date.UTC(2026, 8, 16, 12);
    t.mock.method(Date, 'now', () => now);
    const saves: Record<string, unknown> = {};
    const registry: Record<string, unknown> = {};
    for (let i = 0; i < 9; i++) {
        const name = `candidate${i}`;
        const character = { name, village, monthlyPvpKills: 20 - i, pvpKillMonth: '2026-09' };
        registry[name] = buildPublicPlayerIndexEntry(character, name, now);
        if (i !== 1) saves[`save:${name}`] = { character: { ...character, village: i === 0 ? WAR_VILLAGES[1] : village }, private: 'never transferred' };
    }
    saves['save:appointed'] = { character: { village }, private: 'never transferred' };
    await kv.hset('player:registry', registry);
    await kv.set(`game:village-state:${slug}`, { anbuAppointees: ['appointed', 'candidate0', 'candidate1'] });
    for (const name of WAR_VILLAGES) await kv.set(`village:elder-council:${leadershipVillageKey(name)}`, {
        version: 1, startedAt: now - 1000, nextSelectionAt: now + 86400000,
        seats: name === village ? ['appointed', 'candidate0', 'candidate1'] : ['', '', ''], winningScores: [1, 1],
    });
    const originalGet = kv.get.bind(kv);
    t.mock.method(kv, 'get', async (key: string) => {
        assert.ok(!key.startsWith('save:'), 'valid membership must not download a full save');
        return originalGet(key);
    });
    const batches: string[][] = [];
    kv.mgetProjected = async (batch, projection) => {
        batches.push(batch);
        assert.deepEqual(projection, { village: ['character', 'village'] });
        return batch.map(key => projectKvValue(saves[key], projection));
    };
    t.after(() => { delete kv.mgetProjected; });
    async function frame() {
        let body: { villageStates: Record<string, { elderAppointees: string[]; anbuAppointees: string[]; anbuEarned: string[] }> } | undefined;
        let status = 200;
        const res = { setHeader() {}, status(code: number) { status = code; return this; }, json(value: typeof body) { body = value; return this; }, end() {} };
        await handler({ method: 'GET', query: {}, headers: {} } as never, res as never);
        assert.equal(status, 200);
        return body!.villageStates[slug];
    }
    const first = await frame();
    assert.deepEqual(first.elderAppointees, ['appointed', '', '']);
    assert.deepEqual(first.anbuAppointees, ['appointed', '', '']);
    assert.deepEqual(first.anbuEarned, Array.from({ length: 7 }, (_, index) => `candidate${index + 2}`));
    assert.ok(batches.some(batch => batch.length === 7), 'earned validation remains bounded and batched');
    saves['save:appointed'] = { character: { village: WAR_VILLAGES[1] } };
    delete saves['save:candidate2'];
    __clearProcCache();
    const second = await frame();
    assert.deepEqual(second.elderAppointees, ['', '', '']);
    assert.deepEqual(second.anbuAppointees, ['', '', '']);
    assert.deepEqual(second.anbuEarned, Array.from({ length: 6 }, (_, index) => `candidate${index + 3}`));
    assert.ok(!JSON.stringify(second).includes('never transferred'));
});
