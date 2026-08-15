import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'admin-player-owner-identity-password';
process.env.ADMIN_CONTENT_PASSWORD = 'admin-player-owner-identity-content-password';
process.env.SESSION_SECRET = 'admin-player-owner-identity-session-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Json = Record<string, unknown>;

const PLAYER_A = 'owneridentitya';
const PLAYER_B = 'owneridentityb';
const SAVE_B_KEY = `save:${PLAYER_B}`;
const ADMIN_LOCK_B_KEY = `admin-lock:${PLAYER_B}`;
const RESET_SIGNAL_B_KEY = `reset-signal:${PLAYER_B}`;
const DELETE_FENCE_B_KEY = `save-delete-version:${PLAYER_B}`;
const REGISTRY_KEY = 'player:registry';
const SAVE_LOCK_B_KEY = `lock:save:${PLAYER_B}`;

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let adminPlayerSaveOwnerMismatch: typeof import('./[name].js').adminPlayerSaveOwnerMismatch;
let playerSaveDeletionFenceKey: typeof import('./[name].js').playerSaveDeletionFenceKey;
let playerToken: string;

function response() {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(statusCode: number) { out.statusCode = statusCode; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function postAdminSnapshot(targetName: string, body: Json) {
    const { out, res } = response();
    await handler({
        method: 'POST',
        query: { name: targetName, signal: '1' },
        headers: {
            'content-type': 'application/json',
            'x-admin-password': process.env.ADMIN_PASSWORD!,
        },
        body,
        socket: { remoteAddress: '127.0.0.82' },
    } as never, res);
    return out;
}

async function postPlayerSnapshot(targetName: string, body: Json) {
    const { out, res } = response();
    await handler({
        method: 'POST',
        query: { name: targetName },
        headers: {
            'content-type': 'application/json',
            'x-player-token': playerToken,
        },
        body,
        socket: { remoteAddress: '127.0.0.83' },
    } as never, res);
    return out;
}

async function deleteAdminSave(
    targetName: string,
    adminPassword = process.env.ADMIN_PASSWORD!,
) {
    const { out, res } = response();
    await handler({
        method: 'DELETE',
        query: { name: targetName },
        headers: { 'x-admin-password': adminPassword },
        socket: { remoteAddress: '127.0.0.82' },
    } as never, res);
    return out;
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

function playerBSave(): Json {
    return {
        _saveVersion: 7,
        _saveAt: 1_900_000_000_000,
        character: { name: PLAYER_B, level: 12, ryo: 222, inventory: ['b-only-item'] },
        currentSector: 40,
    };
}

function equalVersionPayload(fields: Json): Json {
    return {
        _saveVersion: 7,
        _saveAt: 1_900_000_000_000,
        currentSector: 1,
        ...fields,
    };
}

async function assertRejectedWithoutTouchingPlayerB(body: Json) {
    const originalB = playerBSave();
    await kv.set(SAVE_B_KEY, originalB);

    const out = await postAdminSnapshot(PLAYER_B, body);

    assert.equal(out.statusCode, 409);
    assert.match(String(out.body?.error), /identity does not match/i);
    const afterB = await kv.get<Json>(SAVE_B_KEY);
    assert.deepEqual(afterB, originalB);
    assert.equal(JSON.stringify(afterB), JSON.stringify(originalB), 'player B must remain byte-identical');
    assert.equal(await kv.get(ADMIN_LOCK_B_KEY), null, 'identity rejection must happen before the save lock signal');
    assert.equal(await kv.get(RESET_SIGNAL_B_KEY), null, 'identity rejection must not signal a client reset');
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const saveModule = await import('./[name].js');
    handler = saveModule.default as unknown as Handler;
    adminPlayerSaveOwnerMismatch = saveModule.adminPlayerSaveOwnerMismatch;
    playerSaveDeletionFenceKey = saveModule.playerSaveDeletionFenceKey;
    const { issuePlayerToken } = await import('../_auth.js');
    playerToken = issuePlayerToken(PLAYER_B) ?? '';
    assert.ok(playerToken, 'test player token must be issued');
});

beforeEach(async () => {
    await kv.del(SAVE_B_KEY, ADMIN_LOCK_B_KEY, RESET_SIGNAL_B_KEY, DELETE_FENCE_B_KEY);
    await kv.hdel(REGISTRY_KEY, PLAYER_B);
});

after(async () => {
    await kv.del(SAVE_B_KEY, ADMIN_LOCK_B_KEY, RESET_SIGNAL_B_KEY, DELETE_FENCE_B_KEY);
    await kv.hdel(REGISTRY_KEY, PLAYER_B);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_CONTENT_PASSWORD;
    delete process.env.SESSION_SECRET;
});

test('equal-version player A snapshot cannot be written to player B route', async () => {
    await assertRejectedWithoutTouchingPlayerB(equalVersionPayload({
        character: { name: PLAYER_A, level: 99, ryo: 999_999, inventory: ['a-only-item'] },
    }));
});

const malformedPlayerSnapshots: Array<{ label: string; fields: Json }> = [
    { label: 'missing character', fields: {} },
    { label: 'null character', fields: { character: null } },
    { label: 'primitive character', fields: { character: PLAYER_B } },
    { label: 'array character', fields: { character: [{ name: PLAYER_B }] } },
    { label: 'nameless character object', fields: { character: { level: 99, ryo: 999_999 } } },
    { label: 'empty character name', fields: { character: { name: '' } } },
];

for (const malformed of malformedPlayerSnapshots) {
    test(`equal-version ${malformed.label} cannot overwrite player B`, async () => {
        await assertRejectedWithoutTouchingPlayerB(equalVersionPayload(malformed.fields));
    });
}

test('the owner check preserves clan and admin content-slot exclusions', () => {
    const mismatched = { character: { name: PLAYER_A } };
    assert.equal(adminPlayerSaveOwnerMismatch(PLAYER_B, mismatched, false), true);
    assert.equal(adminPlayerSaveOwnerMismatch('admin1', mismatched, false), false);
    assert.equal(adminPlayerSaveOwnerMismatch('clan-example', mismatched, true), false);
});

test('a truly absent player with no deletion generation accepts versionless trusted creation at v1', async () => {
    const out = await postAdminSnapshot(PLAYER_B, {
        character: { name: PLAYER_B, level: 1, ryo: 0 },
    });

    assert.equal(out.statusCode, 200);
    const created = await kv.get<Json>(SAVE_B_KEY);
    assert.equal((created?.character as Json).name, PLAYER_B);
    assert.equal(created?._saveVersion, 1);
    assert.equal(await kv.get(DELETE_FENCE_B_KEY), null);
});

test('an existing player save remains writable even when reset/admin signals are present', async () => {
    await kv.set(SAVE_B_KEY, playerBSave());
    await kv.set(RESET_SIGNAL_B_KEY, 1, { ex: 300 });
    await kv.set(ADMIN_LOCK_B_KEY, 1, { ex: 300 });

    const out = await postAdminSnapshot(PLAYER_B, equalVersionPayload({
        character: { name: PLAYER_B, level: 13, ryo: 333 },
    }));

    assert.equal(out.statusCode, 200);
    assert.equal(((await kv.get<Json>(SAVE_B_KEY))?.character as Json).ryo, 333);
});

test('the persistent deletion generation is scoped only to canonical player saves', () => {
    assert.equal(playerSaveDeletionFenceKey(PLAYER_B, false), DELETE_FENCE_B_KEY);
    assert.equal(playerSaveDeletionFenceKey('admin1', false), null);
    assert.equal(playerSaveDeletionFenceKey('admin2', false), null);
    assert.equal(playerSaveDeletionFenceKey('clan-example', true), null);
});

test('content admin cannot delete a player save; full admin can', async () => {
    const original = playerBSave();
    const registryEntry = { name: PLAYER_B, level: 12, village: 'Leaf' };
    await kv.set(SAVE_B_KEY, original);
    await kv.hset(REGISTRY_KEY, { [PLAYER_B]: registryEntry });

    const contentAttempt = await deleteAdminSave(PLAYER_B, process.env.ADMIN_CONTENT_PASSWORD!);
    assert.equal(contentAttempt.statusCode, 403);
    assert.match(String(contentAttempt.body?.error), /full admin/i);
    assert.deepEqual(await kv.get(SAVE_B_KEY), original);
    assert.deepEqual((await kv.hgetall<Json>(REGISTRY_KEY))?.[PLAYER_B], registryEntry);
    assert.equal(await kv.get(DELETE_FENCE_B_KEY), null);
    assert.equal(await kv.get(ADMIN_LOCK_B_KEY), null);
    assert.equal(await kv.get(RESET_SIGNAL_B_KEY), null);

    const fullAttempt = await deleteAdminSave(PLAYER_B);
    assert.equal(fullAttempt.statusCode, 200);
    assert.equal(await kv.get(SAVE_B_KEY), null);
    assert.equal(await kv.get(DELETE_FENCE_B_KEY), 8);
});

test('POST that enters the save lock before DELETE leaves the player deleted', { timeout: 5_000 }, async () => {
    await kv.set(SAVE_B_KEY, playerBSave());
    await kv.hset(REGISTRY_KEY, { [PLAYER_B]: { name: PLAYER_B } });
    const postReachedWrite = deferred();
    const releasePostWrite = deferred();
    const deleteContended = deferred();
    const mutableKv = kv as unknown as {
        set: (key: string, value: unknown, options?: { nx?: boolean; ex?: number }) => Promise<unknown>;
    };
    const originalSet = mutableKv.set.bind(mutableKv);
    mutableKv.set = async (key, value, options) => {
        if (key === SAVE_B_KEY) {
            postReachedWrite.resolve();
            await releasePostWrite.promise;
        }
        const result = await originalSet(key, value, options);
        if (key === SAVE_LOCK_B_KEY && options?.nx && result === null) deleteContended.resolve();
        return result;
    };

    try {
        const post = postAdminSnapshot(PLAYER_B, equalVersionPayload({
            character: { name: PLAYER_B, level: 13, ryo: 444 },
        }));
        await postReachedWrite.promise;
        const remove = deleteAdminSave(PLAYER_B);
        await deleteContended.promise;
        releasePostWrite.resolve();

        const [postOut, deleteOut] = await Promise.all([post, remove]);
        assert.equal(postOut.statusCode, 200);
        assert.equal(deleteOut.statusCode, 200);
        assert.equal(await kv.get(SAVE_B_KEY), null);
        assert.equal(await kv.get(DELETE_FENCE_B_KEY), 9);
        assert.equal((await kv.hgetall<Json>(REGISTRY_KEY))?.[PLAYER_B], undefined);
    } finally {
        mutableKv.set = originalSet;
    }
});

test('DELETE that enters the save lock before stale admin POST rejects resurrection', { timeout: 5_000 }, async () => {
    await kv.set(SAVE_B_KEY, playerBSave());
    await kv.hset(REGISTRY_KEY, { [PLAYER_B]: { name: PLAYER_B } });
    const deleteReachedWrite = deferred();
    const releaseDeleteWrite = deferred();
    const stalePostContended = deferred();
    const mutableKv = kv as unknown as {
        set: (key: string, value: unknown, options?: { nx?: boolean; ex?: number }) => Promise<unknown>;
        del: (...keys: string[]) => Promise<unknown>;
    };
    const originalSet = mutableKv.set.bind(mutableKv);
    const originalDel = mutableKv.del.bind(mutableKv);
    mutableKv.set = async (key, value, options) => {
        const result = await originalSet(key, value, options);
        if (key === SAVE_LOCK_B_KEY && options?.nx && result === null) stalePostContended.resolve();
        return result;
    };
    mutableKv.del = async (...keys) => {
        if (keys.includes(SAVE_B_KEY)) {
            deleteReachedWrite.resolve();
            await releaseDeleteWrite.promise;
        }
        return originalDel(...keys);
    };

    try {
        const remove = deleteAdminSave(PLAYER_B);
        await deleteReachedWrite.promise;
        const stalePost = postAdminSnapshot(PLAYER_B, equalVersionPayload({
            character: { name: PLAYER_B, level: 99, ryo: 999_999 },
        }));
        await stalePostContended.promise;
        releaseDeleteWrite.resolve();

        const [deleteOut, postOut] = await Promise.all([remove, stalePost]);
        assert.equal(deleteOut.statusCode, 200);
        assert.equal(postOut.statusCode, 409);
        assert.equal(postOut.body?.storedVersion, 8);
        assert.equal(postOut.body?.baseVersion, 7);
        assert.equal(await kv.get(SAVE_B_KEY), null, 'stale POST must not resurrect the deleted player');
        assert.equal(await kv.get(DELETE_FENCE_B_KEY), 8);
        assert.equal((await kv.hgetall<Json>(REGISTRY_KEY))?.[PLAYER_B], undefined);
        assert.equal(await kv.get(ADMIN_LOCK_B_KEY), 1);
        assert.equal(await kv.get(RESET_SIGNAL_B_KEY), 1);
    } finally {
        mutableKv.set = originalSet;
        mutableKv.del = originalDel;
    }
});

test('same-name owner recreation advances past deletion and rejects old-generation admin snapshots', async () => {
    await kv.set(SAVE_B_KEY, playerBSave());

    const remove = await deleteAdminSave(PLAYER_B);
    assert.equal(remove.statusCode, 200);
    assert.equal(await kv.get(DELETE_FENCE_B_KEY), 8);

    // Simulate the player acknowledging the short-lived reload markers. The
    // persistent deletion generation must remain and seed the next save.
    await kv.del(ADMIN_LOCK_B_KEY, RESET_SIGNAL_B_KEY);
    const recreate = await postPlayerSnapshot(PLAYER_B, {
        _baseSaveVersion: 0,
        character: { name: PLAYER_B, level: 1, ryo: 0 },
        currentSector: 1,
    });
    assert.equal(recreate.statusCode, 200);
    assert.equal(recreate.body?._saveVersion, 9);

    const recreated = await kv.get<Json>(SAVE_B_KEY);
    assert.equal(recreated?._saveVersion, 9);
    assert.equal(await kv.get(DELETE_FENCE_B_KEY), 8, 'ordinary recreation must not erase the floor');

    const stale = await postAdminSnapshot(PLAYER_B, equalVersionPayload({
        character: { name: PLAYER_B, level: 99, ryo: 999_999 },
    }));
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.body?.storedVersion, 9);
    assert.equal((await kv.get<Json>(SAVE_B_KEY))?._saveVersion, 9);

    const current = await postAdminSnapshot(PLAYER_B, {
        ...recreated,
        character: { ...(recreated?.character as Json), name: PLAYER_B, level: 2 },
    });
    assert.equal(current.statusCode, 200);
    assert.equal((await kv.get<Json>(SAVE_B_KEY))?._saveVersion, 10);
});

test('a deletion generation rejects versionless and non-finite admin resurrection attempts', async () => {
    await kv.set(SAVE_B_KEY, playerBSave());
    assert.equal((await deleteAdminSave(PLAYER_B)).statusCode, 200);
    assert.equal(await kv.get(DELETE_FENCE_B_KEY), 8);

    // Clear the ephemeral hints to prove the durable floor is the authority and
    // that a rejected admin POST does not establish a new admin/reset signal.
    await kv.del(ADMIN_LOCK_B_KEY, RESET_SIGNAL_B_KEY);
    const attempts: Json[] = [
        { character: { name: PLAYER_B, level: 99, ryo: 999_999 } },
        { _saveVersion: 'not-a-version', character: { name: PLAYER_B, level: 99, ryo: 999_999 } },
    ];
    for (const body of attempts) {
        const out = await postAdminSnapshot(PLAYER_B, body);
        assert.equal(out.statusCode, 409);
        assert.equal(out.body?.storedVersion, 8);
        assert.equal(await kv.get(SAVE_B_KEY), null);
        assert.equal(await kv.get(DELETE_FENCE_B_KEY), 8);
        assert.equal(await kv.get(ADMIN_LOCK_B_KEY), null);
        assert.equal(await kv.get(RESET_SIGNAL_B_KEY), null);
    }
});
