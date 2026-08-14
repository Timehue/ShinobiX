import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'lapsed-pet-lifecycle-test-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const PLAYER = 'lapsedlifecycleprobe';
const PET_IDS = ['life-pet-1', 'life-pet-2', 'life-pet-3', 'life-pet-4', 'life-pet-5', 'life-pet-6'];

let breedingStart: Handler;
let expeditionStart: Handler;
let progress: Handler;
let evolve: Handler;
let kv: typeof import('../_storage.js').kv;
let playerToken = '';

function pet(id: string, patch: Record<string, unknown> = {}) {
    return {
        id,
        templateId: 'standard-0',
        name: id,
        rarity: 'standard',
        element: 'Fire',
        level: 50,
        maxLevel: 100,
        xp: 0,
        hp: 600,
        attack: 60,
        defense: 45,
        speed: 50,
        jutsus: [],
        breedingUsesMax: 5,
        breedingUsesRemaining: 5,
        ...patch,
    };
}

function character(pets = PET_IDS.map((id) => pet(id))) {
    return {
        name: PLAYER,
        level: 50,
        professionRank: 0,
        activePetId: PET_IDS[0],
        activePetId2v2: PET_IDS[1],
        patreon: { active: false, tier: 'shinobi-supporter' },
        pets,
    };
}

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

function request(body: Record<string, unknown>) {
    return {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-player-token': playerToken },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const auth = await import('../_auth.js');
    playerToken = auth.issuePlayerToken(PLAYER)!;
    breedingStart = (await import('./breeding-start.js')).default as unknown as Handler;
    expeditionStart = (await import('../missions/expedition-start.js')).default as unknown as Handler;
    progress = (await import('./progress.js')).default as unknown as Handler;
    evolve = (await import('./evolve.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('lapsed preserved overflow cannot start breeding, training, or reward expeditions', async () => {
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: character() });

    const breed = response();
    await breedingStart(request({
        playerName: PLAYER,
        parent1Id: PET_IDS[4],
        parent2Id: PET_IDS[5],
        requestId: 'lapsed-overflow-breed-request-001',
    }), breed.res);
    assert.equal(breed.out.statusCode, 409);
    assert.equal(breed.out.body?.error, 'pet-preserved-overflow');

    const train = response();
    await progress(request({
        playerName: PLAYER,
        petId: PET_IDS[4],
        action: 'start-training',
        focus: 'strength',
        durationMs: 60 * 60 * 1000,
    }), train.res);
    assert.equal(train.out.statusCode, 409);
    assert.match(String(train.out.body?.error), /preserved companion/i);

    const expedition = response();
    await expeditionStart(request({
        playerName: PLAYER,
        petId: PET_IDS[4],
        expType: 'scout',
        petLevel: 50,
    }), expedition.res);
    assert.equal(expedition.out.statusCode, 409);

    assert.equal(expedition.out.body?.error, 'pet-preserved-overflow');

    const stored = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
    const storedPets = (stored?.character as { pets?: Array<Record<string, unknown>> })?.pets ?? [];
    assert.equal(storedPets.length, 6, 'overflow ownership remains non-destructive');
    assert.equal(storedPets[4].training, undefined);
    assert.equal(storedPets[4].expedition, undefined);
});

test('lapse does not trap collection of a training session started while entitled', async () => {
    const pets = PET_IDS.map((id, index) => pet(id, index === 4 ? {
        training: { type: 'strength', startedAt: 1, endsAt: 2, durationMs: 1, sealedXp: 25 },
    } : {}));
    await kv.set(`save:${PLAYER}`, { _saveVersion: 10, character: character(pets) });

    const collect = response();
    await progress(request({
        playerName: PLAYER,
        petId: PET_IDS[4],
        action: 'complete-training',
    }), collect.res);
    assert.equal(collect.out.statusCode, 200);
    assert.equal(collect.out.body?.ok, true);
    assert.equal((collect.out.body?.pet as Record<string, unknown>)?.training, undefined);
    assert.equal((collect.out.body?.character as { pets?: unknown[] })?.pets?.length, 6);
});

test('an outstanding pet battle blocks lifecycle writes and preserves its sealed consumable', async () => {
    const battleToken = 'sealed-casual-battle-token';
    const pets = PET_IDS.map((id, index) => pet(id, index === 0 ? {
        loadout: { consumable: 'pet-focus-tonic' },
    } : {}));
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 20,
        character: { ...character(pets), inventory: [] },
    });
    await kv.set(`pet:battle-active:${PLAYER}`, battleToken, { ex: 900 });

    const equip = response();
    await progress(request({
        playerName: PLAYER,
        petId: PET_IDS[0],
        action: 'equip',
        slot: 'consumable',
    }), equip.res);
    assert.equal(equip.out.statusCode, 409);
    assert.equal(equip.out.body?.error, 'pet-is-in-active-battle');

    const breed = response();
    await breedingStart(request({
        playerName: PLAYER,
        parent1Id: PET_IDS[0],
        parent2Id: PET_IDS[1],
        requestId: 'active-battle-breed-request-001',
    }), breed.res);
    assert.equal(breed.out.statusCode, 409);

    const expedition = response();
    await expeditionStart(request({
        playerName: PLAYER,
        petId: PET_IDS[0],
        expType: 'scout',
        petLevel: 50,
    }), expedition.res);
    assert.equal(expedition.out.statusCode, 409);

    const evolution = response();
    await evolve(request({ playerName: PLAYER, petId: PET_IDS[0] }), evolution.res);
    assert.equal(evolution.out.statusCode, 409);
    assert.equal(evolution.out.body?.error, 'pet-is-in-active-battle');

    const stored = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
    const storedCharacter = stored?.character as { pets?: Array<Record<string, unknown>>; inventory?: unknown[] };
    assert.equal((storedCharacter.pets?.[0].loadout as Record<string, unknown>)?.consumable, 'pet-focus-tonic');
    assert.deepEqual(storedCharacter.inventory, []);
    assert.equal(await kv.get(`pet:battle-active:${PLAYER}`), battleToken, 'lifecycle cleanup cannot erase the real battle lease');
    await kv.delIfEqual(`pet:battle-active:${PLAYER}`, battleToken);
});
