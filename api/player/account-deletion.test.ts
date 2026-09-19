import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'settings-deletion-test-secret';
process.env.ADMIN_PASSWORD = 'settings-deletion-admin';

type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler, saveHandler: Handler, authHandler: Handler;
let kv: typeof import('../_storage.js').kv;
let token: string;
let sequence = 0;
const wait = 86_400_000;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./account-deletion.js')).default as unknown as Handler;
    saveHandler = (await import('../save/[name].js')).default as unknown as Handler;
    authHandler = (await import('../player-auth.js')).default as unknown as Handler;
});
beforeEach(async () => {
    await kv.set('auth:settingsowner', { google: { sub: 'settings-google', linkedAt: 1 } });
    await kv.set('save:settingsowner', { character: { name: 'settingsowner', level: 1, inventory: [] }, _saveVersion: 1 });
    await kv.set('auth:settingsother', { guest: true });
    await kv.set('save:settingsother', { character: { name: 'settingsother' } });
    const auth = await import('../_auth.js');
    token = auth.issuePlayerToken('settingsowner', undefined, await auth.readPlayerSessionEpoch('settingsowner'))!;
});

async function call(target: Handler, method: string, body: Record<string, unknown> = {}, headers: Record<string, string> = { 'x-player-token': token }, name = 'settingsowner') {
    const out: { status: number; body: Record<string, unknown> } = { status: 200, body: {} };
    const res = { setHeader() { return res; }, status(status: number) { out.status = status; return res; }, json(body: Record<string, unknown>) { out.body = body; return res; }, end() { return res; } };
    await target({ method, query: { name }, body, headers: { ...headers, 'x-forwarded-for': `10.91.0.${++sequence}` }, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return out;
}

test('request is server-timed, idempotent, survives status reads, and can be cancelled', async () => {
    const before = Date.now();
    const requested = await call(handler, 'POST', { action: 'request', requestedAt: 1, name: 'settingsother' });
    assert.equal(requested.status, 200);
    assert.ok(Number(requested.body.requestedAt) >= before);
    assert.equal(Number(requested.body.availableAt) - Number(requested.body.requestedAt), wait);
    assert.equal(requested.body.ready, false);
    assert.equal((await call(handler, 'POST', { action: 'request' })).body.requestedAt, requested.body.requestedAt);
    assert.equal((await call(handler, 'GET')).body.requestedAt, requested.body.requestedAt);
    assert.equal((await kv.get<{ deletionRequestedAt?: number }>('auth:settingsother'))?.deletionRequestedAt, undefined);
    assert.equal((await call(handler, 'POST', { action: 'cancel' })).body.requestedAt, null);
    assert.ok(await kv.get('save:settingsowner'));
});

test('both legacy deletion endpoints reject bypasses before the wait with no destructive side effects', async () => {
    assert.equal((await call(saveHandler, 'DELETE')).status, 409);
    await call(handler, 'POST', { action: 'request' });
    assert.equal((await call(saveHandler, 'DELETE')).status, 409);
    assert.equal((await call(authHandler, 'POST', { action: 'delete', name: 'settingsowner' })).status, 409);
    assert.ok(await kv.get('save:settingsowner'));
    assert.ok(await kv.get('auth:settingsowner'));
    assert.equal(await kv.get('admin-lock:settingsowner'), null);
});

test('the exact 24-hour boundary is required and malformed timestamps fail closed', async () => {
    const { accountDeletionStatus } = await import('../_account-deletion-wait.js');
    assert.equal(accountDeletionStatus({ deletionRequestedAt: 1000 }, 1000 + wait - 1).ready, false);
    assert.equal(accountDeletionStatus({ deletionRequestedAt: 1000 }, 1000 + wait).ready, true);
    for (const value of [0, -1, NaN, Infinity, '1', null]) {
        assert.equal(accountDeletionStatus({ deletionRequestedAt: value as number }).ready, false);
    }
});

test('after the wait, save deletion stays retryable, cancellation cannot undo teardown, and auth revokes tokens', async () => {
    const record = await kv.get<Record<string, unknown>>('auth:settingsowner');
    await kv.set('auth:settingsowner', { ...record, deletionRequestedAt: Date.now() - wait });
    assert.equal((await call(handler, 'GET')).body.ready, true);
    assert.equal((await call(authHandler, 'POST', { action: 'delete', name: 'settingsowner' })).status, 409, 'auth cannot strand a live save');
    assert.equal((await call(saveHandler, 'DELETE')).status, 200);
    assert.equal((await call(saveHandler, 'DELETE')).status, 200, 'retry a partially completed deletion');
    assert.equal((await call(handler, 'POST', { action: 'cancel' })).status, 409);
    assert.equal((await call(authHandler, 'POST', { action: 'delete', name: 'settingsowner' })).status, 200);
    assert.equal(await kv.get('auth:settingsowner'), null);
    assert.equal(await (await import('../_auth.js')).verifyPlayerToken(token), null);
    assert.ok(await kv.get('save:settingsother'));
});

test('status requires ownership; admins retain their existing deliberate deletion path', async () => {
    assert.equal((await call(handler, 'GET', {}, {})).status, 401);
    assert.equal((await call(handler, 'POST', { action: 'request' }, { 'x-player-token': token, 'x-player-name': 'settingsother' })).status, 401);
    assert.equal((await call(saveHandler, 'DELETE', {}, { 'x-admin-password': process.env.ADMIN_PASSWORD! })).status, 200);
});

test('missing-save signup recovery can still clear its auth lock', async () => {
    await kv.del('save:settingsowner');
    assert.equal((await call(authHandler, 'POST', { action: 'delete', name: 'settingsowner' })).status, 200);
});

test('password-only servers enforce the same wait without a session token', async () => {
    const secret = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
        await call(authHandler, 'POST', { action: 'register', name: 'settingspassword', password: 'TestPassword47' }, {});
        await kv.set('save:settingspassword', { character: { name: 'settingspassword' } });
        const headers = { 'x-player-name': 'settingspassword', 'x-player-password': 'TestPassword47' };
        assert.equal((await call(handler, 'POST', { action: 'request' }, headers)).status, 200);
        assert.equal((await call(saveHandler, 'DELETE', {}, headers, 'settingspassword')).status, 409);
        assert.equal((await call(handler, 'POST', { action: 'cancel' }, headers)).status, 200);
    } finally { process.env.SESSION_SECRET = secret; }
});
