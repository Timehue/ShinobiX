import { before, test } from 'node:test';
import assert from 'node:assert/strict';

// writeVersionedPlayerSave re-indexes the public player registry whenever ANY
// leaderboard-visible field changed (2026-10-13 audit). A hand-picked six-field
// list used to leave server-side grants (stat points, profession XP, tower
// floors...) off the boards until the owner's next session, because the
// owner's autosave then matched the stored character and skipped the registry.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Save = { _saveVersion: number; character: Record<string, unknown> };
let kv: typeof import('../_storage.js').kv;
let writeVersionedPlayerSave: typeof import('./_mutate-player-save.js').writeVersionedPlayerSave;
let REGISTRY_KEY: string;

before(async () => {
    const storage = await import('../_storage.js');
    assert.equal(storage.saveStoreKind, 'memory-qa');
    kv = storage.kv;
    ({ writeVersionedPlayerSave } = await import('./_mutate-player-save.js'));
    ({ REGISTRY_KEY } = await import('../player/_public-index.js'));
});

async function seeded(name: string, character: Record<string, unknown>) {
    const saveKey = `save:${name}`;
    await kv.set(saveKey, { _saveVersion: 1, character: { name, level: 20, ...character } });
    await kv.hdel(REGISTRY_KEY, name);
    return saveKey;
}

const registryRow = async (name: string) => (await kv.hgetall<Record<string, Record<string, unknown>>>(REGISTRY_KEY))?.[name];

test('a server-side stat-point grant reaches the leaderboard at once', async () => {
    const name = 'reindexstats';
    const saveKey = await seeded(name, { stats: { strength: 20 }, unspentStats: 2 });
    const before = (await kv.get<Save>(saveKey))!;
    await writeVersionedPlayerSave(saveKey, before, { ...before.character, unspentStats: 5 });
    const row = await registryRow(name);
    assert.ok(row, 'the registry was re-indexed');
    const { buildPublicPlayerIndexEntry } = await import('../player/_public-index.js');
    assert.equal(row?.xp, buildPublicPlayerIndexEntry({ ...before.character, unspentStats: 5 }, name).xp,
        'the "Total Stat Points Earned" board sees the grant');
});

test('profession XP and tower floors re-index too; an unrelated change does not', async () => {
    const name = 'reindexother';
    const saveKey = await seeded(name, { professionXp: 10, battleTowerBestFloor: 3 });
    let current = (await kv.get<Save>(saveKey))!;
    await writeVersionedPlayerSave(saveKey, current, { ...current.character, professionXp: 25, battleTowerBestFloor: 4 });
    assert.equal((await registryRow(name))?.professionXp, 25);
    assert.equal((await registryRow(name))?.battleTowerBestFloor, 4);

    await kv.hdel(REGISTRY_KEY, name);
    current = (await kv.get<Save>(saveKey))!;
    await writeVersionedPlayerSave(saveKey, current, { ...current.character, inventory: [{ id: 'not-public' }] });
    assert.equal(await registryRow(name), undefined, 'a change no board shows never rewrites the shared registry row');
});
