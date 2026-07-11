"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
process.env.SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_KEY ??= 'test';
process.env.SESSION_SECRET = 'player-auth-session-test-secret';
process.env.ADMIN_PASSWORD = 'full-admin-test-password';
const store = new Map();
const clone = (value) => (value === undefined || value === null ? value : JSON.parse(JSON.stringify(value)));
let handler;
let verifyPlayerPassword;
let verifyPlayerToken;
let playerPasswordPolicyError;
let requestNumber = 0;
let failNextAuthWrite = false;
(0, node_test_1.before)(async () => {
    const { kv } = await import('./_storage.js');
    kv.get = async (key) => clone(store.get(key));
    kv.set = async (key, value, options) => {
        if (options?.nx && store.has(key))
            return null;
        if (failNextAuthWrite && key.startsWith('auth:') && !options?.nx) {
            failNextAuthWrite = false;
            throw new Error('simulated auth write failure');
        }
        store.set(key, clone(value));
        return 'OK';
    };
    kv.del = async (...keys) => keys.reduce((count, key) => count + (store.delete(key) ? 1 : 0), 0);
    kv.incr = async (key) => {
        const next = (Number(store.get(key)) || 0) + 1;
        store.set(key, next);
        return next;
    };
    const authModule = await import('./player-auth.js');
    const sessionModule = await import('./_auth.js');
    handler = authModule.default;
    verifyPlayerPassword = authModule.verifyPlayerPassword;
    playerPasswordPolicyError = authModule.playerPasswordPolicyError;
    verifyPlayerToken = sessionModule.verifyPlayerToken;
});
(0, node_test_1.beforeEach)(() => {
    store.clear();
    failNextAuthWrite = false;
});
(0, node_test_1.after)(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_PASSWORD;
});
function fakeReq(body, headers = {}) {
    requestNumber += 1;
    const ip = `10.20.${Math.floor(requestNumber / 250)}.${(requestNumber % 250) + 1}`;
    return {
        method: 'POST',
        body,
        headers: {
            'content-type': 'application/json',
            'x-forwarded-for': ip,
            ...headers,
        },
        socket: { remoteAddress: ip },
    };
}
function fakeRes() {
    const out = { statusCode: 200, body: undefined };
    const res = {
        setHeader: () => res,
        status: (statusCode) => {
            out.statusCode = statusCode;
            return res;
        },
        json: (body) => {
            out.body = body;
            return res;
        },
        end: () => res,
    };
    return { res: res, out };
}
async function post(body, headers = {}) {
    const { res, out } = fakeRes();
    await handler(fakeReq(body, headers), res);
    return out;
}
async function register(name, password = 'StrongPass1') {
    return post({ action: 'register', name, password });
}
(0, node_test_1.describe)('player auth hardening', () => {
    (0, node_test_1.it)('enforces the account password policy server-side', async () => {
        strict_1.default.match(playerPasswordPolicyError('short1'), /at least 8/i);
        strict_1.default.match(playerPasswordPolicyError('lettersOnly'), /letter and one number/i);
        strict_1.default.match(playerPasswordPolicyError('12345678'), /letter and one number/i);
        strict_1.default.match(playerPasswordPolicyError(`A1${'x'.repeat(127)}`), /at most 128/i);
        strict_1.default.equal(playerPasswordPolicyError('StrongPass1'), null);
        const weak = await register('weakuser', 'password');
        strict_1.default.equal(weak.statusCode, 400);
        strict_1.default.equal(store.has('auth:weakuser'), false);
        const oversized = `A1${'x'.repeat(127)}`;
        strict_1.default.equal((await post({ action: 'verify', name: 'weakuser', password: oversized })).statusCode, 400);
        strict_1.default.equal((await post({ action: 'change', name: 'weakuser', oldPassword: oversized, newPassword: 'AnotherPass2' })).statusCode, 400);
        strict_1.default.equal((await post({ action: 'delete', name: 'weakuser', password: oversized })).statusCode, 400);
        await register('policyuser', 'Original1');
        const weakChange = await post({
            action: 'change',
            name: 'policyuser',
            oldPassword: 'Original1',
            newPassword: 'lettersOnly',
        });
        strict_1.default.equal(weakChange.statusCode, 400);
        strict_1.default.equal(store.get('auth-session:policyuser'), undefined);
        const weakAdminReset = await post({
            action: 'adminreset',
            name: 'policyuser',
            newPassword: '12345678',
        }, { 'x-admin-password': process.env.ADMIN_PASSWORD });
        strict_1.default.equal(weakAdminReset.statusCode, 400);
        const reused = await post({
            action: 'change',
            name: 'policyuser',
            oldPassword: 'Original1',
            newPassword: 'Original1',
        });
        strict_1.default.equal(reused.statusCode, 400);
        strict_1.default.equal(await verifyPlayerPassword('policyuser', 'Original1'), true);
    });
    (0, node_test_1.it)('does not let change claim an unused name', async () => {
        const result = await post({
            action: 'change',
            name: 'unused',
            oldPassword: 'Anything1',
            newPassword: 'NewSecure2',
        });
        strict_1.default.equal(result.statusCode, 404);
        strict_1.default.equal(result.body?.ok, false);
        strict_1.default.equal(store.has('auth:unused'), false);
    });
    (0, node_test_1.it)('does not let change claim a legacy save without an auth record', async () => {
        store.set('save:legacyhero', { character: { name: 'Legacy Hero' } });
        const result = await post({
            action: 'change',
            name: 'legacyhero',
            oldPassword: 'GuessedOld1',
            newPassword: 'AttackerNew2',
        });
        strict_1.default.equal(result.statusCode, 409);
        strict_1.default.equal(result.body?.legacyNeedsAdmin, true);
        strict_1.default.equal(store.has('auth:legacyhero'), false);
    });
    (0, node_test_1.it)('distinguishes an unused name from a real legacy save during verify', async () => {
        const unused = await post({ action: 'verify', name: 'nobody', password: 'AnyPass1' });
        strict_1.default.equal(unused.statusCode, 200);
        strict_1.default.deepEqual(unused.body, { ok: false, unused: true });
        store.set('save:oldtimer', { character: { name: 'Old Timer' } });
        const legacy = await post({ action: 'verify', name: 'oldtimer', password: 'AnyPass1' });
        strict_1.default.equal(legacy.statusCode, 409);
        strict_1.default.equal(legacy.body?.ok, false);
        strict_1.default.equal(legacy.body?.legacy, true);
        strict_1.default.equal(legacy.body?.legacyNeedsAdmin, true);
    });
    (0, node_test_1.it)('allows only authenticated admin recovery for a legacy save', async () => {
        store.set('save:oldtimer', { character: { name: 'Old Timer' } });
        const denied = await post({
            action: 'adminreset',
            name: 'oldtimer',
            newPassword: 'Recovered2',
        });
        strict_1.default.equal(denied.statusCode, 401);
        const recovered = await post({
            action: 'adminreset',
            name: 'oldtimer',
            newPassword: 'Recovered2',
        }, { 'x-admin-password': process.env.ADMIN_PASSWORD });
        strict_1.default.equal(recovered.statusCode, 200);
        strict_1.default.equal(await verifyPlayerPassword('oldtimer', 'Recovered2'), true);
        strict_1.default.equal(store.get('auth-session:oldtimer'), 1);
    });
    (0, node_test_1.it)('password change immediately invalidates the old token and returns a replacement', async () => {
        const created = await register('alice', 'Original1');
        const oldToken = String(created.body?.token);
        strict_1.default.equal(await verifyPlayerToken(oldToken), 'alice');
        const changed = await post({
            action: 'change',
            name: 'alice',
            oldPassword: 'Original1',
            newPassword: 'Replacement2',
        });
        strict_1.default.equal(changed.statusCode, 200);
        strict_1.default.equal(await verifyPlayerToken(oldToken), null);
        strict_1.default.equal(await verifyPlayerToken(String(changed.body?.token)), 'alice');
        strict_1.default.equal(await verifyPlayerPassword('alice', 'Original1'), false);
        strict_1.default.equal(await verifyPlayerPassword('alice', 'Replacement2'), true);
    });
    (0, node_test_1.it)('admin reset immediately invalidates every previously issued token', async () => {
        const created = await register('resetme', 'Original1');
        const oldToken = String(created.body?.token);
        const reset = await post({
            action: 'adminreset',
            name: 'resetme',
            newPassword: 'AdminReset2',
        }, { 'x-admin-password': process.env.ADMIN_PASSWORD });
        strict_1.default.equal(reset.statusCode, 200);
        strict_1.default.equal(await verifyPlayerToken(oldToken), null);
        strict_1.default.equal(await verifyPlayerPassword('resetme', 'Original1'), false);
        strict_1.default.equal(await verifyPlayerPassword('resetme', 'AdminReset2'), true);
    });
    (0, node_test_1.it)('account deletion revokes its token and refuses unauthenticated missing-account deletion', async () => {
        const created = await register('deleteme', 'Original1');
        const oldToken = String(created.body?.token);
        const deleted = await post({ action: 'delete', name: 'deleteme', password: 'Original1' });
        strict_1.default.equal(deleted.statusCode, 200);
        strict_1.default.equal(await verifyPlayerToken(oldToken), null);
        strict_1.default.equal(store.has('auth:deleteme'), false);
        strict_1.default.equal(store.get('auth-session:deleteme'), 1);
        const missing = await post({ action: 'delete', name: 'ghost', password: 'Whatever1' });
        strict_1.default.equal(missing.statusCode, 404);
    });
    (0, node_test_1.it)('uses NX so concurrent registrations cannot both claim an account', async () => {
        const [first, second] = await Promise.all([
            register('racer', 'FirstPass1'),
            register('racer', 'SecondPass2'),
        ]);
        strict_1.default.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);
        const firstWon = await verifyPlayerPassword('racer', 'FirstPass1');
        const secondWon = await verifyPlayerPassword('racer', 'SecondPass2');
        strict_1.default.notEqual(firstWon, secondWon);
    });
    (0, node_test_1.it)('serializes concurrent password changes so the same old password succeeds once', async () => {
        await register('changerace', 'Original1');
        const [first, second] = await Promise.all([
            post({ action: 'change', name: 'changerace', oldPassword: 'Original1', newPassword: 'FirstNext1' }),
            post({ action: 'change', name: 'changerace', oldPassword: 'Original1', newPassword: 'SecondNext2' }),
        ]);
        strict_1.default.deepEqual([first.statusCode, second.statusCode].sort(), [200, 401]);
        const firstWon = await verifyPlayerPassword('changerace', 'FirstNext1');
        const secondWon = await verifyPlayerPassword('changerace', 'SecondNext2');
        strict_1.default.notEqual(firstWon, secondWon);
        strict_1.default.equal(store.get('auth-session:changerace'), 1);
    });
    (0, node_test_1.it)('serializes registration against admin recovery without leaving a stale valid token', async () => {
        const [registration, reset] = await Promise.all([
            register('adminrace', 'Registrant1'),
            post({
                action: 'adminreset',
                name: 'adminrace',
                newPassword: 'AdminWins2',
            }, { 'x-admin-password': process.env.ADMIN_PASSWORD }),
        ]);
        strict_1.default.equal(reset.statusCode, 200);
        strict_1.default.ok(registration.statusCode === 200 || registration.statusCode === 409);
        if (registration.statusCode === 200) {
            strict_1.default.equal(await verifyPlayerToken(String(registration.body?.token)), null);
        }
        strict_1.default.equal(await verifyPlayerPassword('adminrace', 'AdminWins2'), true);
    });
    (0, node_test_1.it)('fails safely when epoch rotation succeeds but the password write fails', async () => {
        const created = await register('writefail', 'Original1');
        const oldToken = String(created.body?.token);
        failNextAuthWrite = true;
        const changed = await post({
            action: 'change',
            name: 'writefail',
            oldPassword: 'Original1',
            newPassword: 'Replacement2',
        });
        strict_1.default.equal(changed.statusCode, 503);
        strict_1.default.equal(await verifyPlayerToken(oldToken), null, 'rotation revokes the old token even on write failure');
        strict_1.default.equal(await verifyPlayerPassword('writefail', 'Original1'), true, 'the old hash remains intact');
        const login = await post({ action: 'verify', name: 'writefail', password: 'Original1' });
        strict_1.default.equal(login.statusCode, 200);
        strict_1.default.equal(login.body?.ok, true);
        strict_1.default.equal(login.body?.token, undefined, 'a stale auth row must not mint an unusable token');
    });
});
