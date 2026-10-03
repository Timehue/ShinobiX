import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, type TestContext } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'territory-world-state-authority-test-secret';

let kv: typeof import('./_storage.js').kv;
let handler: typeof import('./world-state.js').default;
let captureSectorForVillage: typeof import('./world-state.js').captureSectorForVillage;
let issuePlayerToken: typeof import('./_auth.js').issuePlayerToken;

const territoryKey = 'world:territory:40';

function territory(overrides: Record<string, unknown> = {}) {
    return {
        sector: 40,
        ownerClan: 'Storm Clan',
        ownerVillage: 'Stormveil Village',
        controlScore: 75_000,
        hp: 10_000,
        weather: 'clear',
        terrainBuffStat: 'bukijutsuOffense',
        guards: ['Alice'],
        warSupply: 300,
        lastSupplyAt: Date.now() - 1_000,
        updatedAt: Date.now() - 1_000,
        ...overrides,
    };
}

function response() {
    const out: { statusCode: number; body?: Record<string, any> } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Record<string, any>) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function invoke(player: string, next: Record<string, unknown>) {
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { kind: 'territory', territory: next },
        query: {},
        headers: {
            'x-player-token': issuePlayerToken(player),
            'x-forwarded-for': '127.0.0.1',
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res);
    return out;
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken } = await import('./_auth.js'));
    const world = await import('./world-state.js');
    handler = world.default as unknown as typeof handler;
    captureSectorForVillage = world.captureSectorForVillage;
});

/**
 * Production reads come back from Postgres in the JSON form, and the territory
 * write's first landed compare-and-set loses its reply.
 */
function loseTerritoryReplyOnce(t: TestContext): () => number {
    const realGet = kv.get.bind(kv);
    const realCompareSet = kv.compareSet.bind(kv);
    let lostReplies = 0;
    t.mock.method(kv, 'get', async (key: string) => {
        const value = await realGet(key);
        return value === null ? null : JSON.parse(JSON.stringify(value));
    });
    t.mock.method(kv, 'compareSet', async (key: string, expected: unknown, value: unknown, options?: { ex?: number }) => {
        const landed = await realCompareSet(key, expected, value, options);
        if (key !== territoryKey || !landed || lostReplies > 0) return landed;
        lostReplies += 1;
        throw new Error('Connection terminated unexpectedly');
    });
    return () => lostReplies;
}

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await Promise.all([
        kv.set(territoryKey, territory()),
        kv.set('save:clan-stormclan', {
            name: 'Storm Clan',
            village: 'Stormveil Village',
            founderName: 'Alice',
            members: [{ name: 'Alice' }, { name: 'Bob' }],
            roleOverrides: {},
        }),
        kv.set('save:alice', { character: { name: 'Alice', clan: 'Storm Clan', village: 'Stormveil Village' } }),
        kv.set('save:bob', { character: { name: 'Bob', clan: 'Storm Clan', village: 'Stormveil Village' } }),
        kv.set('save:outsider', { character: { name: 'Outsider', clan: 'Other Clan', village: 'Stormveil Village' } }),
        kv.set('save:anbu', { character: { name: 'Anbu', village: 'Stormveil Village' } }),
        kv.set('game:village-state:stormveilvillage', { anbuAppointees: ['Anbu'] }),
    ]);
});

describe('legacy world-state territory write authority', { concurrency: false }, () => {
    it('cannot bypass scroll repairs or verified raid damage', async () => {
        const out = await invoke('bob', territory({ hp: 11_000 }));
        assert.equal(out.statusCode, 403);
        assert.match(String(out.body?.error), /verified raids or Territory Control Scroll repairs/);
        assert.equal((await kv.get<Record<string, unknown>>(territoryKey))?.hp, 10_000);
    });

    it('allows only clan leadership to change terrain settings', async () => {
        assert.equal((await invoke('outsider', territory({ weather: 'rain' }))).statusCode, 403);
        assert.equal((await invoke('bob', territory({ weather: 'rain' }))).statusCode, 403);
        const leader = await invoke('alice', territory({ weather: 'rain', terrainBuffStat: 'ninjutsuOffense' }));
        assert.equal(leader.statusCode, 200);
        const saved = await kv.get<Record<string, unknown>>(territoryKey);
        assert.equal(saved?.weather, 'rain');
        assert.equal(saved?.terrainBuffStat, 'ninjutsuOffense');
        assert.equal(saved?.hp, 10_000);
        assert.equal(saved?.warSupply, 300);
    });

    it('lets members and appointed ANBU toggle only their own guard entry', async () => {
        const member = await invoke('bob', territory({ guards: ['Alice', 'Bob'] }));
        assert.equal(member.statusCode, 200);
        assert.deepEqual((await kv.get<Record<string, unknown>>(territoryKey))?.guards, ['Alice', 'Bob']);

        const forged = await invoke('bob', territory({ guards: ['Bob', 'Mallory'] }));
        assert.equal(forged.statusCode, 403);
        assert.deepEqual((await kv.get<Record<string, unknown>>(territoryKey))?.guards, ['Alice', 'Bob']);

        const appointed = await invoke('anbu', territory({ guards: ['Alice', 'Bob', 'Anbu'] }));
        assert.equal(appointed.statusCode, 200);
        assert.deepEqual((await kv.get<Record<string, unknown>>(territoryKey))?.guards, ['Alice', 'Bob', 'Anbu']);
    });
});

describe('territory writes read back from Postgres', { concurrency: false }, () => {
    it('a sector-war capture whose write landed but lost its reply still resolves', async (t) => {
        // A capture sets the clan owner and the breach fields to explicit
        // undefined. The read-back is the JSON form without them, so a deep-equal
        // threw the lost reply out of the war settlement and it ran the capture again.
        const lostReplies = loseTerritoryReplyOnce(t);
        const captured = await captureSectorForVillage(40, 'Frostfang Village', Date.now());
        assert.equal(lostReplies(), 1, 'the capture landed and only its reply was lost');
        assert.equal(captured.ownerVillage, 'Frostfang Village');
        const row = await kv.get<Record<string, unknown>>(territoryKey);
        assert.equal(row?.ownerVillage, 'Frostfang Village');
        assert.equal(row?.ownerClan, undefined, 'the defeated village’s clan no longer holds it');
    });

    it('a write to a clan-less sector that landed but lost its reply still answers 200', async (t) => {
        // With no stored owner clan, the write carries `ownerClan: undefined`
        // over from the row, so a deep-equal read-back turned every lost reply
        // into a 500 even though the write had landed.
        const { ownerClan: _clanless, ...villageOnly } = territory();
        await kv.set(territoryKey, villageOnly);
        const lostReplies = loseTerritoryReplyOnce(t);
        // A villager of the owning village rewrites the row with its HP unchanged.
        const out = await invoke('outsider', villageOnly);
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(lostReplies(), 1, 'the write landed and only its reply was lost');
    });
});
