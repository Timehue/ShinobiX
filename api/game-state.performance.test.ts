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
