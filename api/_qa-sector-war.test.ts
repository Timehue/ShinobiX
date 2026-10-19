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
let petHandler: typeof handler;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    const module = await import('./_qa-sector-war.js');
    handler = module.default as unknown as typeof handler;
    enabled = module.sectorWarQaEnabled;
    ({ registerApiRoutes } = await import('../server-api-routes.js'));
    const pet = await import('./village/sector-pet.js');
    petHandler = ((pet.default as unknown as { default?: typeof handler })?.default ?? pet.default) as unknown as typeof handler;
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

async function petPost(body: Obj) {
    const out: { status: number; body: Obj | null } = { status: 200, body: null };
    const response = {
        setHeader() {},
        status(code: number) { out.status = code; return this; },
        json(data: Obj) { out.body = data; return this; },
        end() { return this; },
    };
    await petHandler({ method: 'POST', body, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD } } as never, response as never);
    return out;
}

async function seedPair(prefix: string) {
    const attackerName = `${prefix}attacker`;
    const defenderName = `${prefix}defender`;
    for (const [name, village] of [[attackerName, 'Stormveil Village'], [defenderName, 'Ashen Leaf Village']]) {
        const pet = { id: `${name}pet`, name: 'Ashfang', rarity: 'common', level: 5, hp: 60, attack: 20, defense: 15, speed: 12, element: 'None' };
        await kv.set(`save:${name}`, { character: { name, village, pets: [pet], activePetId: pet.id } });
    }
    return { action: 'seed', sector: 10, attackerVillage: 'Stormveil Village', defenderVillage: 'Ashen Leaf Village', attackerName, defenderName, winCondition: 'pet' };
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

it('repeated QA seeds give new players a fresh real pet table after finished and pending duels', async () => {
    const first = await seedPair('qafirst');
    const seeded = await post(first);
    assert.equal(seeded.status, 200);
    const id = String(seeded.body!.contest.id);
    const join = (playerName: string, side: 'p1' | 'p2') => petPost({ action: 'join', sectorWarId: id, playerName, side });
    const state = (playerName: string, garrison = false) => petPost({ action: 'state', sectorWarId: id, playerName, garrison });
    assert.equal((await join(first.attackerName, 'p1')).body?.session.status, 'awaiting-defender');
    const decided = await join(first.defenderName, 'p2');
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body?.session.status, 'done');
    assert.equal(decided.body?.session.engine, 'showdown');
    assert.equal(decided.body?.session.appliedToContest, true);
    assert.equal((await state(first.attackerName)).body?.session.p1.name, first.attackerName);
    const done = await kv.get<Obj>(`sector-pet:${id}`);
    await kv.set(`sector-pet-garrison:${id}`, { ...done, garrison: true });

    const unrelated = {
        [`sector-pet:${id}:other`]: { kind: 'other-table' },
        [`sector-pet-garrison:${id}:other`]: { kind: 'other-garrison' },
        'sector-pet-open:0123456789abcdef01234567': { kind: 'open-duel', sectorWarId: id },
        [`sector-card:${id}`]: { kind: 'card-table' },
        [`shared:sector-war-resolution:pet:${id}:retained`]: { kind: 'historical-receipt' },
    };
    for (const [key, value] of Object.entries(unrelated)) await kv.set(key, value);

    const second = await seedPair('qasecond');
    const reseeded = await post(second);
    assert.equal(reseeded.status, 200);
    assert.equal(reseeded.body?.contest.id, id);
    assert.equal((await state(second.attackerName)).status, 404, 'finished old table must not be projected to the new players');
    assert.equal((await state(second.attackerName, true)).status, 404);
    const reopened = await join(second.attackerName, 'p1');
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
    assert.equal(reopened.body?.session.status, 'awaiting-defender');
    assert.equal(reopened.body?.session.p1.name, second.attackerName);

    const third = await seedPair('qathird');
    assert.equal((await post(third)).status, 200);
    assert.equal((await state(third.attackerName)).status, 404, 'pending old table must also be absent');
    const fresh = await join(third.attackerName, 'p1');
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    assert.equal(fresh.body?.session.p1.name, third.attackerName);
    assert.equal(fresh.body?.session.status, 'awaiting-defender');
    for (const [key, value] of Object.entries(unrelated)) assert.deepEqual(await kv.get(key), value, key);

    const pending = await kv.get(`sector-pet:${id}`);
    const retainedGarrison = { ...done, garrison: true };
    await kv.set(`sector-pet-garrison:${id}`, retainedGarrison);
    assert.equal((await post({ action: 'replace', contestId: id })).status, 200);
    assert.deepEqual(await kv.get(`sector-pet:${id}`), pending, 'replacement preserves the superseded table');
    assert.deepEqual(await kv.get(`sector-pet-garrison:${id}`), retainedGarrison, 'replacement preserves the garrison replay');
    assert.equal((await state(third.attackerName)).body?.session.p1.name, third.attackerName);
    const lateAnswer = await join(third.defenderName, 'p2');
    assert.equal(lateAnswer.status, 200, JSON.stringify(lateAnswer.body));
    assert.equal(lateAnswer.body?.session.status, 'done');
    assert.deepEqual(lateAnswer.body?.session.warResult, { scored: false, reason: 'superseded' });
});

it('QA seed guards leave existing tables intact on rejected requests', async () => {
    const fixture = await seedPair('qaguarded');
    const seeded = await post(fixture);
    assert.equal(seeded.status, 200);
    const id = String(seeded.body!.contest.id);
    const table = { retained: 'live-table' };
    const garrison = { retained: 'garrison-table' };
    await kv.set(`sector-pet:${id}`, table);
    await kv.set(`sector-pet-garrison:${id}`, garrison);
    const assertRetained = async () => {
        assert.deepEqual(await kv.get(`sector-pet:${id}`), table);
        assert.deepEqual(await kv.get(`sector-pet-garrison:${id}`), garrison);
    };
    assert.equal((await post(fixture, {})).status, 403);
    await assertRetained();
    assert.equal((await post({ ...fixture, winCondition: 'invalid' })).status, 400);
    await assertRetained();
    assert.equal((await post({ ...fixture, attackerName: 'missingfixtureplayer' })).status, 409);
    await assertRetained();
    try {
        process.env.NODE_ENV = 'production';
        assert.equal((await post(fixture)).status, 404);
        await assertRetained();
        process.env.NODE_ENV = 'test';
        delete process.env.SHINOBIX_QA_MEMORY_KV;
        assert.equal((await post(fixture)).status, 404);
        await assertRetained();
    } finally {
        process.env.NODE_ENV = 'test';
        process.env.SHINOBIX_QA_MEMORY_KV = '1';
    }
});
