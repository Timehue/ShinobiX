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
let forgeHandler: Handler;
let issuePlayerToken: (name: string) => string | null;
let originalKv: Record<string, unknown>;

function fakeReq(name: string, token: string, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
    return {
        method: 'POST',
        query: { name },
        body,
        headers: {
            'x-player-name': name,
            'x-player-token': token,
            'content-type': 'application/json',
            'x-forwarded-for': '203.0.113.45',
            ...extraHeaders,
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
    forgeHandler = (await import('../bloodlines/forge.js')).default as unknown as Handler;
});

after(async () => {
    const storage = await import('../_storage.js');
    Object.assign(storage.kv as unknown as Record<string, unknown>, originalKv);
});

test('a stale lower ryo keeps the stored balance, and the acknowledgement carries it', async () => {
    const out = await autosave('ryo-stale-echo', 500, 200);
    assert.equal(out.statusCode, 200);
    assert.deepEqual(out.body, { ok: true, _saveVersion: 5, ryo: 500, fateShards: 0 });
    assert.equal(out.stored.character.ryo, 500, 'a server credit is never erased by an older wallet');
    assert.equal(out.stored._saveVersion, 5);
});

test('an agreeing ryo is a normal write that echoes the same balance', async () => {
    const out = await autosave('ryo-agreeing', 750, 750);
    assert.equal(out.statusCode, 200);
    assert.deepEqual(out.body, { ok: true, _saveVersion: 5, ryo: 750, fateShards: 0 });
});

test('a purchased bloodline maker write persists the roster and acknowledges the stored selection', async () => {
    const name = 'bloodline-maker-persist';
    const token = issuePlayerToken(name);
    assert.ok(token);
    const entitlement = { id: '12345678-1234-1234-1234-123456789abc', rank: 'A Rank', issuedAt: Date.now() };
    store.set(`save:${name}`, { _saveVersion: 4, character: character(name, 500),
        savedBloodlines: [], pendingBloodlineForges: [entitlement] });
    const bloodline = { id: 'bl-new', name: 'New bloodline', rank: 'A Rank', jutsus: [] };
    const response = fakeRes();
    await handler(fakeReq(name, token, { _baseSaveVersion: 4,
        character: { ...character(name, 500), equippedBloodlineId: bloodline.id }, savedBloodlines: [bloodline] },
    { 'x-bloodline-equip-intent': bloodline.id, 'x-bloodline-write-intent': bloodline.id }), response.res);
    assert.equal(response.out.statusCode, 200);
    const saved = store.get(`save:${name}`) as Record<string, unknown>;
    assert.deepEqual((saved.savedBloodlines as Array<Record<string, unknown>>).map((entry) => entry.id), [bloodline.id]);
    assert.deepEqual(saved.pendingBloodlineForges, []);
    assert.equal((saved.character as Record<string, unknown>).equippedBloodlineId, bloodline.id);
    assert.deepEqual(response.out.body, { ok: true, _saveVersion: 5, savedBloodlineIds: [bloodline.id],
        savedBloodlineRanks: { [bloodline.id]: bloodline.rank }, equippedBloodlineId: bloodline.id,
        ryo: 500, fateShards: 0 });
});

test('an older maker client cannot receive a success response for a discarded bloodline', async () => {
    const name = 'bloodline-old-client';
    const token = issuePlayerToken(name);
    assert.ok(token);
    const entitlement = { id: '12345678-1234-1234-1234-123456789abd', rank: 'A Rank', issuedAt: Date.now() };
    const before = { _saveVersion: 4, character: character(name, 500),
        savedBloodlines: [], pendingBloodlineForges: [entitlement] };
    store.set(`save:${name}`, clone(before));
    const bloodline = { id: 'bl-old-client', name: 'Unstored draft', rank: 'A Rank', jutsus: [] };
    const response = fakeRes();
    await handler(fakeReq(name, token, { _baseSaveVersion: 4,
        character: { ...character(name, 500), equippedBloodlineId: bloodline.id }, savedBloodlines: [bloodline] }), response.res);
    assert.equal(response.out.statusCode, 422);
    assert.equal((response.out.body as { code?: string }).code, 'BLOODLINE_SAVE_REJECTED');
    assert.deepEqual(store.get(`save:${name}`), before, 'the purchase remains available for a refreshed client');
});

test('a rejected rank upgrade cannot return success or consume the wrong forge purchase', async () => {
    const name = 'bloodline-wrong-rank';
    const token = issuePlayerToken(name);
    assert.ok(token);
    const entitlement = { id: '12345678-1234-1234-1234-123456789abe', rank: 'A Rank', issuedAt: Date.now() };
    const before = { _saveVersion: 4, character: character(name, 500),
        savedBloodlines: [], pendingBloodlineForges: [entitlement] };
    store.set(`save:${name}`, clone(before));
    const bloodline = { id: 'bl-wrong-rank', name: 'Wrong rank', rank: 'S Rank', jutsus: [] };
    const response = fakeRes();
    await handler(fakeReq(name, token, { _baseSaveVersion: 4,
        character: { ...character(name, 500), equippedBloodlineId: bloodline.id }, savedBloodlines: [bloodline] },
    { 'x-bloodline-equip-intent': bloodline.id, 'x-bloodline-write-intent': bloodline.id }), response.res);
    assert.equal(response.out.statusCode, 422);
    assert.deepEqual(store.get(`save:${name}`), before);
});

test('a stale full save cannot replace a newly stored bloodline with the old id', async () => {
    const name = 'bloodline-stale-client';
    const token = issuePlayerToken(name);
    assert.ok(token);
    const fresh = { id: 'bl-fresh', name: 'Fresh', rank: 'A Rank', jutsus: [] };
    const old = { id: 'bl-old', name: 'Old', rank: 'B Rank', jutsus: [] };
    const before = { _saveVersion: 4,
        character: { ...character(name, 500), equippedBloodlineId: fresh.id },
        savedBloodlines: [fresh], pendingBloodlineForges: [] };
    store.set(`save:${name}`, clone(before));
    const response = fakeRes();
    await handler(fakeReq(name, token, { _baseSaveVersion: 4,
        character: { ...character(name, 500), equippedBloodlineId: old.id }, savedBloodlines: [old] }), response.res);
    assert.equal(response.out.statusCode, 422);
    assert.deepEqual(store.get(`save:${name}`), before);
});

test('a pending Awakening Stone purchase reopens the maker without a second debit', async () => {
    const name = 'bloodline-resume';
    const token = issuePlayerToken(name);
    assert.ok(token);
    const entitlement = { id: '12345678-1234-1234-1234-123456789abf', rank: 'A Rank', issuedAt: Date.now() };
    const before = { _saveVersion: 4, character: { ...character(name, 500), auraStones: 40 },
        savedBloodlines: [], pendingBloodlineForges: [entitlement] };
    store.set(`save:${name}`, clone(before));
    const response = fakeRes();
    await forgeHandler(fakeReq(name, token, { playerName: name, rank: 'A Rank', resumeOnly: true }), response.res);
    assert.equal(response.out.statusCode, 200);
    const body = response.out.body as Record<string, unknown>;
    assert.deepEqual({ ...body, character: undefined }, { ok: true, rank: 'A Rank', currency: 'auraStones',
        cost: 0, balance: 40, resumed: true, character: undefined, _saveVersion: 4 });
    assert.equal((body.character as Record<string, unknown>).auraStones, 40);
    assert.deepEqual(store.get(`save:${name}`), before);
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
        assert.deepEqual(out.body, { ok: true, _saveVersion: 5, ryo: 200, fateShards: 0 });
        assert.equal(out.stored.character.ryo, 200);
    } finally {
        if (previous === undefined) delete process.env.ALLOW_CLIENT_RYO_DECREASE;
        else process.env.ALLOW_CLIENT_RYO_DECREASE = previous;
    }
});
