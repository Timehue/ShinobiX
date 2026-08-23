import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'territory-world-state-authority-test-secret';

let kv: typeof import('./_storage.js').kv;
let handler: typeof import('./world-state.js').default;
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
});

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
