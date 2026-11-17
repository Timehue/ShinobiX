import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

/*
 * Audit records for admin logins and the compact save diff
 * (api/_admin-audit.ts). Logging only: every test also pins that the auth
 * DECISION is what it was before, and that no credential reaches the log.
 */

let audit: typeof import('./_admin-audit.js');
let auth: typeof import('./_auth.js');
let readAudit: typeof import('./_audit.js').readAudit;
let auditKey: typeof import('./_audit.js').auditKey;
let recordAudit: typeof import('./_audit.js').recordAudit;
let maxAuditEntries: typeof import('./_audit.js').maxAuditEntries;
let kv: typeof import('./_storage.js').kv;
let resetLimits: () => void;
let loginHandler: (req: never, res: never) => Promise<unknown>;

const PRIOR = { ...process.env };
const FULL = 'admin-audit-full-password-for-tests';
const CONTENT = 'admin-audit-content-password-for-tests';
type Json = Record<string, unknown>;

before(async () => {
    audit = await import('./_admin-audit.js');
    auth = await import('./_auth.js');
    ({ readAudit, auditKey, recordAudit, maxAuditEntries } = await import('./_audit.js'));
    ({ kv } = await import('./_storage.js'));
    resetLimits = (await import('./_ratelimit.js')).__resetRateLimitsForTest;
    loginHandler = (await import('./admin-auth.js')).default as unknown as typeof loginHandler;
});

beforeEach(async () => {
    process.env.ADMIN_PASSWORD = FULL;
    process.env.ADMIN_CONTENT_PASSWORD = CONTENT;
    process.env.SESSION_SECRET = 'admin-audit-player-session-secret';
    process.env.ADMIN_SESSION_SECRET = 'admin-audit-admin-session-secret';
    delete process.env.ADMIN_STRICT_TOKEN_ONLY;
    resetLimits();
    await kv.del(auditKey('auth'));
});

after(() => {
    for (const key of ['ADMIN_PASSWORD', 'ADMIN_CONTENT_PASSWORD', 'SESSION_SECRET', 'ADMIN_SESSION_SECRET', 'ADMIN_STRICT_TOKEN_ONLY']) {
        if (PRIOR[key] === undefined) delete process.env[key];
        else process.env[key] = PRIOR[key];
    }
});

async function login(password: unknown, ip = '10.77.0.1') {
    let status = 0; let body: Json = {};
    const res = {
        setHeader() { return res; },
        status(n: number) { status = n; return res; },
        json(b: Json) { body = b; return res; },
        end() { return res; },
    };
    await loginHandler({ method: 'POST', body: { password }, headers: {}, socket: { remoteAddress: ip } } as never, res as never);
    return { status, body };
}

const headerReq = (password: string, ip = '10.77.1.1') => ({
    headers: { 'x-admin-password': password },
    socket: { remoteAddress: ip },
});

// The header-failure records are not awaited by the synchronous auth check.
const settle = () => audit.flushAdminAuthAudit();

async function rawAuthLog(): Promise<string> {
    return JSON.stringify(await kv.get(auditKey('auth')) ?? []);
}

// ─── Login route ─────────────────────────────────────────────────────────────

test('a successful login is recorded with its role and address, not the password', async () => {
    const full = await login(FULL);
    assert.equal(full.status, 200);
    assert.equal(full.body.role, 'full');
    const content = await login(CONTENT, '10.77.0.2');
    assert.equal(content.status, 200);
    assert.equal(content.body.role, 'content');

    const [newest, older] = await readAudit('auth');
    assert.equal(older.action, 'admin.login');
    assert.equal(older.actor, 'admin:full');
    assert.equal((older.meta as Json).ip, '10.77.0.1');
    assert.equal((older.meta as Json).source, 'admin-auth');
    assert.equal(newest.actor, 'admin:content');
    assert.equal((newest.meta as Json).role, 'content');

    const raw = await rawAuthLog();
    assert.ok(!raw.includes(FULL) && !raw.includes(CONTENT), 'no password in the log');
    assert.ok(!raw.includes(String(full.body.token)), 'no token in the log');
});

test('a failed login is recorded without the guess, and is still refused', async () => {
    const guess = 'definitely-not-the-admin-password';
    const out = await login(guess);
    assert.equal(out.status, 401);
    assert.equal(out.body.token, undefined);
    const empty = await login('');
    assert.equal(empty.status, 401);

    const entries = await readAudit('auth');
    assert.equal(entries.length, 2);
    for (const entry of entries) {
        assert.equal(entry.action, 'admin.login-failed');
        assert.equal(entry.actor, 'unknown');
        assert.equal((entry.meta as Json).role, undefined);
    }
    assert.ok(!(await rawAuthLog()).includes(guess));
});

// ─── x-admin-password header on any route ────────────────────────────────────

test('a wrong admin-password header is recorded once per request, and the lockout is marked', async () => {
    const req = headerReq('header-guess-0');
    // One request reaching several checks is charged — and logged — once.
    assert.equal(auth.isAdmin(req), false);
    assert.equal(auth.isFullAdmin(req), false);
    assert.equal(auth.adminRole(req), null);
    for (let i = 1; i < auth.ADMIN_PASSWORD_FAIL_LIMIT; i++) {
        assert.equal(auth.isAdmin(headerReq(`header-guess-${i}`)), false);
    }
    // Budget spent: the right password is refused exactly as before.
    assert.equal(auth.isFullAdmin(headerReq(FULL)), false);
    await settle();

    const entries = await readAudit('auth');
    assert.equal(entries.length, auth.ADMIN_PASSWORD_FAIL_LIMIT, 'one record per charged guess, none for the refused correct one');
    assert.ok(entries.every((e) => e.action === 'admin.password-rejected'));
    assert.equal((entries[0].meta as Json).lockedOut, true, 'the guess that spent the budget is marked');
    assert.equal((entries[1].meta as Json).lockedOut, undefined);
    assert.equal((entries[0].meta as Json).ip, '10.77.1.1');
    assert.ok(!(await rawAuthLog()).includes('header-guess-'), 'no guessed value in the log');
});

test('a correct admin-password header is never logged (it is every admin request)', async () => {
    for (let i = 0; i < 5; i++) assert.equal(auth.isFullAdmin(headerReq(FULL)), true);
    await settle();
    assert.deepEqual(await readAudit('auth'), []);
});

test('failure records are throttled process-wide; the auth answer is unchanged past the throttle', async () => {
    const total = audit.AUTH_FAILURE_AUDIT_LIMIT + 10;
    for (let i = 0; i < total; i++) {
        // A fresh address each time, so the per-IP guess budget never runs out.
        assert.equal(auth.isAdmin(headerReq(`spray-${i}`, `10.78.${Math.floor(i / 200)}.${i % 200}`)), false);
    }
    await settle();
    assert.equal((await readAudit('auth')).length, audit.AUTH_FAILURE_AUDIT_LIMIT);
    // Success is never throttled away.
    assert.equal((await login(FULL, '10.79.0.1')).status, 200);
    assert.equal((await readAudit('auth'))[0].action, 'admin.login');
});

test('adminAuditIdentity reports the credential kind of the verified role', () => {
    assert.deepEqual(auth.adminAuditIdentity(headerReq(FULL)), { role: 'full', via: 'password' });
    assert.deepEqual(auth.adminAuditIdentity(headerReq(CONTENT)), { role: 'content', via: 'password' });
    const token = auth.issueAdminToken('content')!;
    assert.deepEqual(auth.adminAuditIdentity({ headers: { 'x-admin-token': token } }), { role: 'content', via: 'token' });
    // A content token alongside the full password: the role adminRole grants is
    // full, and the password is what granted it.
    assert.deepEqual(
        auth.adminAuditIdentity({ headers: { 'x-admin-token': token, 'x-admin-password': FULL } }),
        { role: 'full', via: 'password' },
    );
    assert.deepEqual(auth.adminAuditIdentity({ headers: {} }), { role: null, via: null });
});

test('the auth audit list keeps a shorter cap than the other domains', async () => {
    assert.equal(maxAuditEntries('auth'), 1000);
    assert.equal(maxAuditEntries('admin'), 5000);
    await kv.set(auditKey('auth'), Array.from({ length: 1000 }, (_, i) => ({ ts: i, actor: 'x', domain: 'auth', action: 'old' })));
    assert.equal(await recordAudit({ domain: 'auth', actor: 'admin:full', action: 'admin.login' }), true);
    const list = await kv.get<unknown[]>(auditKey('auth'));
    assert.equal(list?.length, 1000);
});

// ─── Compact save diff ───────────────────────────────────────────────────────

test('compactSaveDiff lists changed paths only, one level into character', () => {
    const diff = audit.compactSaveDiff(
        { _saveVersion: 3, _saveAt: 1, currentSector: 4, character: { name: 'a', level: 1, ryo: 10, gear: { head: 'x' } }, story: { n: 1 } },
        { _saveVersion: 4, _saveAt: 2, currentSector: 4, character: { name: 'a', level: 2, ryo: 10, gear: { head: 'y' } }, story: { n: 1 }, added: true },
    );
    assert.deepEqual(diff.changed, ['added', 'character.gear', 'character.level']);
    assert.equal(diff.changedCount, 3);
    assert.deepEqual(diff.before, { added: '[absent]', 'character.gear': '[object 1 keys]', 'character.level': 1 });
    assert.deepEqual(diff.after, { added: true, 'character.gear': '[object 1 keys]', 'character.level': 2 });
});

test('compactSaveDiff treats key order as no change', () => {
    const diff = audit.compactSaveDiff({ character: { a: 1, b: { x: 1, y: 2 } } }, { character: { b: { y: 2, x: 1 }, a: 1 } });
    assert.deepEqual(diff.changed, []);
});

test('compactSaveDiff never records credentials, images or long strings', () => {
    const image = 'data:image/png;base64,' + 'A'.repeat(5000);
    const diff = audit.compactSaveDiff(
        { character: { avatar: 'old', passwordHash: 'old-hash', sessionToken: 'tok-1', bio: 'short' } },
        { character: { avatar: image, passwordHash: 'new-hash', sessionToken: 'tok-2', bio: 'x'.repeat(500) } },
    );
    const text = JSON.stringify(diff);
    for (const secret of ['old-hash', 'new-hash', 'tok-1', 'tok-2', 'AAAA', 'xxxxxxxxxx']) {
        assert.ok(!text.includes(secret), `${secret} leaked: ${text}`);
    }
    assert.equal(diff.after['character.avatar'], `[string ${image.length}]`);
    assert.equal(diff.after['character.passwordHash'], '[redacted]');
    assert.equal(diff.before['character.sessionToken'], '[redacted]');
});

test('compactSaveDiff caps the number of listed paths but counts them all', () => {
    const before: Json = {}; const afterSave: Json = {};
    for (let i = 0; i < audit.MAX_DIFF_FIELDS + 15; i++) { before[`f${String(i).padStart(3, '0')}`] = i; afterSave[`f${String(i).padStart(3, '0')}`] = i + 1; }
    const diff = audit.compactSaveDiff(before, afterSave);
    assert.equal(diff.changed.length, audit.MAX_DIFF_FIELDS);
    assert.equal(diff.changedCount, audit.MAX_DIFF_FIELDS + 15);
});
