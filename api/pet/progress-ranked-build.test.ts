process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'ranked-build-test-secret';

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { tacticsPreset } from '../../shared/pet-tactics-roster.js';
import { rankedBuildForPet } from '../../shared/pet-tactics-build.js';
import { sanitizePetRoster } from '../save/_sanitize-pets.js';

type Json = Record<string, unknown>;
let kv: typeof import('../_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
let token: string;
const player = 'rankedtechniques';
const petId = 'owned-fire';
before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./progress.js')).default as unknown as typeof handler;
    token = (await import('../_auth.js')).issuePlayerToken(player)!;
});
after(async () => { await kv.del(`save:${player}`); });
async function seed(extra: Json = {}) {
    const { PET_BREEDING_MIGRATION_VERSION } = await import('./_owned-pet.js');
    await kv.set(`save:${player}`, { _saveVersion: 3, character: {
        name: player, level: 40, inventory: [], itemStacks: [],
        petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
        pets: [{ id: petId, templateId: 'starter-fire', name: 'Cinder Cub', rarity: 'standard',
            element: 'Fire', level: 10, maxLevel: 100, hp: 100, attack: 40, defense: 30, speed: 35, jutsus: [], happiness: 80, ...extra }],
    } });
}
async function post(build: unknown, id = petId, auth = token) {
    const out = { status: 200, body: {} as Json };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(body: Json) { out.body = body; return res; }, end() { return res; } };
    await handler({ method: 'POST', query: {}, body: { playerName: player, petId: id, action: 'ranked-build', build },
        headers: { 'x-player-token': auth, 'x-forwarded-for': '127.0.0.81' }, socket: { remoteAddress: '127.0.0.81' } } as never, res as never);
    return out;
}
const custom = () => ({ ...tacticsPreset('starter-fire', 1), ownedPetId: petId, item: 'focus-lens' as const });
test('saves custom moves for the owned pet, survives stale autosaves, and retries without a new version', async () => {
    await seed();
    const out = await post(custom());
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const char = out.body.character as Json;
    const pet = (char.pets as Json[])[0];
    assert.deepEqual(pet.rankedBuild, custom());
    assert.deepEqual(rankedBuildForPet(pet as { id: string })!.moveIds, custom().moveIds);
    const stale = { ...char, pets: [{ ...pet, rankedBuild: tacticsPreset('starter-fire') }] };
    sanitizePetRoster(stale, char, true);
    assert.deepEqual(stale.pets[0].rankedBuild, custom(), 'autosave must preserve the committed techniques');
    const retry = await post(custom());
    assert.equal(retry.status, 200);
    assert.equal(retry.body._saveVersion, out.body._saveVersion);
});
test('rejects unowned pets, mismatched species and illegal techniques without changing the save', async () => {
    await seed();
    const before = await kv.get(`save:${player}`);
    for (const [build, id, expected] of [
        [custom(), 'missing-pet', 404],
        [{ ...custom(), ownedPetId: 'somebody-elses-pet' }, petId, 400],
        [{ ...tacticsPreset('starter-water'), ownedPetId: petId }, petId, 400],
        [{ ...custom(), moveIds: ['fire-strike', 'fire-strike', 'rally', 'protect'] }, petId, 400],
        [{ ...custom(), moveIds: ['fire-strike', 'fire-pulse', 'mend', 'purify'] }, petId, 400],
        [{ ...custom(), allocation: { vitality: 999, power: 0, guard: 0, agility: 0 } }, petId, 400],
    ] as const) assert.equal((await post(build, id)).status, expected);
    assert.deepEqual(await kv.get(`save:${player}`), before);
    assert.equal((await post(custom(), petId, '')).status, 401);
});
test('current evolved species is enforced and hatchery parents cannot change their kit', async () => {
    await seed({ evolutionStage: 1, rarity: 'rare' });
    assert.equal((await post(custom())).status, 400);
    assert.equal((await post({ ...tacticsPreset('starter-fire-r'), ownedPetId: petId })).status, 200);
    const record = await kv.get<Json>(`save:${player}`);
    await kv.set(`save:${player}`, { ...record, character: { ...(record!.character as Json), petBreeding: {
        sessionId: 'locked', state: 'breeding', parentIds: [petId, 'other'], startedAt: Date.now(), readyAt: Date.now() + 60000,
    } } });
    assert.equal((await post({ ...tacticsPreset('starter-fire-r', 1), ownedPetId: petId })).status, 409);
});
