import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'pet-prodigy-memory-only';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let prodigyKey: (playerName: string, now: number) => string;
let migration: number;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const progress = await import('./progress.js');
    handler = progress.default as unknown as Handler;
    prodigyKey = progress.prodigyKey;
    migration = (await import('./_owned-pet.js')).PET_BREEDING_MIGRATION_VERSION;
});

const PLAYER = 'prodigytamer';
const PROGRESS_XP_NO_PRODIGY = 460; // 4h bond, happiness 100 (see training-clan-bonus.test.ts baseline)

async function seed(spec: Record<string, number>, profession = 'petTamer') {
    const now = Date.now();
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: {
        name: PLAYER, level: 50, profession, professionRank: 0, masterySpec: spec, petBreedingMigrationVersion: migration,
        pets: [{ id: 'prodigy-pet', name: 'Fang', rarity: 'standard', level: 20, maxLevel: 100, xp: 0, happiness: 100,
            happinessDay: Math.floor(now / 86_400_000), hp: 500, attack: 40, defense: 40, speed: 40, jutsus: [] }],
        activePetId: 'prodigy-pet',
    } });
}

async function call(method: 'GET' | 'POST', body: Record<string, unknown> = {}) {
    let status = 200;
    let payload: Record<string, unknown> = {};
    const res = { setHeader() { return res; }, status(n: number) { status = n; return res; }, json(b: Record<string, unknown>) { payload = b; return res; }, end() { return res; } };
    await handler({ method, body: { playerName: PLAYER, ...body }, query: { playerName: PLAYER },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }, socket: { remoteAddress: '127.0.0.89' } } as never, res as never);
    return { status, payload };
}

const startProdigy = () => call('POST', { petId: 'prodigy-pet', action: 'start-training', focus: 'bond', durationMs: 14_400_000, prodigy: true });

test('Prodigy: once per UTC day, a session finishes instantly with doubled XP — only with the capstone', async () => {
    await kv.del(prodigyKey(PLAYER, Date.now()));

    await seed({ 'train-time': 2, 'train-xp': 0 });
    assert.equal((await startProdigy()).status, 403, 'needs the capstone');
    assert.equal(((await call('GET')).payload.prodigy as { owned: boolean }).owned, false);

    await seed({ 'train-time': 2, 'train-xp': 2, prodigy: 1 }, 'vanguard');
    assert.equal((await startProdigy()).status, 403, 'Pet Tamers only');

    // 4 points in the Trainer path gate the capstone; train-xp adds 6%/rank.
    await seed({ 'train-time': 2, 'train-xp': 2, prodigy: 1 });
    assert.equal(((await call('GET')).payload.prodigy as { available: boolean }).available, true);
    const started = await startProdigy();
    assert.equal(started.status, 200, JSON.stringify(started.payload));
    const training = (await kv.get<{ character: { pets: Array<{ training: { endsAt: number; startedAt: number; sealedXp: number; prodigy?: boolean } }> } }>(`save:${PLAYER}`))!
        .character.pets[0].training;
    assert.equal(training.endsAt, training.startedAt, 'sealed already finished');
    assert.equal(training.prodigy, true);
    assert.equal(training.sealedXp, 2 * Math.round(400 * 1.15 * 1.12), 'doubled, on top of the normal bonuses');
    assert.ok(training.sealedXp > PROGRESS_XP_NO_PRODIGY);

    const collected = await call('POST', { petId: 'prodigy-pet', action: 'complete-training' });
    assert.equal(collected.status, 200, 'collectable at once');

    await seed({ 'train-time': 2, 'train-xp': 2, prodigy: 1 });
    assert.equal((await startProdigy()).status, 409, 'once per day');
    assert.equal(((await call('GET')).payload.prodigy as { available: boolean }).available, false);
    const normal = await call('POST', { petId: 'prodigy-pet', action: 'start-training', focus: 'bond', durationMs: 14_400_000 });
    assert.equal(normal.status, 200, 'ordinary training is unaffected');
    await kv.del(prodigyKey(PLAYER, Date.now()));
});

test('Prodigy is handed back when the save write fails', async () => {
    await kv.del(prodigyKey(PLAYER, Date.now()));
    await seed({ 'train-time': 2, 'train-xp': 2, prodigy: 1 });
    const store = kv as unknown as { compareSet: (...args: unknown[]) => Promise<unknown> };
    const original = store.compareSet;
    store.compareSet = async () => { throw new Error('simulated storage failure'); };
    try {
        assert.equal((await startProdigy()).status, 500);
    } finally { store.compareSet = original; }
    assert.equal(await kv.get(prodigyKey(PLAYER, Date.now())), null, "today's Prodigy is still unused");
    assert.equal((await startProdigy()).status, 200);
    await kv.del(prodigyKey(PLAYER, Date.now()));
});

test('Prodigy is not spent when collecting the previous session maxes the pet', async () => {
    await kv.del(prodigyKey(PLAYER, Date.now()));
    await seed({ 'train-time': 2, 'train-xp': 2, prodigy: 1 });
    const record = await kv.get<{ _saveVersion: number; character: { pets: Array<Record<string, unknown>> } }>(`save:${PLAYER}`);
    assert.ok(record);
    // Already at max with a finished session still waiting: start-training collects
    // it and, since the pet can't train further, starts nothing.
    const pet = { ...record.character.pets[0], level: 100, maxLevel: 100,
        training: { type: 'bond', startedAt: Date.now() - 20_000, endsAt: Date.now() - 1_000, durationMs: 900_000, sealedXp: 50 } };
    await kv.set(`save:${PLAYER}`, { ...record, character: { ...record.character, pets: [pet] } });
    const reply = await startProdigy();
    assert.equal(reply.status, 200, JSON.stringify(reply.payload));
    assert.equal((reply.payload.pet as { training?: unknown }).training, undefined, 'no new session started');
    assert.equal(await kv.get(prodigyKey(PLAYER, Date.now())), null, 'Prodigy was not spent');
});
