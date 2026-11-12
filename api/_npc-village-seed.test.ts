import assert from 'node:assert/strict';
import { before, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-seed-test-session-secret-at-least-32-characters';

let kv: typeof import('./_storage.js').kv;
let seed: typeof import('./_npc-village-seed.js');
let roster: typeof import('../shared/npc-village-roster.js');
let auth: typeof import('./player-auth.js');
let session: typeof import('./pvp/session.js');

before(async () => {
    ({ kv } = await import('./_storage.js'));
    seed = await import('./_npc-village-seed.js');
    roster = await import('../shared/npc-village-roster.js');
    auth = (await import('./player-auth.js')) as unknown as typeof auth;
    session = (await import('./pvp/session.js')) as unknown as typeof session;
});

test('seeding creates 30 password-less Cinderhold accounts, then rescales them idempotently', async () => {
    const first = await seed.seedNpcVillage();
    assert.deepEqual(first.failures, []);
    assert.equal(first.seeded.length, 30);
    for (const npc of roster.NPC_VILLAGE_ROSTER) {
        const record = await kv.get<Record<string, unknown>>(auth.authKey(npc.id));
        assert.ok(record, npc.id);
        assert.equal(record!.hash, undefined, 'no password: login fails closed');
        assert.equal(auth.isCredentialLessGuest(record as never), false, 'never swept as a guest');
        assert.equal(await auth.verifyPlayerPassword(npc.id, ''), false);
        const save = await kv.get<{ character: Record<string, unknown> }>(seed.saveKeyFor(npc));
        assert.equal(save!.character.village, 'Cinderhold Village');
        assert.equal((save!.character.pets as unknown[]).length, 4);
        assert.equal((save!.character.cardClashDeck as unknown[]).length, 40);
    }
    const again = await seed.seedNpcVillage();
    assert.deepEqual(again.failures, []);
    // Nothing changed since the first pass, so nothing is written again.
    assert.equal(again.unchanged.length, 30, JSON.stringify(again));
});

test('a Cinderhold clan name a player clan already holds stays theirs: no NPC claims it, and the pass is still complete', async () => {
    const { NPC_CLANS } = await import('../shared/npc-clans.js');
    const { clanRecordKey } = await import('./_utils.js');
    const clan = NPC_CLANS[1]!;
    const key = clanRecordKey(clan.name);
    const npcRecord = await kv.get(key);
    const playerClan = { name: clan.name, founderName: 'wardholder', village: 'Moonshadow Village', members: [{ name: 'wardholder', level: 20 }] };
    await kv.set(key, playerClan);
    try {
        const pass = await seed.seedNpcVillage();
        assert.deepEqual(pass.failures, [], 'a held name is no failure: the daily pass is not retried forever');
        assert.ok(pass.warnings.some((warning) => warning.includes(clan.name)), JSON.stringify(pass.warnings));
        assert.deepEqual(await kv.get(key), playerClan, 'the player clan is untouched');
        for (const id of clan.members) {
            const character = (await kv.get<{ character: Record<string, unknown> }>(`save:${id}`))!.character;
            assert.equal(character.clan, undefined, `${id} does not claim the player clan`);
            assert.equal(character.clanFounder, undefined);
        }
        const other = NPC_CLANS[0]!;
        assert.equal((await kv.get<{ character: Record<string, unknown> }>(`save:${other.founder}`))!.character.clan, other.name, 'the other clans keep theirs');
    } finally {
        await kv.set(key, npcRecord);
        await seed.seedNpcVillage();
    }
    assert.equal((await kv.get<{ character: Record<string, unknown> }>(`save:${clan.founder}`))!.character.clan, clan.name, 'once the name is free, the clan is stamped again');
});

test('a rebuilt NPC hydrates as a PvP fighter with every equipped jutsu', async () => {
    const npc = roster.NPC_VILLAGE_ROSTER[0]!;
    const save = seed.buildNpcSave(npc, 60);
    const fighter = session.hydrateCharacterFromSave(save.character as never, {}, save as never);
    assert.deepEqual((fighter.jutsu as Array<{ id: string }>).map((j) => j.id), (save.character as { equippedJutsuIds: string[] }).equippedJutsuIds);
});

test('the daily rebuild wipes anything a controlled NPC earned and skips one under control', async () => {
    const npc = roster.NPC_VILLAGE_ROSTER[1]!;
    await seed.seedNpcVillage();
    const key = seed.saveKeyFor(npc);
    const save = await kv.get<{ character: Record<string, unknown> }>(key);
    await kv.set(key, { ...save, character: { ...save!.character, ryo: 999_999, honorSeals: 50 } });
    const skipped = await seed.seedNpcVillage(Date.now(), async (slug) => slug === npc.id);
    assert.ok(skipped.skipped.includes(npc.id));
    assert.equal((await kv.get<{ character: { ryo: number } }>(key))!.character.ryo, 999_999, 'never rewritten under an admin');
    await seed.seedNpcVillage();
    const rebuilt = (await kv.get<{ character: { ryo: number; honorSeals: number } }>(key))!.character;
    assert.equal(rebuilt.ryo, 0);
    assert.equal(rebuilt.honorSeals, 0);
});

test('a takeover that starts right after the rebuild checks it waits until the rebuilt save is committed', async () => {
    const { withKvLock } = await import('./_lock.js');
    const { npcPossessKey } = await import('./_npc-possession.js');
    const npc = roster.NPC_VILLAGE_ROSTER[2]!;
    const key = seed.saveKeyFor(npc);
    await kv.del(key);
    let entered!: () => void;
    const checking = new Promise<void>((resolve) => { entered = resolve; });
    // The rebuild pauses right after its possession check: the gap the old code left open.
    const rebuilding = seed.seedNpcVillage(Date.now(), async (slug) => {
        if (slug === npc.id) { entered(); await new Promise((resolve) => setTimeout(resolve, 60)); }
        return false;
    });
    await checking;
    // The admin's takeover starts from its own request, outside the rebuild.
    let sawSave: unknown = 'not run';
    await withKvLock(npcPossessKey(npc.id), async () => { sawSave = await kv.get(key); }, { failClosed: true });
    const result = await rebuilding;
    assert.ok(result.seeded.includes(npc.id) || result.rescaled.includes(npc.id) || result.unchanged.includes(npc.id), JSON.stringify(result));
    assert.ok(sawSave && typeof sawSave === 'object', 'the takeover ran only after the rebuilt save was written');
});

test('an NPC whose account name a PLAYER already holds is never seeded: their save, login, registry row and portrait stay theirs', async () => {
    const npc = roster.NPC_VILLAGE_ROSTER[roster.NPC_VILLAGE_ROSTER.length - 1]!;
    const { REGISTRY_KEY } = await import('./player/_public-index.js');
    const { perImageKey } = await import('./images.js');
    // A real player registered this name first: password login, their own save,
    // their own registry entry and their own portrait row.
    const playerAuth = { salt: 'player-salt', hash: 'scrypt:16384:8:1:00ff', createdAt: 1 };
    const playerSave = { _saveVersion: 7, character: { name: npc.name, village: 'Stormveil Village', level: 3, ryo: 1234 } };
    const playerRow = JSON.stringify({ name: npc.name, village: 'Stormveil Village', level: 3, lastSeen: 42 });
    const playerAvatar = 'data:image/png;base64,UExBWUVS';
    await kv.set(auth.authKey(npc.id), playerAuth);
    await kv.set(seed.saveKeyFor(npc), playerSave);
    await kv.hset(REGISTRY_KEY, { [npc.id]: playerRow });
    await kv.set(perImageKey(`avatar:${npc.id}`), playerAvatar);
    try {
        const pass = await seed.seedNpcVillage();
        assert.ok(pass.warnings.some((w) => w.startsWith(`${npc.id}:`) && /belongs to a player/.test(w)), JSON.stringify(pass.warnings));
        assert.ok(![...pass.seeded, ...pass.rescaled, ...pass.unchanged].includes(npc.id), 'the NPC is not seeded over them');
        assert.deepEqual(pass.failures, [], 'a taken name is a warning, not a failed daily pass');
        assert.deepEqual(await kv.get(seed.saveKeyFor(npc)), playerSave, 'their character is untouched');
        assert.deepEqual(await kv.get(auth.authKey(npc.id)), playerAuth, 'their login is untouched');
        assert.equal((await kv.hgetall<Record<string, unknown>>(REGISTRY_KEY))?.[npc.id], playerRow, 'their player-list entry is untouched');
        assert.equal(await kv.get(perImageKey(`avatar:${npc.id}`)), playerAvatar, 'their portrait is untouched');
    } finally {
        await kv.del(auth.authKey(npc.id), seed.saveKeyFor(npc), perImageKey(`avatar:${npc.id}`));
        await kv.hdel(REGISTRY_KEY, npc.id);
        await seed.seedNpcVillage();
    }
    // Ownership is the seeder's own stamp, nothing else.
    assert.equal(seed.npcOwnsAccount(null, null), true, 'an unused name is free');
    assert.equal(seed.npcOwnsAccount({ createdAt: 1, npcVillage: true }, { character: {} }), true);
    assert.equal(seed.npcOwnsAccount({ createdAt: 1 }, null), false, 'an unstamped account is a player\'s');
    assert.equal(seed.npcOwnsAccount({ createdAt: 1, npcVillage: true, hash: 'x', salt: 'y' }, null), false, 'a password means a person');
    assert.equal(seed.npcOwnsAccount(null, { character: {} }), false, 'a save without a login is not ours to overwrite');
});
