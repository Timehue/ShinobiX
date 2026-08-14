import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'save-attempt-test-secret-with-enough-entropy';
process.env.ENABLE_LEGACY = '0';

type Handler = (req: never, res: never) => Promise<unknown>;
type KvSetOptions = { ex?: number; nx?: boolean };

const store = new Map<string, unknown>();
const clone = <T,>(value: T): T => structuredClone(value);
const lockAttempts = new Map<string, number>();
let handler: Handler;
let issuePlayerToken: (name: string) => string | null;
let originalKv: Record<string, unknown>;

function fakeReq(name: string, token: string, body: Record<string, unknown>) {
    return {
        method: 'POST',
        query: { name },
        body,
        headers: {
            'x-player-name': name,
            'x-player-token': token,
            'content-type': 'application/json',
            'x-forwarded-for': '203.0.113.44',
        },
        socket: { remoteAddress: '203.0.113.44' },
    } as never;
}

function fakeRes() {
    const out = { statusCode: 200, body: undefined as unknown };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: unknown) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

function character(name: string): Record<string, unknown> {
    return {
        name,
        level: 1,
        xp: 0,
        experience: 0,
        ryo: 0,
        rank: 'Academy Student',
        rankTitle: 'Academy Student',
        village: '',
        stats: {},
        inventory: [],
        itemStacks: [],
        pets: [],
        equipment: {},
        earnedTitles: [],
        serverTitles: [],
    };
}

function counter(bucket: string, player: string): number {
    const prefix = `ratelimit:${bucket}:name:${player}:`;
    return [...store.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
}

async function post(name: string, token: string, body: Record<string, unknown>) {
    const response = fakeRes();
    await handler(fakeReq(name, token, body), response.res);
    return response.out;
}

before(async () => {
    const storage = await import('../_storage.js');
    const kv = storage.kv as unknown as Record<string, unknown>;
    originalKv = { ...kv };

    kv.get = async <T,>(key: string) => (
        store.has(key) ? clone(store.get(key)) as T : null
    );
    kv.set = async (key: string, value: unknown, options?: KvSetOptions) => {
        if (options?.nx && store.has(key)) return null;
        if (key.startsWith('lock:save:')) {
            lockAttempts.set(key, (lockAttempts.get(key) ?? 0) + 1);
        }
        store.set(key, clone(value));
        return 'OK' as const;
    };
    kv.del = async (...keys: string[]) => keys.reduce((count, key) => (
        count + (store.delete(key) ? 1 : 0)
    ), 0);
    kv.delIfEqual = async (key: string, expected: string) => {
        if (store.get(key) !== expected) return false;
        store.delete(key);
        return true;
    };
    kv.incr = async (key: string) => {
        const next = (Number(store.get(key)) || 0) + 1;
        store.set(key, next);
        return next;
    };
    kv.hset = async (key: string, fields: Record<string, unknown>) => {
        const current = (store.get(key) as Record<string, unknown> | undefined) ?? {};
        store.set(key, { ...current, ...clone(fields) });
        return Object.keys(fields).length;
    };
    kv.hgetall = async <T,>(key: string) => (
        store.has(key) ? clone(store.get(key)) as T : null
    );
    kv.keys = async (pattern: string) => {
        const prefix = pattern.replace(/\*.*$/, '');
        return [...store.keys()].filter((key) => key.startsWith(prefix));
    };
    kv.mget = async (...keys: string[]) => keys.map((key) => (
        store.has(key) ? clone(store.get(key)) : null
    ));

    const auth = await import('../_auth.js');
    issuePlayerToken = auth.issuePlayerToken;
    handler = (await import('./[name].js')).default as unknown as Handler;
});

after(async () => {
    const storage = await import('../_storage.js');
    Object.assign(storage.kv as unknown as Record<string, unknown>, originalKv);
});

test('ordinary save-attempt ingress is capped before lock and rejection telemetry, with independent retry budgets', async () => {
    const saveModule = await import('./[name].js');
    const limit = saveModule.PLAYER_SAVE_ATTEMPT_LIMIT;

    const blockedName = 'attempt-reset';
    const blockedToken = issuePlayerToken(blockedName);
    assert.ok(blockedToken);
    store.set(`save:${blockedName}`, { _saveVersion: 7, character: character(blockedName) });
    store.set(`reset-signal:${blockedName}`, 1);

    // Expected reset-pending retries still enter the lock while budget remains.
    for (let attempt = 0; attempt < limit; attempt++) {
        const response = await post(blockedName, blockedToken, {
            _baseSaveVersion: 7,
            character: character(blockedName),
        });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.body, { ok: false, persisted: false, reason: 'reset-pending' });
    }

    const lockKey = `lock:save:${blockedName}`;
    assert.equal(lockAttempts.get(lockKey), limit);
    assert.equal(counter('save-attempt', blockedName), limit);

    // The next attempt is rejected by the common ingress bucket before it can
    // acquire the character lock.
    const overLimit = await post(blockedName, blockedToken, {
        _baseSaveVersion: 7,
        character: character(blockedName),
    });
    assert.equal(overLimit.statusCode, 429);
    assert.equal(lockAttempts.get(lockKey), limit, 'over-limit request must not touch the save lock');

    // Once the same ingress bucket is exhausted, changing the payload to the
    // versionless or stale path cannot hammer their telemetry/budget either.
    store.delete(`reset-signal:${blockedName}`);
    const versionless = await post(blockedName, blockedToken, { character: character(blockedName) });
    assert.equal(versionless.statusCode, 429);
    assert.equal(
        [...store.keys()].some((key) => key.startsWith('telemetry:save-noversion:')),
        false,
        'blocked versionless attempts must not increment missing-version telemetry',
    );
    const stale = await post(blockedName, blockedToken, {
        _baseSaveVersion: 6,
        character: character(blockedName),
    });
    assert.equal(stale.statusCode, 429);
    assert.equal(counter('save-conflict', blockedName), 0, 'blocked stale attempts must not consume conflict budget');
    assert.equal(lockAttempts.get(lockKey), limit);

    // A normal stale response and its immediately corrected retry use distinct
    // post-guard budgets: the 409 charges conflict, while the accepted write
    // charges save-burst and succeeds without waiting three seconds.
    const retryName = 'attempt-retry';
    const retryToken = issuePlayerToken(retryName);
    assert.ok(retryToken);
    store.set(`save:${retryName}`, { _saveVersion: 3, character: character(retryName) });

    const conflict = await post(retryName, retryToken, {
        _baseSaveVersion: 2,
        character: character(retryName),
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal((conflict.body as { currentVersion?: number }).currentVersion, 3);

    const corrected = await post(retryName, retryToken, {
        _baseSaveVersion: 3,
        character: character(retryName),
    });
    assert.equal(corrected.statusCode, 200);
    assert.deepEqual(corrected.body, { ok: true, _saveVersion: 4 });
    assert.equal(counter('save-attempt', retryName), 2);
    assert.equal(counter('save-conflict', retryName), 1);
    assert.equal(counter('save-burst', retryName), 1);
});
