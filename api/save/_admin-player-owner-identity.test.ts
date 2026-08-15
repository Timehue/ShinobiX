import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'admin-player-owner-identity-password';
process.env.SESSION_SECRET = 'admin-player-owner-identity-session-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Json = Record<string, unknown>;

const PLAYER_A = 'owneridentitya';
const PLAYER_B = 'owneridentityb';
const SAVE_B_KEY = `save:${PLAYER_B}`;
const ADMIN_LOCK_B_KEY = `admin-lock:${PLAYER_B}`;
const RESET_SIGNAL_B_KEY = `reset-signal:${PLAYER_B}`;

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let adminPlayerSaveOwnerMismatch: typeof import('./[name].js').adminPlayerSaveOwnerMismatch;

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
});

beforeEach(async () => {
    await kv.del(SAVE_B_KEY, ADMIN_LOCK_B_KEY, RESET_SIGNAL_B_KEY);
});

after(async () => {
    await kv.del(SAVE_B_KEY, ADMIN_LOCK_B_KEY, RESET_SIGNAL_B_KEY);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
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
