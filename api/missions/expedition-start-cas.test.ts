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
const LAUNCH_ID = '11111111-2222-4333-8444-555555555555';
const TOKEN = LAUNCH_ID.replace(/-/g, '');

let expeditionStart: Handler;
let kv: typeof import('../_storage.js').kv;
let playerToken = '';

function seedSave(extraPet: Json = {}): Json {
    return {
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
                ...extraPet,
            }],
        },
    };
}

async function clearPlayerState() {
    const tokens = await kv.keys(`pet-exp-token:${PLAYER}:*`);
    await kv.del(SAVE_KEY, legacyDailyKey(), ...tokens).catch(() => undefined);
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

function request(launchId = LAUNCH_ID) {
    return {
        method: 'POST',
        body: { playerName: PLAYER, petId: PET_ID, expType: 'scout', launchId },
        headers: { 'content-type': 'application/json', 'x-player-token': playerToken },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

function legacyDailyKey(): string {
    return `pet-exp-start-count:${PLAYER}:${new Date().toISOString().slice(0, 10)}`;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    playerToken = (await import('../_auth.js')).issuePlayerToken(PLAYER)!;
    expeditionStart = (await import('./expedition-start.js')).default as unknown as Handler;
});

after(async () => {
    await clearPlayerState();
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('a definitive save CAS failure consumes neither the save-native allowance nor token', async () => {
    await clearPlayerState();
    const seed = seedSave();
    await kv.set(SAVE_KEY, seed);
    await kv.set(legacyDailyKey(), 3, { ex: 25 * 60 * 60 });

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
    assert.deepEqual(await kv.get(SAVE_KEY), seed);
    assert.equal(await kv.get(legacyDailyKey()), 3, 'the deployment bridge remains read-only');
    assert.deepEqual(await kv.keys(`pet-exp-token:${PLAYER}:*`), []);

    const retried = response();
    await expeditionStart(request(), retried.res);
    assert.equal(retried.out.statusCode, 200, JSON.stringify(retried.out.body));
    assert.equal(retried.out.body?.token, TOKEN);
    const stored = await kv.get<Json>(SAVE_KEY);
    assert.equal(stored?._saveVersion, 8);
    const character = stored?.character as Json;
    assert.equal((character.expeditionStartAllowance as Json)?.count, 4);
});

test('a busy-pet validation rejection leaves the exact predecessor untouched', async () => {
    await clearPlayerState();
    const seed = seedSave({ expedition: { type: 'scout', token: 'successor', endsAt: Date.now() + 60_000 } });
    await kv.set(SAVE_KEY, seed);

    const rejected = response();
    await expeditionStart(request(), rejected.res);

    assert.equal(rejected.out.statusCode, 409);
    assert.deepEqual(await kv.get(SAVE_KEY), seed);
    assert.deepEqual(await kv.keys(`pet-exp-token:${PLAYER}:*`), []);
});

test('a committed save whose CAS acknowledgement is lost is read back exactly', async () => {
    await clearPlayerState();
    await kv.set(SAVE_KEY, seedSave());

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
    assert.equal(started.out.body?.token, TOKEN);
    assert.ok(await kv.get(`pet-exp-token:${PLAYER}:${TOKEN}`));
    const stored = await kv.get<Json>(SAVE_KEY);
    assert.equal(stored?._saveVersion, 8);
});

test('a lost token-cache publication replays the committed launch without another save bump', async () => {
    await clearPlayerState();
    await kv.set(SAVE_KEY, seedSave());

    const originalSet = kv.set.bind(kv);
    let injected = false;
    kv.set = (async (key, value, options) => {
        if (key === `pet-exp-token:${PLAYER}:${TOKEN}` && !injected) {
            injected = true;
            throw new Error('injected token publication failure');
        }
        return originalSet(key, value, options);
    }) as typeof kv.set;

    const failed = response();
    try {
        await expeditionStart(request(), failed.res);
    } finally {
        kv.set = originalSet as typeof kv.set;
    }
    assert.equal(failed.out.statusCode, 500);
    assert.equal((await kv.get<Json>(SAVE_KEY))?._saveVersion, 8, 'the launch committed before cache publication');

    const replay = response();
    await expeditionStart(request(), replay.res);
    assert.equal(replay.out.statusCode, 200, JSON.stringify(replay.out.body));
    assert.equal(replay.out.body?.replayed, true);
    assert.equal(replay.out.body?.token, TOKEN);
    assert.equal((await kv.get<Json>(SAVE_KEY))?._saveVersion, 8, 'replay does not mutate the save');
    assert.ok(await kv.get(`pet-exp-token:${PLAYER}:${TOKEN}`));
});
