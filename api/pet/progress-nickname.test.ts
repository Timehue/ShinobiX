process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pet-nickname-test-secret-at-least-32-bytes';
import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * A pet nickname is free text strangers read in battle logs, showdowns and
 * Exchange listings, and the save sanitizer treats it as server-owned, so this
 * endpoint is its only gate. It used to store any 24 characters.
 */
type Json = Record<string, unknown>;
let kv: typeof import('../_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let migration: number;
const player = 'nicknameowner';
const key = `save:${player}`;

async function post(nickname: string) {
    const out = { status: 200, body: {} as Json };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: Json) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: 'POST', body: { playerName: player, petId: 'pet-1', action: 'nickname', nickname }, query: {}, headers: { 'x-player-token': issuePlayerToken(player) } } as never, res as never);
    return out;
}
async function pet() { return ((await kv.get<Json>(key))!.character as { pets: Json[]; fateShards: number }); }

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./progress.js')).default as unknown as typeof handler;
    migration = (await import('./_owned-pet.js')).PET_BREEDING_MIGRATION_VERSION;
});
beforeEach(async () => {
    await kv.del(`mod:silence:${player}`);
    await kv.set(key, { _saveVersion: 1, character: {
        name: player, level: 20, fateShards: 100, petBreedingMigrationVersion: migration, activePetId: 'pet-1',
        pets: [{ id: 'pet-1', name: 'Companion', level: 10, xp: 0, maxLevel: 100, rarity: 'standard', hp: 200, attack: 20, defense: 20, speed: 20, happiness: 50, jutsus: [], growthVersion: 2, growthBaseStats: { hp: 200, attack: 20, defense: 20, speed: 20 } }],
    } });
});
after(async () => { await kv.del(key); delete process.env.SHINOBIX_QA_MEMORY_KV; });

test('a clean nickname is stored and charged', async () => {
    const out = await post('Ember');
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const character = await pet();
    assert.equal(character.pets[0].nickname, 'Ember');
    assert.equal(character.fateShards, 90);
});

test('profanity and staff impersonation are refused before any shards are spent', async () => {
    for (const nickname of ['fuck', 'Admin', 'Moderator']) {
        const out = await post(nickname);
        assert.equal(out.status, 400, `${nickname} must be refused`);
        const character = await pet();
        assert.equal(character.pets[0].nickname, undefined);
        assert.equal(character.fateShards, 100);
    }
});

test('a silenced player cannot author a nickname', async () => {
    await kv.set(`mod:silence:${player}`, { until: Date.now() + 60_000, reason: 'test', by: 'admin' });
    const out = await post('Ember');
    assert.equal(out.status, 403);
    assert.equal((await pet()).pets[0].nickname, undefined);
});
