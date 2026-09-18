process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'pet-roster-roles-test-admin';

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * The Active pick and the 2v2 Partner lead activeTrainingPetIds, so they decide
 * which five companions may train. They used to be local edits carried by the
 * debounced autosave: a Supporter who set their sixth carried pet as Active and
 * pressed Start Training straight away was refused, because start-training read
 * the stored roster first. These drive the mounted handler over the in-memory
 * KV to prove the role now settles on the server before training reads it.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let PET_BREEDING_MIGRATION_VERSION: number;

const PLAYER = 'petrosterroleowner';
const SAVE_KEY = `save:${PLAYER}`;
const PET_IDS = ['pet-1', 'pet-2', 'pet-3', 'pet-4', 'pet-5', 'pet-6'];

function response() {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function post(body: Json) {
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { playerName: PLAYER, ...body },
        query: {},
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD, 'x-forwarded-for': '127.0.0.92' },
        socket: { remoteAddress: '127.0.0.92' },
    } as never, res);
    return out;
}

async function seed({ supporter }: { supporter: boolean }) {
    await kv.set(SAVE_KEY, {
        _saveVersion: 3,
        _saveAt: Date.now(),
        character: {
            name: PLAYER,
            level: 10,
            petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            inventory: [],
            itemStacks: [],
            pets: PET_IDS.map((id, i) => ({ id, name: `Pet ${i + 1}`, level: 5, maxLevel: 50, element: 'Fire', happiness: 80 })),
            patreon: { active: supporter, tier: 'shinobi-supporter', source: 'admin' },
        },
    });
}

async function stored(): Promise<Json> {
    return await kv.get<Json>(SAVE_KEY) as Json;
}

const character = (record: Json) => record.character as Json;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('./_owned-pet.js'));
    handler = (await import('./progress.js')).default as unknown as Handler;
});

after(async () => {
    await kv.del(SAVE_KEY);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

describe('pet roster roles settle on the server', { concurrency: false }, () => {
    it('lets a Supporter train their sixth carried pet as soon as Set as Active returns', async () => {
        await seed({ supporter: true });
        const refused = await post({ action: 'start-training', petId: 'pet-6', focus: 'bond', durationMs: 900_000 });
        assert.equal(refused.statusCode, 409, 'the sixth carried pet is outside the training five until it takes a role');

        const assigned = await post({ action: 'set-active', petId: 'pet-6' });
        assert.equal(assigned.statusCode, 200, JSON.stringify(assigned.body));
        assert.equal(character(assigned.body!).activePetId, 'pet-6', 'the reply carries the new role, so the client cannot fall back to the old one');
        assert.equal(assigned.body!._saveVersion, 4);
        assert.equal(character(await stored()).activePetId, 'pet-6');

        const trained = await post({ action: 'start-training', petId: 'pet-6', focus: 'bond', durationMs: 900_000 });
        assert.equal(trained.statusCode, 200, JSON.stringify(trained.body));
        assert.equal(character(trained.body!).activePetId, 'pet-6', 'a later pet reply keeps the Active pick');
        const pet6 = (character(await stored()).pets as Json[]).find((p) => p.id === 'pet-6')!;
        assert.ok(pet6.training, 'training started on the sixth pet');
    });

    it('treats the 2v2 Partner as an explicit assign or clear, so a retry cannot flip it back', async () => {
        await seed({ supporter: true });
        const assigned = await post({ action: 'set-partner', petId: 'pet-6', assign: true });
        assert.equal(assigned.statusCode, 200, JSON.stringify(assigned.body));
        assert.equal(character(await stored()).activePetId2v2, 'pet-6');

        const retried = await post({ action: 'set-partner', petId: 'pet-6', assign: true });
        assert.equal(retried.statusCode, 200);
        assert.equal(character(await stored()).activePetId2v2, 'pet-6', 'a repeated assign keeps the partner');
        assert.equal((await stored())._saveVersion, assigned.body!._saveVersion, 'an unchanged role does not bump the save version');

        const cleared = await post({ action: 'set-partner', petId: 'pet-6', assign: false });
        assert.equal(cleared.statusCode, 200);
        assert.equal(character(await stored()).activePetId2v2, undefined);

        await post({ action: 'set-partner', petId: 'pet-2', assign: true });
        const clearOther = await post({ action: 'set-partner', petId: 'pet-6', assign: false });
        assert.equal(clearOther.statusCode, 200);
        assert.equal(character(await stored()).activePetId2v2, 'pet-2', 'clearing a pet that is not the partner leaves the real partner alone');
    });

    it('refuses a role for preserved overflow and leaves the save untouched', async () => {
        await seed({ supporter: false });
        const before = await stored();
        const refused = await post({ action: 'set-active', petId: 'pet-6' });
        assert.equal(refused.statusCode, 409);
        assert.match(String(refused.body?.error), /preserved companion into your carried roster through the Sanctuary/);
        const after = await stored();
        assert.equal(after._saveVersion, before._saveVersion);
        assert.equal(character(after).activePetId, undefined);

        const partner = await post({ action: 'set-partner', petId: 'pet-6', assign: true });
        assert.equal(partner.statusCode, 409);
        assert.equal(character(await stored()).activePetId2v2, undefined);
    });
});
