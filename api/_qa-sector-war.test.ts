import { after, before, it } from 'node:test';
import assert from 'node:assert/strict';

const previous = {
    nodeEnv: process.env.NODE_ENV,
    memoryKv: process.env.SHINOBIX_QA_MEMORY_KV,
    adminPassword: process.env.ADMIN_PASSWORD,
};
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'sector-war-qa-test-admin';

type Obj = Record<string, any>;
let kv: typeof import('./_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
let enabled: typeof import('./_qa-sector-war.js').sectorWarQaEnabled;
let registerApiRoutes: typeof import('../server-api-routes.js').registerApiRoutes;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    const module = await import('./_qa-sector-war.js');
    handler = module.default as unknown as typeof handler;
    enabled = module.sectorWarQaEnabled;
    ({ registerApiRoutes } = await import('../server-api-routes.js'));
});

after(() => {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.memoryKv === undefined) delete process.env.SHINOBIX_QA_MEMORY_KV; else process.env.SHINOBIX_QA_MEMORY_KV = previous.memoryKv;
    if (previous.adminPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = previous.adminPassword;
});

async function post(body: Obj, headers: Obj = { 'x-admin-password': process.env.ADMIN_PASSWORD }) {
    const out: { status: number; body: Obj | null } = { status: 200, body: null };
    const response = {
        setHeader() {},
        status(code: number) { out.status = code; return this; },
        json(data: Obj) { out.body = data; return this; },
        end() { return this; },
    };
    await handler({ method: 'POST', body, headers } as never, response as never);
    return out;
}

it('is impossible to enable outside the disposable test memory store', () => {
    assert.equal(enabled({ NODE_ENV: 'production', SHINOBIX_QA_MEMORY_KV: '1' }), false);
    assert.equal(enabled({ NODE_ENV: 'test' }), false);
    assert.equal(enabled({ NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1' }), true);
});

it('registers the QA route only for the disposable test server', () => {
    const registered = () => {
        const paths = new Set<string>();
        registerApiRoutes(path => paths.add(path));
        return paths;
    };
    try {
        assert.equal(registered().has('/_qa/sector-war'), true);

        delete process.env.SHINOBIX_QA_MEMORY_KV;
        assert.equal(registered().has('/_qa/sector-war'), false);

        process.env.SHINOBIX_QA_MEMORY_KV = '1';
        process.env.NODE_ENV = 'production';
        assert.equal(registered().has('/_qa/sector-war'), false);
    } finally {
        process.env.NODE_ENV = 'test';
        process.env.SHINOBIX_QA_MEMORY_KV = '1';
    }
});

it('requires full admin authentication even when the QA route is enabled', async () => {
    const result = await post({ action: 'seed' }, {});
    assert.equal(result.status, 403);
    assert.equal(result.body?.error, 'Admin only.');
});

it('creates and replaces only a valid two-account contest, resetting its score and generation', async () => {
    const attackerName = 'qawarattacker';
    const defenderName = 'qawardefender';
    await kv.set(`save:${attackerName}`, { character: { name: attackerName, village: 'Stormveil Village' } });
    await kv.set(`save:${defenderName}`, { character: { name: defenderName, village: 'Ashen Leaf Village' } });

    const seeded = await post({
        action: 'seed', sector: 10, attackerVillage: 'Stormveil Village', defenderVillage: 'Ashen Leaf Village',
        attackerName, defenderName, winCondition: 'pet',
    });
    assert.equal(seeded.status, 200);
    assert.match(String(seeded.body?.contest?.id), /^10:/);
    assert.deepEqual(
        { winCondition: seeded.body?.contest?.winCondition, attackerPoints: seeded.body?.contest?.attackerPoints, defenderPoints: seeded.body?.contest?.defenderPoints },
        { winCondition: 'pet', attackerPoints: 0, defenderPoints: 0 },
    );
    assert.equal((await kv.get<Obj>(`save:${attackerName}`))?.currentSector, 10);
    assert.equal((await kv.get<Obj>(`save:${defenderName}`))?.currentSector, 10);
    const original = seeded.body!.contest;

    const replaced = await post({ action: 'replace', contestId: original.id });
    assert.equal(replaced.status, 200);
    assert.equal(replaced.body?.contest?.id, original.id);
    assert.equal(replaced.body?.contest?.declarationGeneration, original.declarationGeneration + 1);
    assert.ok(replaced.body!.contest.startedAt > original.startedAt);
    assert.equal(replaced.body?.contest?.attackerPoints, 0);
    assert.equal(replaced.body?.contest?.defenderPoints, 0);
});
