import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'weekly-boss-generation-full-admin-password';
process.env.ADMIN_SESSION_SECRET = 'weekly-boss-generation-session-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Json = Record<string, unknown>;
type Out = { statusCode: number; body?: Json };

const BOSS_KEY = 'game:weekly-boss-state';
const BOSS_LOCK_KEY = `lock:${BOSS_KEY}`;
const PLAYER = 'weeklygenerationplayer';
const SAVE_KEY = `save:${PLAYER}`;
const ANNOUNCEMENTS_KEY = 'game:announcements';
const ANNOUNCEMENTS_SEQ = 'game:announcements-seq';
const CHAT_KEYS = [
    'chat:village:stormveil-village',
    'chat:village:ashen-leaf-village',
    'chat:village:frostfang-village',
    'chat:village:moonshadow-village',
];
const REQUEST_FIRST = '10000000-0000-4000-8000-000000000001';
const REQUEST_RACE_B = '10000000-0000-4000-8000-000000000002';
const REQUEST_PENDING_B = '10000000-0000-4000-8000-000000000003';
const REQUEST_CONCURRENT_B = '10000000-0000-4000-8000-000000000004';
const REQUEST_CONCURRENT_C = '10000000-0000-4000-8000-000000000005';
const REQUEST_REPLAY_B = '10000000-0000-4000-8000-000000000006';
const REQUEST_REPLAY_C = '10000000-0000-4000-8000-000000000007';

let kv: typeof import('./_storage.js').kv;
let handler: Handler;

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(statusCode: number) { out.statusCode = statusCode; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function invoke(method: 'GET' | 'POST', body: Json = {}): Promise<Out> {
    const { out, res } = response();
    await handler({
        method,
        query: {},
        headers: {
            'content-type': 'application/json',
            'x-admin-password': process.env.ADMIN_PASSWORD!,
        },
        body,
        socket: { remoteAddress: '127.0.0.85' },
    } as never, res);
    return out;
}

function bossState(spawnId: string, expired: boolean): Json {
    const now = Date.now();
    return {
        spawnId,
        weekKey: 'generation-integrity-week',
        aiId: 'moonshadow-oni',
        bossName: 'Moonshadow Oni',
        hpMax: 100_000,
        hpRemaining: 100_000,
        scaleFactor: 2,
        damageByPlayer: { [PLAYER]: 50_000 },
        attemptsByPlayer: { [PLAYER]: 1 },
        startedAt: now - 73 * 60 * 60_000,
        expiresAt: expired ? now - 1_000 : now + 60 * 60_000,
    };
}

function playerSave(): Json {
    return {
        _saveVersion: 7,
        character: {
            name: PLAYER,
            level: 1,
            unspentStats: 0,
            spentStats: {},
            examsPassed: [],
            ryo: 100,
            inventory: [],
            maxHp: 100,
            maxChakra: 100,
            maxStamina: 100,
            hp: 10,
            chakra: 10,
            stamina: 10,
        },
    };
}

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((accept, decline) => {
        resolve = accept;
        reject = decline;
    });
    return { promise, resolve, reject };
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5_000);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

async function clearMemoryKv() {
    const keys = await kv.keys('*');
    if (keys.length > 0) await kv.del(...keys);
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    handler = (await import('./weekly-boss.js')).default as unknown as Handler;
});

beforeEach(clearMemoryKv);

after(async () => {
    await clearMemoryKv();
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_SESSION_SECRET;
});

test('first spawn requires an explicit null generation expectation', async () => {
    const missing = await invoke('POST', { kind: 'reset' });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.body?.code, 'weekly-boss-reset-expected-required');
    assert.equal(await kv.get(BOSS_KEY), null);
    assert.equal(await kv.get(ANNOUNCEMENTS_KEY), null);

    const missingRequest = await invoke('POST', { kind: 'reset', expectedSpawnId: null });
    assert.equal(missingRequest.statusCode, 400);
    assert.equal(missingRequest.body?.code, 'weekly-boss-reset-request-invalid');
    assert.equal(await kv.get(BOSS_KEY), null);

    const accepted = await invoke('POST', { kind: 'reset', expectedSpawnId: null, requestedSpawnId: REQUEST_FIRST });
    assert.equal(accepted.statusCode, 200);
    const boss = accepted.body?.boss as Json;
    assert.equal(typeof boss?.spawnId, 'string');
    assert.equal((await kv.get<Json>(BOSS_KEY))?.spawnId, boss.spawnId);
});

test('a late phase-3 continuation for A cannot contaminate B while A pays exactly once', { concurrency: false }, async () => {
    const spawnA = 'generation-race-spawn-a';
    await kv.set(BOSS_KEY, bossState(spawnA, true));
    await kv.set(SAVE_KEY, playerSave());

    const originalSet = kv.set.bind(kv);
    const phaseThreeWaiting = deferred();
    const releasePhaseThree = deferred();
    let bossLockAttempts = 0;
    kv.set = (async (key, value, options) => {
        if (key === BOSS_LOCK_KEY && options?.nx) {
            bossLockAttempts += 1;
            if (bossLockAttempts === 2) {
                phaseThreeWaiting.resolve();
                await releasePhaseThree.promise;
            }
        }
        return originalSet(key, value, options);
    }) as typeof kv.set;

    const oldDistribution = invoke('GET');
    try {
        await bounded(phaseThreeWaiting.promise, 'A distribution before phase-3 lock acquisition');
        const reset = await bounded(invoke('POST', {
            kind: 'reset',
            expectedSpawnId: spawnA,
            requestedSpawnId: REQUEST_RACE_B,
        }), 'reset to settle A and install B');
        assert.equal(reset.statusCode, 200);
        const spawned = reset.body?.boss as Json;
        assert.equal(typeof spawned?.spawnId, 'string');
        assert.notEqual(spawned.spawnId, spawnA);

        const cleanB = await kv.get<Json>(BOSS_KEY);
        assert.equal(cleanB?.spawnId, spawned.spawnId);
        assert.deepEqual(cleanB?.damageByPlayer, {});
        assert.equal(cleanB?.distributionSummary, undefined);
        assert.equal(cleanB?.creditedPlayers, undefined);
        assert.equal(cleanB?.rewardsDistributed, undefined);

        releasePhaseThree.resolve();
        const oldRead = await bounded(oldDistribution, 'late A phase-3 completion');
        assert.equal(oldRead.statusCode, 200);
        assert.deepEqual(await kv.get(BOSS_KEY), cleanB, 'late A finalization must leave B byte-identical');

        const saved = await kv.get<{ character?: Json }>(SAVE_KEY);
        assert.equal(saved?.character?.ryo, 137_875);
        assert.equal(saved?.character?.unspentStats, 10);
        assert.deepEqual(saved?.character?.inventory, ['weekly-boss-core', 'dungeon-key']);
        assert.equal((saved?.character?.serverSettlementReceipts as unknown[])?.length, 1);
    } finally {
        releasePhaseThree.resolve();
        kv.set = originalSet as typeof kv.set;
        await oldDistribution.catch(() => undefined);
    }
});

test('reset returns 409 and preserves expired authority when a contributor cannot be settled', { concurrency: false }, async () => {
    const spawnA = 'generation-pending-spawn-a';
    const originalBoss = bossState(spawnA, true);
    const originalSave = playerSave();
    await kv.set(BOSS_KEY, originalBoss);
    await kv.set(SAVE_KEY, originalSave);

    const originalSet = kv.set.bind(kv);
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    kv.set = (async (key, value, options) => {
        if (key === SAVE_KEY) throw new Error('injected Weekly Boss player-credit outage');
        return originalSet(key, value, options);
    }) as typeof kv.set;
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    let rejected: Out;
    try {
        rejected = await invoke('POST', { kind: 'reset', expectedSpawnId: spawnA, requestedSpawnId: REQUEST_PENDING_B });
    } finally {
        console.warn = originalWarn;
        kv.set = originalSet as typeof kv.set;
    }

    assert.equal(rejected.statusCode, 409);
    assert.equal(rejected.body?.code, 'weekly-boss-reset-distribution-pending');
    const retained = await kv.get<Json>(BOSS_KEY);
    assert.equal(retained?.spawnId, spawnA);
    assert.equal(retained?.rewardsDistributed, undefined);
    assert.ok(Array.isArray(retained?.distributionSummary));
    assert.equal((retained?.distributionSummary as unknown[]).length, 1);
    assert.equal(typeof retained?.distributedAt, 'number');
    assert.deepEqual(await kv.get(SAVE_KEY), originalSave);
    assert.equal(await kv.get(ANNOUNCEMENTS_KEY), null, 'a rejected reset must not herald a replacement');
    assert.equal(warnings.length, 1, 'the failed contributor remains explicitly retryable');

    const recovered = await invoke('POST', { kind: 'reset', expectedSpawnId: spawnA, requestedSpawnId: REQUEST_PENDING_B });
    assert.equal(recovered.statusCode, 200, 'a later retry settles the retained authority before replacement');
    const paid = await kv.get<{ character?: Json }>(SAVE_KEY);
    assert.equal(paid?.character?.ryo, 137_875);
    assert.equal((paid?.character?.serverSettlementReceipts as unknown[])?.length, 1);
    assert.notEqual((await kv.get<Json>(BOSS_KEY))?.spawnId, spawnA);
});

test('two resets with one expected generation produce one spawn and one ordered announcement', { concurrency: false }, async () => {
    const spawnA = 'generation-duplicate-spawn-a';
    await kv.set(BOSS_KEY, bossState(spawnA, false));

    const originalSet = kv.set.bind(kv);
    const replacementWaiting = deferred();
    const releaseReplacement = deferred();
    const contentionSeen = deferred();
    let replacementBlocked = false;
    kv.set = (async (key, value, options) => {
        if (
            key === BOSS_KEY
            && value
            && typeof value === 'object'
            && !Array.isArray(value)
            && typeof (value as Json).spawnId === 'string'
            && (value as Json).spawnId !== spawnA
            && !replacementBlocked
        ) {
            replacementBlocked = true;
            replacementWaiting.resolve();
            await releaseReplacement.promise;
        }
        const result = await originalSet(key, value, options);
        if (key === BOSS_LOCK_KEY && options?.nx && replacementBlocked && result === null) {
            contentionSeen.resolve();
        }
        return result;
    }) as typeof kv.set;

    const first = invoke('POST', { kind: 'reset', expectedSpawnId: spawnA, requestedSpawnId: REQUEST_CONCURRENT_B });
    let second: Promise<Out> | undefined;
    try {
        await bounded(replacementWaiting.promise, 'first reset state write under the generation lock');
        second = invoke('POST', { kind: 'reset', expectedSpawnId: spawnA, requestedSpawnId: REQUEST_CONCURRENT_C });
        await bounded(contentionSeen.promise, 'second reset contention on the generation lock');
        releaseReplacement.resolve();

        const results = await bounded(Promise.all([first, second]), 'both reset responses');
        assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
        const accepted = results.find((result) => result.statusCode === 200)!;
        const stale = results.find((result) => result.statusCode === 409)!;
        assert.equal(stale.body?.code, 'weekly-boss-reset-stale-generation');

        const acceptedBoss = accepted.body?.boss as Json;
        const finalBoss = await kv.get<Json>(BOSS_KEY);
        assert.equal(finalBoss?.spawnId, acceptedBoss.spawnId);
        assert.notEqual(finalBoss?.spawnId, spawnA);

        const announcements = await kv.get<Array<Json>>(ANNOUNCEMENTS_KEY);
        assert.equal(announcements?.length, 1);
        assert.equal(announcements?.[0]?.receiptId, `weekly-boss-spawn:${finalBoss?.spawnId}`);
        assert.equal((announcements?.[0]?.meta as Json)?.spawnId, finalBoss?.spawnId);
        assert.equal(await kv.get(ANNOUNCEMENTS_SEQ), 1);
        for (const chatKey of CHAT_KEYS) {
            const chat = await kv.get<Array<Json>>(chatKey);
            assert.equal(chat?.length, 1, `${chatKey} receives exactly one herald line`);
            assert.equal(chat?.[0]?.receiptId, `weekly-boss-spawn:${finalBoss?.spawnId}`);
        }
    } finally {
        releaseReplacement.resolve();
        kv.set = originalSet as typeof kv.set;
        await first.catch(() => undefined);
        await second?.catch(() => undefined);
    }
});

test('a committed reset with a lost response replays one boss and one herald before a new intent may replace it', { concurrency: false }, async () => {
    const spawnA = 'generation-response-loss-spawn-a';
    await kv.set(BOSS_KEY, bossState(spawnA, false));

    const first = await invoke('POST', {
        kind: 'reset',
        expectedSpawnId: spawnA,
        requestedSpawnId: REQUEST_REPLAY_B,
    });
    assert.equal(first.statusCode, 200);
    assert.equal((first.body?.boss as Json)?.spawnId, REQUEST_REPLAY_B);
    const bossAfterFirst = await kv.get<Json>(BOSS_KEY);
    const announcementsAfterFirst = await kv.get<Array<Json>>(ANNOUNCEMENTS_KEY);
    const sequenceAfterFirst = await kv.get(ANNOUNCEMENTS_SEQ);
    const chatsAfterFirst = await Promise.all(CHAT_KEYS.map((key) => kv.get<Array<Json>>(key)));

    // Simulate the client losing the first 200 and replaying its persisted
    // predecessor/request pair. The requested spawn ID is the durable receipt.
    const replay = await invoke('POST', {
        kind: 'reset',
        expectedSpawnId: spawnA,
        requestedSpawnId: REQUEST_REPLAY_B,
    });
    assert.equal(replay.statusCode, 200);
    assert.equal((replay.body?.boss as Json)?.spawnId, REQUEST_REPLAY_B);
    assert.deepEqual(await kv.get(BOSS_KEY), bossAfterFirst, 'response recovery leaves the boss byte-identical');
    assert.deepEqual(await kv.get(ANNOUNCEMENTS_KEY), announcementsAfterFirst);
    assert.equal(await kv.get(ANNOUNCEMENTS_SEQ), sequenceAfterFirst);
    const chatsAfterReplay = await Promise.all(CHAT_KEYS.map((key) => kv.get<Array<Json>>(key)));
    assert.deepEqual(chatsAfterReplay, chatsAfterFirst);
    assert.equal(announcementsAfterFirst?.length, 1);
    for (const chat of chatsAfterReplay) {
        assert.equal(chat?.length, 1);
        assert.equal(chat?.[0]?.receiptId, `weekly-boss-spawn:${REQUEST_REPLAY_B}`);
    }

    const next = await invoke('POST', {
        kind: 'reset',
        expectedSpawnId: REQUEST_REPLAY_B,
        requestedSpawnId: REQUEST_REPLAY_C,
    });
    assert.equal(next.statusCode, 200);
    assert.equal((next.body?.boss as Json)?.spawnId, REQUEST_REPLAY_C);
    assert.equal((await kv.get<Json>(BOSS_KEY))?.spawnId, REQUEST_REPLAY_C);
    assert.equal((await kv.get<Array<Json>>(ANNOUNCEMENTS_KEY))?.length, 2);
});

test('an exact reset replay repairs a committed spawn whose herald never landed', { concurrency: false }, async () => {
    const committed = {
        ...bossState(REQUEST_REPLAY_B, false),
        spawnId: REQUEST_REPLAY_B,
        damageByPlayer: {},
        attemptsByPlayer: {},
    };
    await kv.set(BOSS_KEY, committed);
    assert.equal(await kv.get(ANNOUNCEMENTS_KEY), null);

    const replay = await invoke('POST', {
        kind: 'reset',
        expectedSpawnId: 'generation-herald-predecessor-a',
        requestedSpawnId: REQUEST_REPLAY_B,
    });
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(await kv.get(BOSS_KEY), committed);
    const announcements = await kv.get<Array<Json>>(ANNOUNCEMENTS_KEY);
    assert.equal(announcements?.length, 1);
    assert.equal(announcements?.[0]?.receiptId, `weekly-boss-spawn:${REQUEST_REPLAY_B}`);
    for (const chatKey of CHAT_KEYS) {
        const chat = await kv.get<Array<Json>>(chatKey);
        assert.equal(chat?.length, 1);
        assert.equal(chat?.[0]?.receiptId, `weekly-boss-spawn:${REQUEST_REPLAY_B}`);
    }
});
