import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'hollow-gate-start-rollback-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

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

async function postStart(playerName: string, requestId: string): Promise<Out> {
    const out = response();
    await handler({
        method: 'POST',
        body: { playerName, requestId },
        headers: {
            'content-type': 'application/json',
            'x-player-token': issuePlayerToken(playerName)!,
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, out.res);
    return out.out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./start.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('a definitive save CAS failure rolls back only its Hollow Gate reservation and the same request can retry', async () => {
    const playerName = 'hg-start-rollback';
    const requestId = 'hg-start-request-rollback';
    const saveKey = `save:${playerName}`;
    const countKey = `hg-runs:${playerName}:${new Date().toISOString().slice(0, 10)}`;
    const existingRunKey = `hg-run:${playerName}:preexisting-orphan`;
    const existingRun = { marker: 'belongs-to-an-earlier-request' };
    const originalSave = {
        _saveVersion: 7,
        character: {
            name: playerName,
            level: 20,
            hp: 500,
            maxHp: 500,
            itemStacks: [{ itemId: 'hollow-gate-key', count: 2 }],
        },
    };
    await kv.set(saveKey, originalSave);
    await kv.set(countKey, 1);
    await kv.set(existingRunKey, existingRun);

    const originalCompareSet = kv.compareSet.bind(kv);
    let injected = false;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        if (!injected && key === saveKey) {
            injected = true;
            throw new Error('injected-hollow-gate-save-cas-failure');
        }
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;

    let failed: Out;
    try {
        failed = await postStart(playerName, requestId);
    } finally {
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }

    assert.equal(injected, true);
    assert.equal(failed.statusCode, 500);
    assert.deepEqual(await kv.get(saveKey), originalSave, 'the failed save and its entry key stay unchanged');
    assert.equal(await kv.get(countKey), 1, 'exactly the failed daily reservation is removed');
    assert.deepEqual(await kv.keys(`hg-run:${playerName}:*`), [existingRunKey], 'only the failed request run token is removed');
    assert.deepEqual(await kv.get(existingRunKey), existingRun, 'an unrelated pre-existing run token is untouched');

    const retry = await postStart(playerName, requestId);
    assert.equal(retry.statusCode, 200);
    assert.equal(await kv.get(countKey), 2);
    const retryRunKey = `hg-run:${playerName}:${String(retry.body?.token ?? '')}`;
    const runKeys = (await kv.keys(`hg-run:${playerName}:*`)).sort();
    assert.deepEqual(runKeys, [existingRunKey, retryRunKey].sort());
    const saved = await kv.get<{ character?: { itemStacks?: Array<{ itemId?: string; count?: number }> } }>(saveKey);
    assert.deepEqual(saved?.character?.itemStacks, [{ itemId: 'hollow-gate-key', count: 1 }]);
});

test('a lost counter-write acknowledgement is tracked and rolled back when the following save CAS fails', async () => {
    const playerName = 'hg-start-counter-lost-ack';
    const requestId = 'hg-start-counter-lost-ack-request';
    const saveKey = `save:${playerName}`;
    const countKey = `hg-runs:${playerName}:${new Date().toISOString().slice(0, 10)}`;
    const originalSave = {
        _saveVersion: 4,
        character: {
            name: playerName,
            level: 20,
            itemStacks: [{ itemId: 'hollow-gate-key', count: 2 }],
        },
    };
    await kv.set(saveKey, originalSave);

    const originalSet = kv.set.bind(kv);
    const originalCompareSet = kv.compareSet.bind(kv);
    let lostCounterAck = false;
    let failedSaveCas = false;
    kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        const result = await originalSet(key, value, options);
        if (!lostCounterAck && key === countKey) {
            lostCounterAck = true;
            throw new Error('injected-hollow-gate-counter-lost-ack');
        }
        return result;
    }) as typeof kv.set;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        if (!failedSaveCas && key === saveKey) {
            failedSaveCas = true;
            throw new Error('injected-hollow-gate-save-cas-after-counter-lost-ack');
        }
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;

    let failed: Out;
    try {
        failed = await postStart(playerName, requestId);
    } finally {
        kv.set = originalSet as typeof kv.set;
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }

    assert.equal(lostCounterAck, true);
    assert.equal(failedSaveCas, true);
    assert.equal(failed.statusCode, 500);
    assert.deepEqual(await kv.get(saveKey), originalSave);
    assert.equal(await kv.get(countKey), null, 'the read-back counter reservation is rolled back');
    assert.deepEqual(await kv.keys(`hg-run:${playerName}:*`), []);

    const retry = await postStart(playerName, requestId);
    assert.equal(retry.statusCode, 200);
    assert.equal(await kv.get(countKey), 1);
});

test('two failed starts rolling back out of order each decrement the aggregate exactly once', async () => {
    const playerName = 'hg-start-reverse-rollback';
    const saveKey = `save:${playerName}`;
    const countKey = `hg-runs:${playerName}:${new Date().toISOString().slice(0, 10)}`;
    const countLockKey = `lock:${countKey}`;
    const originalSave = {
        _saveVersion: 2,
        character: {
            name: playerName,
            level: 20,
            itemStacks: [{ itemId: 'hollow-gate-key', count: 3 }],
        },
    };
    await kv.set(saveKey, originalSave);

    let releaseEarlierRollback!: () => void;
    const earlierRollbackGate = new Promise<void>((resolve) => { releaseEarlierRollback = resolve; });
    let signalEarlierRollbackPaused!: () => void;
    const earlierRollbackPaused = new Promise<void>((resolve) => { signalEarlierRollbackPaused = resolve; });
    const originalSet = kv.set.bind(kv);
    const originalCompareSet = kv.compareSet.bind(kv);
    let countLockClaims = 0;
    kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (key === countLockKey) {
            countLockClaims += 1;
            if (countLockClaims === 2) {
                signalEarlierRollbackPaused();
                await earlierRollbackGate;
            }
        }
        return originalSet(key, value, options);
    }) as typeof kv.set;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        if (key === saveKey) throw new Error('injected-hollow-gate-concurrent-save-cas-failure');
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;

    let earlier: Promise<Out> | null = null;
    let later: Out | null = null;
    try {
        earlier = postStart(playerName, 'hg-reverse-rollback-request-one');
        await earlierRollbackPaused;
        later = await postStart(playerName, 'hg-reverse-rollback-request-two');
        assert.equal(later.statusCode, 500);
        assert.equal(await kv.get(countKey), 1, 'the later failure rolls back while the earlier cleanup is paused');
        releaseEarlierRollback();
        const earlierOut = await earlier;
        assert.equal(earlierOut.statusCode, 500);
    } finally {
        releaseEarlierRollback();
        if (earlier) await earlier.catch(() => undefined);
        kv.set = originalSet as typeof kv.set;
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }

    assert.equal(countLockClaims, 4, 'each reservation and rollback acquires the count lock once');
    assert.deepEqual(await kv.get(saveKey), originalSave);
    assert.equal(await kv.get(countKey), null, 'both held reservations were decremented despite reverse cleanup order');
    assert.deepEqual(await kv.keys(`hg-run:${playerName}:*`), []);
});

test('a save CAS commit with a lost acknowledgement keeps its daily reservation and run token', async () => {
    const playerName = 'hg-start-lost-ack';
    const requestId = 'hg-start-request-lost-ack';
    const saveKey = `save:${playerName}`;
    const countKey = `hg-runs:${playerName}:${new Date().toISOString().slice(0, 10)}`;
    await kv.set(saveKey, {
        _saveVersion: 3,
        character: {
            name: playerName,
            level: 20,
            hp: 500,
            maxHp: 500,
            itemStacks: [{ itemId: 'hollow-gate-key', count: 2 }],
        },
    });

    const originalCompareSet = kv.compareSet.bind(kv);
    let injected = false;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        const committed = await originalCompareSet(key, expected, value, options);
        if (!injected && key === saveKey && committed) {
            injected = true;
            throw new Error('injected-hollow-gate-save-lost-ack');
        }
        return committed;
    }) as typeof kv.compareSet;

    let started: Out;
    try {
        started = await postStart(playerName, requestId);
    } finally {
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }

    assert.equal(injected, true);
    assert.equal(started.statusCode, 200);
    assert.equal(await kv.get(countKey), 1, 'exact save readback proves the reservation committed');
    const runKeys = await kv.keys(`hg-run:${playerName}:*`);
    assert.deepEqual(runKeys, [`hg-run:${playerName}:${String(started.body?.token ?? '')}`]);
    const saved = await kv.get<{ character?: { itemStacks?: Array<{ itemId?: string; count?: number }>; lastHollowGateStart?: { requestId?: string } } }>(saveKey);
    assert.deepEqual(saved?.character?.itemStacks, [{ itemId: 'hollow-gate-key', count: 1 }]);
    assert.equal(saved?.character?.lastHollowGateStart?.requestId, requestId);
});
