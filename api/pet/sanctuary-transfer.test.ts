import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'sanctuary-transfer-test-session-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const CONFLICT_PLAYER = 'sanctuaryleaseprobe';
const FAULT_PLAYER = 'sanctuaryfaultprobe';

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let sanctuary: typeof import('./_sanctuary.js');

const pet = (id: string, patch: Record<string, unknown> = {}) => ({
    id,
    templateId: 'starter-fire',
    name: id,
    rarity: 'standard',
    level: 20,
    xp: 0,
    maxLevel: 100,
    hp: 300,
    attack: 60,
    defense: 40,
    speed: 35,
    unlockedForPve: true,
    jutsus: [],
    ...patch,
});

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

function request(playerName: string, body: Record<string, unknown>) {
    return {
        method: 'POST',
        body: { playerName, ...body },
        headers: {
            'content-type': 'application/json',
            'x-player-token': issuePlayerToken(playerName)!,
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

async function post(playerName: string, body: Record<string, unknown>): Promise<Out> {
    const out = response();
    await handler(request(playerName, body), out.res);
    return out.out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    sanctuary = await import('./_sanctuary.js');
    handler = (await import('./sanctuary-transfer.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('an outstanding pet-battle lease blocks deposit, withdraw, and release without changing either store', { concurrency: false }, async () => {
    const carried = pet('carried-pet', {
        loadout: { consumable: { id: 'soldier-pill', name: 'Soldier Pill' } },
    });
    await kv.set(`save:${CONFLICT_PLAYER}`, {
        _saveVersion: 7,
        character: { name: CONFLICT_PLAYER, pets: [carried] },
    });
    await sanctuary.storePetInSanctuary(CONFLICT_PLAYER, pet('stored-withdraw'), 'roster');
    await sanctuary.storePetInSanctuary(CONFLICT_PLAYER, pet('stored-release'), 'roster');

    const activeToken = 'live-pet-battle-token';
    await kv.set(`pet:battle-active:${CONFLICT_PLAYER}`, activeToken, { ex: 900 });

    for (const [action, petId] of [
        ['to-sanctuary', 'carried-pet'],
        ['to-roster', 'stored-withdraw'],
        ['release', 'stored-release'],
    ] as const) {
        const denied = await post(CONFLICT_PLAYER, { action, petId });
        assert.equal(denied.statusCode, 409, action);
        assert.equal(denied.body?.error, 'pet-is-in-active-battle', action);
        assert.match(String(denied.body?.message), /finish or settle your active pet battle/i, action);
    }

    assert.equal(await kv.get(`pet:battle-active:${CONFLICT_PLAYER}`), activeToken, 'a denied transfer cannot erase the real battle lease');
    const saved = await kv.get<{ _saveVersion?: number; character?: { pets?: Array<Record<string, unknown>> } }>(`save:${CONFLICT_PLAYER}`);
    assert.equal(saved?._saveVersion, 7);
    assert.equal(saved?.character?.pets?.length, 1);
    assert.deepEqual((saved?.character?.pets?.[0]?.loadout as { consumable?: unknown })?.consumable, { id: 'soldier-pill', name: 'Soldier Pill' });
    assert.equal(await sanctuary.getPetFromSanctuary(CONFLICT_PLAYER, 'carried-pet'), null);
    assert.ok(await sanctuary.getPetFromSanctuary(CONFLICT_PLAYER, 'stored-withdraw'));
    assert.ok(await sanctuary.getPetFromSanctuary(CONFLICT_PLAYER, 'stored-release'));
    assert.equal((await sanctuary.listPetSanctuary(CONFLICT_PLAYER)).total, 2);
});

test('a confirmed lost save-write acknowledgement releases the temporary lease and replays the committed deposit once', { concurrency: false }, async () => {
    const saveKey = `save:${FAULT_PLAYER}`;
    const activeKey = `pet:battle-active:${FAULT_PLAYER}`;
    await kv.set(saveKey, {
        _saveVersion: 11,
        character: {
            name: FAULT_PLAYER,
            pets: [pet('fault-pet', { loadout: { consumable: { id: 'chakra-tonic' } } })],
        },
    });

    const originalCompareSet = kv.compareSet.bind(kv);
    let loseSaveAcknowledgement = true;
    kv.compareSet = async (key, expected, value, options) => {
        const result = await originalCompareSet(key, expected, value, options);
        if (key === saveKey && loseSaveAcknowledgement) {
            loseSaveAcknowledgement = false;
            throw new Error('injected save acknowledgement loss');
        }
        return result;
    };

    let first: Out;
    try {
        first = await post(FAULT_PLAYER, { action: 'to-sanctuary', petId: 'fault-pet' });
    } finally {
        kv.compareSet = originalCompareSet;
    }

    assert.equal(first.statusCode, 200);
    assert.equal(first.body?.replayed, false);
    assert.equal(await kv.get(activeKey), null, 'the temporary mutation lease is released after acknowledgement recovery');
    const committed = await kv.get<{ _saveVersion?: number; character?: { pets?: unknown[] } }>(saveKey);
    assert.equal(committed?._saveVersion, 12);
    assert.deepEqual(committed?.character?.pets, []);
    assert.deepEqual(
        ((await sanctuary.getPetFromSanctuary(FAULT_PLAYER, 'fault-pet'))?.pet.loadout as { consumable?: unknown })?.consumable,
        { id: 'chakra-tonic' },
    );

    const retry = await post(FAULT_PLAYER, { action: 'to-sanctuary', petId: 'fault-pet' });
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body?.replayed, true);
    assert.equal(await kv.get(activeKey), null);
    const listed = await sanctuary.listPetSanctuary(FAULT_PLAYER);
    assert.equal(listed.total, 1);
    assert.deepEqual(listed.items.map((item) => item.pet.id), ['fault-pet']);
});
