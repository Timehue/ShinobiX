import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let auth: typeof import('./_auth.js');
let resetLimits: () => void;
const PRIOR = { ...process.env };
const FULL = 'full-admin-password-for-tests-1';
const CONTENT = 'content-admin-password-for-tests-2';

before(async () => {
    auth = await import('./_auth.js');
    resetLimits = (await import('./_ratelimit.js')).__resetRateLimitsForTest;
});

beforeEach(() => {
    process.env.ADMIN_PASSWORD = FULL;
    process.env.ADMIN_CONTENT_PASSWORD = CONTENT;
    process.env.SESSION_SECRET = 'player-session-secret-for-tests';
    process.env.ADMIN_SESSION_SECRET = 'admin-session-secret-for-tests';
    delete process.env.ADMIN_STRICT_TOKEN_ONLY;
    delete process.env.ADMIN_SESSION_EPOCH;
    resetLimits();
});

after(() => {
    for (const key of ['ADMIN_PASSWORD', 'ADMIN_CONTENT_PASSWORD', 'SESSION_SECRET', 'ADMIN_SESSION_SECRET', 'ADMIN_STRICT_TOKEN_ONLY', 'ADMIN_SESSION_EPOCH']) {
        if (PRIOR[key] === undefined) delete process.env[key];
        else process.env[key] = PRIOR[key];
    }
});

const adminReq = (password: string, ip = '10.90.0.1') => ({
    headers: { 'x-admin-password': password },
    socket: { remoteAddress: ip },
});

test('the content password no longer acts as any player on gameplay routes', async () => {
    assert.equal(await auth.authedPlayerOrAdmin(adminReq(CONTENT)), null,
        'Admin 2 cannot reach the "admins can act as anyone" branch by default');
    assert.deepEqual(await auth.authedPlayerOrAdmin(adminReq(CONTENT), undefined, { allowContentAdmin: true }), { admin: true },
        'content-curation handlers opt back in');
    assert.deepEqual(await auth.authedPlayerOrAdmin(adminReq(FULL)), { admin: true });
    assert.equal(auth.isAdmin(adminReq(CONTENT)), true, 'isAdmin is unchanged for content endpoints');
    assert.equal(auth.isFullAdmin(adminReq(CONTENT)), false);
});

test('wrong admin passwords spend a per-IP budget, after which even the right one is refused', () => {
    for (let i = 0; i < auth.ADMIN_PASSWORD_FAIL_LIMIT; i++) {
        assert.equal(auth.isAdmin(adminReq(`guess-${i}`)), false);
    }
    assert.equal(auth.isFullAdmin(adminReq(FULL)), false, 'no unlimited oracle: the budget is spent');
    assert.equal(auth.isFullAdmin(adminReq(FULL, '10.90.0.2')), true, 'the budget is per address');
});

test('one request is charged once, however many admin checks it passes through', () => {
    const req = adminReq('single-wrong-guess');
    for (let i = 0; i < auth.ADMIN_PASSWORD_FAIL_LIMIT * 2; i++) {
        auth.isAdmin(req);
        auth.isFullAdmin(req);
        auth.adminRole(req);
    }
    assert.equal(auth.isFullAdmin(adminReq(FULL)), true);
});

test('a correct password is never charged', () => {
    for (let i = 0; i < auth.ADMIN_PASSWORD_FAIL_LIMIT * 3; i++) assert.equal(auth.isFullAdmin(adminReq(FULL)), true);
});

test('a placeholder admin password from .env.example fails closed', () => {
    process.env.ADMIN_PASSWORD = 'change-me';
    assert.equal(auth.isFullAdmin(adminReq('change-me')), false);
    process.env.ADMIN_CONTENT_PASSWORD = 'change-me-too';
    assert.equal(auth.isAdmin(adminReq('change-me-too')), false);
});

test('the admin login refuses a placeholder password too', async () => {
    process.env.ADMIN_PASSWORD = 'change-me';
    const handler = (await import('./admin-auth.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    let status = 0; let body: Record<string, unknown> = {};
    const res = { setHeader() { return res; }, status(n: number) { status = n; return res; }, json(b: Record<string, unknown>) { body = b; return res; }, end() { return res; } };
    await handler({ method: 'POST', body: { password: 'change-me' }, headers: {}, socket: { remoteAddress: '10.90.9.9' } } as never, res as never);
    assert.notEqual(status, 200);
    assert.equal(body.token, undefined);
});

test('admin tokens are domain-separated from player tokens', () => {
    const token = auth.issueAdminToken('full');
    assert.ok(token?.startsWith('av2.full.'));
    assert.equal(auth.verifyAdminToken(token!), 'full');

    // The pre-fix forgery: a player named `full` re-wraps their own token's
    // signature as an admin token. Even with the SAME secret on both sides it
    // must not verify, because the admin message is prefixed.
    process.env.ADMIN_SESSION_SECRET = 'shared-secret-xyz';
    process.env.SESSION_SECRET = 'different-player-secret';
    const exp = Date.now() + 60_000;
    const playerShapedSig = createHmac('sha256', 'shared-secret-xyz').update(`full.${exp}.0`).digest('base64url');
    assert.equal(auth.verifyAdminToken(`av2.full.${exp}.0.${playerShapedSig}`), null);
    assert.equal(auth.verifyAdminToken(`av1.full.${exp}.0.${playerShapedSig}`), null, 'the old version is refused outright');
});

test('admin tokens are disabled while ADMIN_SESSION_SECRET equals SESSION_SECRET', () => {
    process.env.ADMIN_SESSION_SECRET = 'one-secret-for-both';
    process.env.SESSION_SECRET = 'one-secret-for-both';
    assert.equal(auth.issueAdminToken('full'), null);
    assert.equal(auth.isFullAdmin(adminReq(FULL)), true, 'the password path keeps the operator in');
});

test('staff-looking names are refused for new accounts', async () => {
    const { hasStaffImpersonationName } = await import('./_text-moderation.js');
    for (const name of ['Admin', 'AdminRill', 'xX Moderator Xx', 'GameMaster', 'Official Staff', 'The Owner', 'RillTheAdmin', '4dm1n']) {
        assert.equal(hasStaffImpersonationName(name), true, name);
    }
    for (const name of ['Rill', 'Badminton', 'Kaze', 'Shanks', 'Modrin', 'Devon']) {
        assert.equal(hasStaffImpersonationName(name), false, name);
    }
});
