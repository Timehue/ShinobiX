import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { after, before, mock, test } from 'node:test';
import { rollOrdinaryPveEncounter, type OrdinaryPveDifficulty, type OrdinaryPveEncounter } from '../../shared/ordinary-pve-encounter.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'explore-entropy-memory-fixture';
process.env.DISABLE_VILLAGE_STORES = '1';

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let exploreHandler: Handler;
let resolveAuthority: typeof import('../missions/_generic-ai-fight-authority.js').resolveGenericAiFightAuthority;
let petMigration: number;
let serverSeed = '';
const SECTOR = 61;

function seedFor(difficulty: OrdinaryPveDifficulty) {
    for (let n = 0; n < 10000; n++) {
        const seed = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
        if (rollOrdinaryPveEncounter({ sourceId: 'fixture', playerLevel: 100, sector: SECTOR, seed }).difficulty === difficulty) return seed;
    }
    throw new Error(`No fixture seed for ${difficulty}`);
}

/** An attacker can enumerate public hashes before paying for an exploration. */
function chosenWeakIds(player: string, count: number) {
    const ids: string[] = [];
    for (let n = 0; ids.length < count && n < 10000; n++) {
        const id = `chosen-weak-${String(n).padStart(5, '0')}`;
        const prediction = rollOrdinaryPveEncounter({ sourceId: id, playerLevel: 100, sector: SECTOR,
            seed: `${player.toLowerCase()}:${SECTOR}:${id}` });
        if (prediction.difficulty === 'weaker') ids.push(id);
    }
    assert.equal(ids.length, count);
    return ids;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ PET_BREEDING_MIGRATION_VERSION: petMigration } = await import('../pet/_owned-pet.js'));
    exploreHandler = (await import('./explore.js')).default as unknown as Handler;
    ({ resolveGenericAiFightAuthority: resolveAuthority } = await import('../missions/_generic-ai-fight-authority.js'));
    // Keep the outcome branch deterministic and independently control only the
    // SERVER entropy. Neither value is accepted from an HTTP request.
    mock.method(crypto, 'randomInt', () => 500_000_000);
    mock.method(crypto, 'randomUUID', () => serverSeed as ReturnType<typeof crypto.randomUUID>);
    syncBuiltinESMExports();
    serverSeed = seedFor('elite');
});

after(() => {
    mock.restoreAll();
    syncBuiltinESMExports();
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.DISABLE_VILLAGE_STORES;
});

async function seedPlayer(player: string) {
    await kv.set(`save:${player}`, { _saveVersion: 1, currentSector: SECTOR, character: {
        name: player, level: 100, hp: 1000, maxHp: 1000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
        ryo: 0, stats: {}, inventory: [], itemStacks: [], petBreedingMigrationVersion: petMigration,
    } });
}

async function explore(player: string, requestId: string) {
    const out: { status: number; body?: Json } = { status: 200 };
    const res = { setHeader: () => res, status: (status: number) => { out.status = status; return res; },
        json: (body: Json) => { out.body = body; return res; }, end: () => res };
    await exploreHandler({ method: 'POST', body: { playerName: player, requestId, sector: SECTOR, resolveOutcome: true,
        seed: seedFor('weaker'), encounter: { difficulty: 'weaker', archetype: 'bruiser', level: 1 } },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }, socket: { remoteAddress: '127.9.0.1' } } as never, res as never);
    return out;
}

test('precomputed favorable request ids cannot select Explore difficulty, role or level', async () => {
    const player = 'exploreentropyids';
    await seedPlayer(player);
    serverSeed = seedFor('elite');
    const expected = rollOrdinaryPveEncounter({ sourceId: 'expected', playerLevel: 100, sector: SECTOR, seed: serverSeed });
    const ids = chosenWeakIds(player, 2);
    const descriptors: OrdinaryPveEncounter[] = [];
    for (const id of ids) {
        const out = await explore(player, id);
        assert.equal(out.status, 200, JSON.stringify(out.body));
        const outcome = out.body?.outcome as { kind: string; encounter: OrdinaryPveEncounter };
        assert.equal(outcome.kind, 'battle');
        assert.equal(outcome.encounter.difficulty, 'elite', 'client-selected weak prediction cannot replace the server roll');
        assert.equal(outcome.encounter.archetype, expected.archetype);
        assert.equal(outcome.encounter.level, expected.level);
        assert.equal(outcome.encounter.sourceId, id, 'the request id controls receipt identity only');
        descriptors.push(outcome.encounter);
    }
    assert.notEqual(descriptors[0].id, descriptors[1].id);
    const stored = await kv.get<Json>(`save:${player}`);
    assert.equal((stored?.character as Json).serverExploresToday, 2, 'both discoveries pay their normal exploration cost');
});

test('a committed descriptor survives a failed durable mirror and a retry with different entropy', async () => {
    const player = 'exploreentropyretry';
    await seedPlayer(player);
    const id = chosenWeakIds(player, 1)[0];
    serverSeed = seedFor('elite');
    const originalSet = kv.set;
    let first;
    (kv as { set: unknown }).set = async (key: string, value: unknown, options?: unknown) => {
        if (key.startsWith('world-explore-receipt:')) throw new Error('fixture-lost-mirror');
        return originalSet.call(kv, key, value, options as never);
    };
    try { first = await explore(player, id); }
    finally { (kv as { set: unknown }).set = originalSet; }
    assert.equal(first.status, 503, JSON.stringify(first.body));
    const saved = await kv.get<Json>(`save:${player}`);
    const receipts = (saved?.character as Json).redeemedSectorExplorations as Array<{ id: string; outcome: { encounter: OrdinaryPveEncounter } }>;
    const committed = receipts.find(entry => entry.id === id)!.outcome.encounter;
    assert.equal(committed.difficulty, 'elite');
    serverSeed = seedFor('weaker');
    const retry = await explore(player, id);
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body?.replayed, true);
    assert.deepEqual((retry.body?.outcome as Json).encounter, committed);
    assert.equal(((await kv.get<Json>(`save:${player}`))?.character as Json).serverExploresToday, 1);
    const durable = await kv.get<Json>(`world-explore-receipt:${player}:${id}`);
    assert.deepEqual((durable?.outcome as Json).encounter, committed);
});

test('legacy battle receipts are sealed with server entropy once and reused after a lost acknowledgement', async () => {
    const player = 'exploreentropylegacy';
    const id = chosenWeakIds(player, 1)[0];
    const character = { level: 100, redeemedSectorExplorations: [{ id, sector: SECTOR, at: Date.now(), outcome: { kind: 'battle' } }] };
    const params = { store: kv, playerName: player, body: { battleKind: 'explore', sector: SECTOR, worldExploreRequestId: id }, character, tokenTtlSeconds: 1800 };
    serverSeed = seedFor('elite');
    const originalSet = kv.set;
    (kv as { set: unknown }).set = async (key: string, value: unknown, options?: unknown) => {
        const result = await originalSet.call(kv, key, value, options as never);
        if (key.startsWith('world-explore-receipt:')) throw new Error('fixture-lost-ack');
        return result;
    };
    try { await assert.rejects(resolveAuthority(params), /fixture-lost-ack/); }
    finally { (kv as { set: unknown }).set = originalSet; }
    const durable = await kv.get<Json>(`world-explore-receipt:${player}:${id}`);
    const committed = (durable?.outcome as Json).encounter as OrdinaryPveEncounter;
    assert.equal(committed.difficulty, 'elite');
    serverSeed = seedFor('weaker');
    const retry = await resolveAuthority({ ...params, character: { ...character, level: 25 } });
    assert.deepEqual(retry.encounter, committed);
});
