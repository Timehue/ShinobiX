import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { issueAdminToken, verifyAdminToken, isAdmin, isFullAdmin, adminRole } from './_auth.js';

// Phase 4: admin logins mint a short-lived signed session token so the reusable
// ADMIN_PASSWORD is no longer forwarded on every request. These cover the token
// contract (roles, expiry, tamper, revocation) and the isAdmin/isFullAdmin
// integration incl. the inert-without-secret and strict-token-only behaviours.

const SECRET = 'admin-session-test-secret-0123456789';
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ['ADMIN_SESSION_SECRET', 'ADMIN_SESSION_EPOCH', 'ADMIN_STRICT_TOKEN_ONLY', 'ADMIN_PASSWORD', 'ADMIN_CONTENT_PASSWORD'];

beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.ADMIN_SESSION_SECRET = SECRET;
    delete process.env.ADMIN_SESSION_EPOCH;
    delete process.env.ADMIN_STRICT_TOKEN_ONLY;
    process.env.ADMIN_PASSWORD = 'full-pw';
    process.env.ADMIN_CONTENT_PASSWORD = 'content-pw';
});
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

const reqWith = (headers: Record<string, string>) => ({ headers });

describe('admin session tokens', () => {
    it('round-trips a full and a content token to their role', () => {
        assert.equal(verifyAdminToken(issueAdminToken('full')!), 'full');
        assert.equal(verifyAdminToken(issueAdminToken('content')!), 'content');
    });

    it('is INERT without ADMIN_SESSION_SECRET (issuing and verifying both no-op)', () => {
        const good = issueAdminToken('full')!;
        delete process.env.ADMIN_SESSION_SECRET;
        assert.equal(issueAdminToken('full'), null, 'no minting without a secret');
        assert.equal(verifyAdminToken(good), null, 'no verifying without a secret');
    });

    it('rejects a forged signature', () => {
        const t = issueAdminToken('full')!;
        const parts = t.split('.');
        parts[4] = 'deadbeef';
        assert.equal(verifyAdminToken(parts.join('.')), null);
    });

    it('rejects an altered role claim (full→content and content→full)', () => {
        const full = issueAdminToken('full')!.split('.');
        full[1] = 'content';
        assert.equal(verifyAdminToken(full.join('.')), null, 'privilege change breaks the signature');
    });

    it('rejects an altered expiry', () => {
        const t = issueAdminToken('full')!.split('.');
        t[2] = String(Number(t[2]) + 10 * 60 * 60 * 1000);
        assert.equal(verifyAdminToken(t.join('.')), null);
    });

    it('rejects an expired token', () => {
        assert.equal(verifyAdminToken(issueAdminToken('full', -1000)!), null);
    });

    it('revokes all tokens when the epoch is bumped', () => {
        const t = issueAdminToken('full')!;
        assert.equal(verifyAdminToken(t), 'full');
        process.env.ADMIN_SESSION_EPOCH = '1';
        assert.equal(verifyAdminToken(t), null, 'an epoch bump invalidates outstanding tokens');
    });

    it('isFullAdmin / isAdmin accept a valid token; content is NOT full', () => {
        const full = issueAdminToken('full')!;
        const content = issueAdminToken('content')!;
        assert.equal(isFullAdmin(reqWith({ 'x-admin-token': full })), true);
        assert.equal(isAdmin(reqWith({ 'x-admin-token': full })), true);
        assert.equal(isFullAdmin(reqWith({ 'x-admin-token': content })), false, 'content admin is not full');
        assert.equal(isAdmin(reqWith({ 'x-admin-token': content })), true);
        assert.equal(adminRole(reqWith({ 'x-admin-token': content })), 'content');
        assert.equal(adminRole(reqWith({ 'x-admin-token': full })), 'full');
    });

    it('still accepts the password path when the secret is set but strict mode is off', () => {
        assert.equal(isFullAdmin(reqWith({ 'x-admin-password': 'full-pw' })), true);
        assert.equal(isAdmin(reqWith({ 'x-admin-password': 'content-pw' })), true);
        assert.equal(isFullAdmin(reqWith({ 'x-admin-password': 'wrong' })), false);
    });

    it('STRICT mode rejects the reusable password and requires a token', () => {
        process.env.ADMIN_STRICT_TOKEN_ONLY = '1';
        assert.equal(isFullAdmin(reqWith({ 'x-admin-password': 'full-pw' })), false, 'password rejected in strict mode');
        assert.equal(isAdmin(reqWith({ 'x-admin-password': 'content-pw' })), false);
        // A valid token still works in strict mode.
        assert.equal(isFullAdmin(reqWith({ 'x-admin-token': issueAdminToken('full')! })), true);
    });

    it('no admin credential → not admin', () => {
        assert.equal(isAdmin(reqWith({})), false);
        assert.equal(adminRole(reqWith({})), null);
    });
});
