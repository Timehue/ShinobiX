"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _auth_js_1 = require("./_auth.js");
// Phase 4: admin logins mint a short-lived signed session token so the reusable
// ADMIN_PASSWORD is no longer forwarded on every request. These cover the token
// contract (roles, expiry, tamper, revocation) and the isAdmin/isFullAdmin
// integration incl. the inert-without-secret and strict-token-only behaviours.
const SECRET = 'admin-session-test-secret-0123456789';
const saved = {};
const ENV_KEYS = ['ADMIN_SESSION_SECRET', 'ADMIN_SESSION_EPOCH', 'ADMIN_STRICT_TOKEN_ONLY', 'ADMIN_PASSWORD', 'ADMIN_CONTENT_PASSWORD'];
(0, node_test_1.beforeEach)(() => {
    for (const k of ENV_KEYS)
        saved[k] = process.env[k];
    process.env.ADMIN_SESSION_SECRET = SECRET;
    delete process.env.ADMIN_SESSION_EPOCH;
    delete process.env.ADMIN_STRICT_TOKEN_ONLY;
    process.env.ADMIN_PASSWORD = 'full-pw';
    process.env.ADMIN_CONTENT_PASSWORD = 'content-pw';
});
(0, node_test_1.afterEach)(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined)
            delete process.env[k];
        else
            process.env[k] = saved[k];
    }
});
const reqWith = (headers) => ({ headers });
(0, node_test_1.describe)('admin session tokens', () => {
    (0, node_test_1.it)('round-trips a full and a content token to their role', () => {
        strict_1.default.equal((0, _auth_js_1.verifyAdminToken)((0, _auth_js_1.issueAdminToken)('full')), 'full');
        strict_1.default.equal((0, _auth_js_1.verifyAdminToken)((0, _auth_js_1.issueAdminToken)('content')), 'content');
    });
    (0, node_test_1.it)('is INERT without ADMIN_SESSION_SECRET (issuing and verifying both no-op)', () => {
        const good = (0, _auth_js_1.issueAdminToken)('full');
        delete process.env.ADMIN_SESSION_SECRET;
        strict_1.default.equal((0, _auth_js_1.issueAdminToken)('full'), null, 'no minting without a secret');
        strict_1.default.equal((0, _auth_js_1.verifyAdminToken)(good), null, 'no verifying without a secret');
    });
    (0, node_test_1.it)('rejects a forged signature', () => {
        const t = (0, _auth_js_1.issueAdminToken)('full');
        const parts = t.split('.');
        parts[4] = 'deadbeef';
        strict_1.default.equal((0, _auth_js_1.verifyAdminToken)(parts.join('.')), null);
    });
    (0, node_test_1.it)('rejects an altered role claim (full→content and content→full)', () => {
        const full = (0, _auth_js_1.issueAdminToken)('full').split('.');
        full[1] = 'content';
        strict_1.default.equal((0, _auth_js_1.verifyAdminToken)(full.join('.')), null, 'privilege change breaks the signature');
    });
    (0, node_test_1.it)('rejects an altered expiry', () => {
        const t = (0, _auth_js_1.issueAdminToken)('full').split('.');
        t[2] = String(Number(t[2]) + 10 * 60 * 60 * 1000);
        strict_1.default.equal((0, _auth_js_1.verifyAdminToken)(t.join('.')), null);
    });
    (0, node_test_1.it)('rejects an expired token', () => {
        strict_1.default.equal((0, _auth_js_1.verifyAdminToken)((0, _auth_js_1.issueAdminToken)('full', -1000)), null);
    });
    (0, node_test_1.it)('revokes all tokens when the epoch is bumped', () => {
        const t = (0, _auth_js_1.issueAdminToken)('full');
        strict_1.default.equal((0, _auth_js_1.verifyAdminToken)(t), 'full');
        process.env.ADMIN_SESSION_EPOCH = '1';
        strict_1.default.equal((0, _auth_js_1.verifyAdminToken)(t), null, 'an epoch bump invalidates outstanding tokens');
    });
    (0, node_test_1.it)('isFullAdmin / isAdmin accept a valid token; content is NOT full', () => {
        const full = (0, _auth_js_1.issueAdminToken)('full');
        const content = (0, _auth_js_1.issueAdminToken)('content');
        strict_1.default.equal((0, _auth_js_1.isFullAdmin)(reqWith({ 'x-admin-token': full })), true);
        strict_1.default.equal((0, _auth_js_1.isAdmin)(reqWith({ 'x-admin-token': full })), true);
        strict_1.default.equal((0, _auth_js_1.isFullAdmin)(reqWith({ 'x-admin-token': content })), false, 'content admin is not full');
        strict_1.default.equal((0, _auth_js_1.isAdmin)(reqWith({ 'x-admin-token': content })), true);
        strict_1.default.equal((0, _auth_js_1.adminRole)(reqWith({ 'x-admin-token': content })), 'content');
        strict_1.default.equal((0, _auth_js_1.adminRole)(reqWith({ 'x-admin-token': full })), 'full');
    });
    (0, node_test_1.it)('still accepts the password path when the secret is set but strict mode is off', () => {
        strict_1.default.equal((0, _auth_js_1.isFullAdmin)(reqWith({ 'x-admin-password': 'full-pw' })), true);
        strict_1.default.equal((0, _auth_js_1.isAdmin)(reqWith({ 'x-admin-password': 'content-pw' })), true);
        strict_1.default.equal((0, _auth_js_1.isFullAdmin)(reqWith({ 'x-admin-password': 'wrong' })), false);
    });
    (0, node_test_1.it)('STRICT mode rejects the reusable password and requires a token', () => {
        process.env.ADMIN_STRICT_TOKEN_ONLY = '1';
        strict_1.default.equal((0, _auth_js_1.isFullAdmin)(reqWith({ 'x-admin-password': 'full-pw' })), false, 'password rejected in strict mode');
        strict_1.default.equal((0, _auth_js_1.isAdmin)(reqWith({ 'x-admin-password': 'content-pw' })), false);
        // A valid token still works in strict mode.
        strict_1.default.equal((0, _auth_js_1.isFullAdmin)(reqWith({ 'x-admin-token': (0, _auth_js_1.issueAdminToken)('full') })), true);
    });
    (0, node_test_1.it)('no admin credential → not admin', () => {
        strict_1.default.equal((0, _auth_js_1.isAdmin)(reqWith({})), false);
        strict_1.default.equal((0, _auth_js_1.adminRole)(reqWith({})), null);
    });
});
