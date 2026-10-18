process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pet-incubation-test-secret';

import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PET_CATALOG } from './_catalog.js';
import { PET_BREEDING_MIGRATION_VERSION } from './_owned-pet.js';
import { breedingResultKey, buildSealedBreedingResult } from './_breeding.js';
import { PET_EGG_GAMEPLAY_MS } from '../../shared/pet-incubation.js';

type Json = Record<string, any>;
type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let token: typeof import('../_auth.js').issuePlayerToken;
let listPetSanctuary: typeof import('./_sanctuary.js').listPetSanctuary;
let start: Handler, status: Handler, hatch: Handler;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    token = (await import('../_auth.js')).issuePlayerToken;
    ({ listPetSanctuary } = await import('./_sanctuary.js'));
    start = (await import('./breeding-start.js')).default as unknown as Handler;
    status = (await import('./breeding-status.js')).default as unknown as Handler;
    hatch = (await import('./breeding-hatch.js')).default as unknown as Handler;
});

async function request(handler: Handler, playerName: string, body: Json = {}, method = 'POST') {
    const out = { status: 200, body: {} as Json };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; },
        json(value: Json) { out.body = value; return res; }, end() { return res; } };
    await handler({ method, query: { playerName }, body: { playerName, ...body },
        headers: { 'x-player-token': token(playerName), 'x-forwarded-for': '127.0.0.94' }, socket: { remoteAddress: '127.0.0.94' } } as never, res as never);
    return out;
}
async function seed(name: string, eggProduced: boolean, now: number) {
    const parents = ['standard-0', 'standard-6'].map((templateId, index) => ({ ...PET_CATALOG[templateId],
        id: `parent-${index}`, templateId, level: 50, breedingUsesMax: 5, breedingUsesRemaining: 5, origin: 'wild' }));
    await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, level: 50, pets: parents,
        petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION, inventory: [], itemStacks: [],
        hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100 } });
    const requestId = `pairing-${name}-0001`;
    const sealed = { ...buildSealedBreedingResult({ playerName: name, requestId, parent1: parents[0], parent2: parents[1], now, secureInt: min => min }), eggProduced };
    await kv.set(breedingResultKey(name, sealed.sessionId), sealed);
    return { requestId, parent1Id: parents[0].id, parent2Id: parents[1].id, sessionId: sealed.sessionId };
}

test('successful attempts immediately create one private Sanctuary egg and retries never charge twice', async context => {
    let now = 1_800_000_000_000;
    context.mock.method(Date, 'now', () => now);
    const args = await seed('eggcreated', true, now);
    const first = await request(start, 'eggcreated', args);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.eggProduced, true);
    assert.equal(first.body.session.state, 'egg');
    assert.equal(first.body.session.location, 'sanctuary');
    assert.equal(first.body.session.incubationRemainingMs, PET_EGG_GAMEPLAY_MS);
    assert.deepEqual(first.body.character.pets.map((pet: Json) => pet.breedingUsesRemaining), [4, 4]);
    assert.equal('chromatic' in first.body.session, false);
    assert.equal('resultTemplateId' in first.body.session, false);
    const replay = await request(start, 'eggcreated', args);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body._saveVersion, first.body._saveVersion);
    now += 24 * 60 * 60 * 1000;
    const offline = await request(status, 'eggcreated', {}, 'GET');
    assert.equal(offline.body.session.incubationRemainingMs, PET_EGG_GAMEPLAY_MS);
    const activity = { id: 'foreground-session-0001', active: true, elapsedMs: 15_000 };
    await request(status, 'eggcreated', { activity });
    now += 15_000;
    const playing = await request(status, 'eggcreated', { activity });
    assert.equal(playing.body.session.incubationRemainingMs, PET_EGG_GAMEPLAY_MS - 15_000);
    now += 15_000;
    const hidden = await request(status, 'eggcreated', { activity: { ...activity, active: false } });
    assert.equal(hidden.body.session.incubationRemainingMs, playing.body.session.incubationRemainingMs);
    assert.equal((await request(status, 'eggcreated', { activity: { ...activity, elapsedMs: -1 } })).status, 400);
});

test('failed pairings consume exactly one use per parent, create no egg, and retain their outcome on retry', async context => {
    const now = 1_800_100_000_000;
    context.mock.method(Date, 'now', () => now);
    const args = await seed('eggfailed', false, now);
    const first = await request(start, 'eggfailed', args);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.eggProduced, false);
    assert.equal(first.body.session, null);
    assert.deepEqual(first.body.character.pets.map((pet: Json) => pet.breedingUsesRemaining), [4, 4]);
    const retry = await request(start, 'eggfailed', args);
    assert.equal(retry.body.eggProduced, false);
    assert.equal(retry.body.replayed, true);
    assert.equal(retry.body._saveVersion, first.body._saveVersion);
    assert.equal((await request(hatch, 'eggfailed', { sessionId: args.sessionId })).status, 404);
});

test('hatches wait for gameplay and battle completion, stay in Sanctuary, and acknowledge the reveal durably', async context => {
    const now = 1_800_200_000_000;
    context.mock.method(Date, 'now', () => now);
    const args = await seed('egghatched', true, now);
    await request(start, 'egghatched', args);
    assert.equal((await request(hatch, 'egghatched', { sessionId: args.sessionId })).body.error, 'hatch-requirements-incomplete');
    const saved = (await kv.get<Json>('save:egghatched'))!;
    saved.character.petBreeding.incubationRemainingMs = 0;
    await kv.set('save:egghatched', saved);
    await kv.set('battle-lock:egghatched', { id: 'active-battle' });
    assert.equal((await request(hatch, 'egghatched', { sessionId: args.sessionId })).body.error, 'hatch-deferred-active-battle');
    await kv.del('battle-lock:egghatched');
    const hatched = await request(hatch, 'egghatched', { sessionId: args.sessionId });
    assert.equal(hatched.status, 200, JSON.stringify(hatched.body));
    assert.equal(hatched.body.destination, 'sanctuary');
    assert.equal(hatched.body.character.pets.length, 2, 'a free carried slot does not divert the hatch from Sanctuary');
    assert.equal(hatched.body.character.petBreeding, null);
    assert.equal(hatched.body.character.petBreedingHatchReceipts[0].revealPending, true);
    const replay = await request(hatch, 'egghatched', { sessionId: args.sessionId });
    assert.equal(replay.body.pet.id, hatched.body.pet.id);
    assert.equal(replay.body._saveVersion, hatched.body._saveVersion);
    const ack = await request(hatch, 'egghatched', { sessionId: args.sessionId, acknowledgeReveal: true });
    assert.equal(ack.body.character.petBreedingHatchReceipts[0].revealPending, false);
    assert.equal(ack.body.character.petBreedingHatchReceipts[0].revealedAt, now);
    assert.equal((await request(hatch, 'egghatched', { sessionId: args.sessionId, acknowledgeReveal: true })).body._saveVersion, ack.body._saveVersion);
});

test('interrupted pairing and hatch saves recover the sealed outcome and one Sanctuary child', async context => {
    const now = 1_800_300_000_000;
    context.mock.method(Date, 'now', () => now);
    const args = await seed('eggrecovery', true, now);
    const originalCompareSet = kv.compareSet.bind(kv);
    let failNextSave = true;
    context.mock.method(kv, 'compareSet', async (key: string, ...rest: any[]) => {
        if (key === 'save:eggrecovery' && failNextSave) { failNextSave = false; throw new Error('QA interrupted save'); }
        return (originalCompareSet as (...args: any[]) => Promise<boolean>)(key, ...rest);
    });
    assert.equal((await request(start, 'eggrecovery', args)).status, 500);
    const paired = await request(start, 'eggrecovery', args);
    assert.equal(paired.status, 200);
    assert.equal(paired.body.session.sessionId, args.sessionId);
    assert.deepEqual(paired.body.character.pets.map((pet: Json) => pet.breedingUsesRemaining), [4, 4]);
    const saved = (await kv.get<Json>('save:eggrecovery'))!;
    saved.character.petBreeding.incubationRemainingMs = 0;
    await kv.set('save:eggrecovery', saved);
    failNextSave = true;
    assert.equal((await request(hatch, 'eggrecovery', { sessionId: args.sessionId })).status, 500);
    const recovered = await request(hatch, 'eggrecovery', { sessionId: args.sessionId });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.character.petBreedingHatchReceipts.length, 1);
    const sanctuary = await listPetSanctuary('eggrecovery');
    assert.equal(sanctuary.total, 1);
    assert.equal(sanctuary.items[0].pet.id, recovered.body.pet.id);
    assert.equal((await request(hatch, 'eggrecovery', { sessionId: args.sessionId })).body.pet.id, recovered.body.pet.id);
});
