import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'expedition-start-cas-test-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Json = Record<string, unknown>;
type Out = { statusCode: number; body?: Json };

const PLAYER = 'expeditionstartcasprobe';
const PET_ID = 'expedition-cas-pet';
const SAVE_KEY = `save:${PLAYER}`;

let expeditionStart: Handler;
let kv: typeof import('../_storage.js').kv;
let playerToken = '';

async function clearPlayerState() {
    const tokens = await kv.keys(`pet-exp-token:${PLAYER}:*`);
    await kv.del(SAVE_KEY, dailyKey(), `pet:battle-active:${PLAYER}`, ...tokens).catch(() => undefined);
}

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Json) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

function request() {
    return {
        method: 'POST',
        body: { playerName: PLAYER, petId: PET_ID, expType: 'scout' },
        headers: { 'content-type': 'application/json', 'x-player-token': playerToken },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

function dailyKey(): string {
    return `pet-exp-start-count:${PLAYER}:${new Date().toISOString().slice(0, 10)}`;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    playerToken = (await import('../_auth.js')).issuePlayerToken(PLAYER)!;
    expeditionStart = (await import('./expedition-start.js')).default as unknown as Handler;
});

after(async () => {
    const tokens = await kv.keys(`pet-exp-token:${PLAYER}:*`);
    await kv.del(SAVE_KEY, dailyKey(), `pet:battle-active:${PLAYER}`, ...tokens).catch(() => undefined);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('a definitive save CAS failure releases its daily reservation and exact token before retry', async () => {
    await clearPlayerState();
    const seed = {
        _saveVersion: 7,
        character: {
            name: PLAYER,
            level: 30,
            profession: 'petTamer',
            professionRank: 0,
            activePetId: PET_ID,
            pets: [{
                id: PET_ID,
                templateId: 'standard-0',
                name: 'CAS Pup',
                rarity: 'standard',
                element: 'Fire',
                level: 20,
                maxLevel: 100,
                xp: 0,
                hp: 320,
                attack: 40,
                defense: 28,
                speed: 30,
                jutsus: [],
                breedingUsesMax: 5,
                breedingUsesRemaining: 5,
            }],
        },
    };
    await kv.set(SAVE_KEY, seed);
    await kv.set(dailyKey(), 3, { ex: 25 * 60 * 60 });

    const originalCompareSet = kv.compareSet.bind(kv);
    let injected = false;
    kv.compareSet = (async (key, expected, value, options) => {
        if (key === SAVE_KEY && !injected) {
            injected = true;
            throw new Error('injected expedition save CAS failure');
        }
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;

    const failed = response();
    try {
        await expeditionStart(request(), failed.res);
    } finally {
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }

    assert.equal(injected, true);
    assert.equal(failed.out.statusCode, 500);
    assert.deepEqual(await kv.get(SAVE_KEY), seed, 'save and pet remain unchanged');
    assert.equal(await kv.get(dailyKey()), 3, 'the failed request does not consume a daily start');
    assert.deepEqual(await kv.keys(`pet-exp-token:${PLAYER}:*`), [], 'the failed request token is removed');

    const retried = response();
    await expeditionStart(request(), retried.res);
    assert.equal(retried.out.statusCode, 200, JSON.stringify(retried.out.body));
    const successorToken = String(retried.out.body?.token ?? '');
    assert.match(successorToken, /^[a-f0-9]{32}$/);
    assert.equal(await kv.get(dailyKey()), 4, 'the successful retry keeps exactly one reservation');
    assert.deepEqual(await kv.keys(`pet-exp-token:${PLAYER}:*`), [`pet-exp-token:${PLAYER}:${successorToken}`]);

    const stored = await kv.get<Json>(SAVE_KEY);
    const storedPet = ((stored?.character as { pets?: Json[] })?.pets ?? [])[0];
    assert.equal((storedPet.expedition as Json)?.token, successorToken, 'cleanup cannot delete the successor token');
});

test('a returned save validation rejection releases its daily reservation and token', async () => {
    await clearPlayerState();
    const busyPet = {
        id: PET_ID,
        templateId: 'standard-0',
        name: 'Busy Pup',
        rarity: 'standard',
        element: 'Fire',
        level: 20,
        maxLevel: 100,
        expedition: { type: 'scout', token: 'successor-token', endsAt: Date.now() + 60_000 },
    };
    const staleRead = { _saveVersion: 20, character: { name: PLAYER, profession: 'petTamer', pets: [{ ...busyPet, expedition: undefined }] } };
    const current = { _saveVersion: 21, character: { name: PLAYER, profession: 'petTamer', pets: [busyPet] } };
    await kv.set(SAVE_KEY, staleRead);
    await kv.set(dailyKey(), 5, { ex: 25 * 60 * 60 });

    const originalGet = kv.get.bind(kv);
    let saveReads = 0;
    kv.get = (async <T = unknown>(key: string) => {
        if (key === SAVE_KEY && saveReads++ === 0) return structuredClone(staleRead) as T;
        return originalGet<T>(key);
    }) as typeof kv.get;
    await kv.set(SAVE_KEY, current);

    const rejected = response();
    try {
        await expeditionStart(request(), rejected.res);
    } finally {
        kv.get = originalGet as typeof kv.get;
    }

    assert.equal(rejected.out.statusCode, 409);
    assert.equal(await kv.get(dailyKey()), 5);
    assert.deepEqual(await kv.keys(`pet-exp-token:${PLAYER}:*`), []);
    assert.deepEqual(await kv.get(SAVE_KEY), current);
});

test('a committed save with a lost acknowledgement retains its daily slot and exact reward token', async () => {
    await clearPlayerState();
    const seed = {
        _saveVersion: 30,
        character: {
            name: PLAYER,
            level: 30,
            profession: 'petTamer',
            activePetId: PET_ID,
            pets: [{ id: PET_ID, name: 'Ack Pup', level: 20, maxLevel: 100 }],
        },
    };
    await kv.set(SAVE_KEY, seed);
    await kv.set(dailyKey(), 8, { ex: 25 * 60 * 60 });

    const originalCompareSet = kv.compareSet.bind(kv);
    let injected = false;
    kv.compareSet = (async (key, expected, value, options) => {
        if (key === SAVE_KEY && !injected) {
            injected = true;
            assert.equal(await originalCompareSet(key, expected, value, options), true);
            throw new Error('injected expedition lost acknowledgement');
        }
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;

    const started = response();
    try {
        await expeditionStart(request(), started.res);
    } finally {
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }

    assert.equal(started.out.statusCode, 200, JSON.stringify(started.out.body));
    const token = String(started.out.body?.token ?? '');
    assert.equal(await kv.get(dailyKey()), 9);
    assert.ok(await kv.get(`pet-exp-token:${PLAYER}:${token}`));
    const stored = await kv.get<Json>(SAVE_KEY);
    const storedPet = ((stored?.character as { pets?: Json[] })?.pets ?? [])[0];
    assert.equal((storedPet.expedition as Json)?.token, token);
});

test('a lost daily-reservation acknowledgement is read back and rolled back after save CAS failure', async () => {
    await clearPlayerState();
    const seed = {
        _saveVersion: 40,
        character: {
            name: PLAYER,
            level: 30,
            profession: 'petTamer',
            activePetId: PET_ID,
            pets: [{ id: PET_ID, name: 'Counter Pup', level: 20, maxLevel: 100 }],
        },
    };
    await kv.set(SAVE_KEY, seed);
    await kv.set(dailyKey(), 10, { ex: 25 * 60 * 60 });

    const originalSet = kv.set.bind(kv);
    const originalCompareSet = kv.compareSet.bind(kv);
    let counterAckLost = false;
    kv.set = (async (key, value, options) => {
        if (key === dailyKey() && !counterAckLost) {
            counterAckLost = true;
            assert.equal(await originalSet(key, value, options), 'OK');
            throw new Error('injected daily reservation lost acknowledgement');
        }
        return originalSet(key, value, options);
    }) as typeof kv.set;
    kv.compareSet = (async (key, expected, value, options) => {
        if (key === SAVE_KEY) throw new Error('injected save CAS failure after counter lost ack');
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;

    const failed = response();
    try {
        await expeditionStart(request(), failed.res);
    } finally {
        kv.set = originalSet as typeof kv.set;
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }

    assert.equal(counterAckLost, true);
    assert.equal(failed.out.statusCode, 500);
    assert.deepEqual(await kv.get(SAVE_KEY), seed);
    assert.equal(await kv.get(dailyKey()), 10, 'the acknowledged-by-readback reservation is decremented');
    assert.deepEqual(await kv.keys(`pet-exp-token:${PLAYER}:*`), []);
});
