import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Ryo is server-owned at the save boundary. Every live spend and credit is
 * written to the stored save by a domain endpoint, so a generic autosave may
 * only re-assert the stored balance:
 *   - a HIGHER ryo is rejected with RYO_SERVER_AUTHORITY (unchanged);
 *   - a LOWER ryo is a stale client echoing an older wallet, so the stored
 *     balance is kept — accepting it would erase a server credit;
 *   - the acknowledgement carries the stored ryo, so a drifted client converges.
 * ALLOW_CLIENT_RYO_DECREASE=1 restores the old decrease-free rule (rollback).
 */

process.env.SESSION_SECRET = 'ryo-server-owned-test-secret-with-enough-entropy';
process.env.ENABLE_LEGACY = '0';

type Handler = (req: never, res: never) => Promise<unknown>;
type KvSetOptions = { ex?: number; nx?: boolean };

const store = new Map<string, unknown>();
const clone = <T,>(value: T): T => structuredClone(value);
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
            'x-forwarded-for': '203.0.113.45',
        },
        socket: { remoteAddress: '203.0.113.45' },
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

function character(name: string, ryo: number): Record<string, unknown> {
    return {
        name, level: 1, xp: 0, experience: 0, ryo,
        rank: 'Academy Student', rankTitle: 'Academy Student', village: '',
        stats: {}, inventory: [], itemStacks: [], pets: [], equipment: {},
        earnedTitles: [], serverTitles: [],
    };
}

/** Seeds a stored save and posts one autosave against it. */
async function autosave(name: string, storedRyo: number, sentRyo: number) {
    const token = issuePlayerToken(name);
    assert.ok(token);
    store.set(`save:${name}`, { _saveVersion: 4, character: character(name, storedRyo) });
    const response = fakeRes();
    await handler(fakeReq(name, token, { _baseSaveVersion: 4, character: character(name, sentRyo) }), response.res);
    const stored = store.get(`save:${name}`) as { _saveVersion: number; character: { ryo: number } };
    return { ...response.out, stored };
}

before(async () => {
    const storage = await import('../_storage.js');
    const kv = storage.kv as unknown as Record<string, unknown>;
    originalKv = { ...kv };
    kv.get = async <T,>(key: string) => (store.has(key) ? clone(store.get(key)) as T : null);
    kv.set = async (key: string, value: unknown, options?: KvSetOptions) => {
        if (options?.nx && store.has(key)) return null;
        store.set(key, clone(value));
        return 'OK' as const;
    };
    kv.del = async (...keys: string[]) => keys.reduce((count, key) => count + (store.delete(key) ? 1 : 0), 0);
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
    kv.hgetall = async <T,>(key: string) => (store.has(key) ? clone(store.get(key)) as T : null);
    kv.keys = async (pattern: string) => {
        const prefix = pattern.replace(/\*.*$/, '');
        return [...store.keys()].filter((key) => key.startsWith(prefix));
    };
    kv.mget = async (...keys: string[]) => keys.map((key) => (store.has(key) ? clone(store.get(key)) : null));

    const auth = await import('../_auth.js');
    issuePlayerToken = auth.issuePlayerToken;
    handler = (await import('./[name].js')).default as unknown as Handler;
});

after(async () => {
    const storage = await import('../_storage.js');
    Object.assign(storage.kv as unknown as Record<string, unknown>, originalKv);
});

test('a stale lower ryo keeps the stored balance, and the acknowledgement carries it', async () => {
    const out = await autosave('ryo-stale-echo', 500, 200);
    assert.equal(out.statusCode, 200);
    assert.deepEqual(out.body, { ok: true, _saveVersion: 5, ryo: 500 });
    assert.equal(out.stored.character.ryo, 500, 'a server credit is never erased by an older wallet');
    assert.equal(out.stored._saveVersion, 5);
});

test('an agreeing ryo is a normal write that echoes the same balance', async () => {
    const out = await autosave('ryo-agreeing', 750, 750);
    assert.equal(out.statusCode, 200);
    assert.deepEqual(out.body, { ok: true, _saveVersion: 5, ryo: 750 });
});

test('a higher ryo is still rejected atomically with the authoritative balance', async () => {
    const out = await autosave('ryo-forged-gain', 500, 9_000);
    assert.equal(out.statusCode, 409);
    const body = out.body as { code?: string; authoritativeRyo?: number };
    assert.equal(body.code, 'RYO_SERVER_AUTHORITY');
    assert.equal(body.authoritativeRyo, 500);
    assert.equal(out.stored._saveVersion, 4, 'a rejected write does not advance the version');
});

test('ALLOW_CLIENT_RYO_DECREASE=1 restores the old decrease-free rule', async () => {
    const previous = process.env.ALLOW_CLIENT_RYO_DECREASE;
    process.env.ALLOW_CLIENT_RYO_DECREASE = '1';
    try {
        const out = await autosave('ryo-rollback', 500, 200);
        assert.equal(out.statusCode, 200);
        assert.deepEqual(out.body, { ok: true, _saveVersion: 5, ryo: 200 });
        assert.equal(out.stored.character.ryo, 200);
    } finally {
        if (previous === undefined) delete process.env.ALLOW_CLIENT_RYO_DECREASE;
        else process.env.ALLOW_CLIENT_RYO_DECREASE = previous;
    }
});
