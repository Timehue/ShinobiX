"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _storage_js_1 = require("./_storage.js");
const _auth_js_1 = require("./_auth.js");
const PRIOR_SECRET = process.env.SESSION_SECRET;
const originalGet = _storage_js_1.kv.get;
const originalIncr = _storage_js_1.kv.incr;
const epochs = new Map();
const missingAccounts = new Set();
function authName(key) {
    return key.slice('auth:'.length);
}
function legacyToken(name, expMs) {
    const canonical = name.toLowerCase();
    const sig = (0, node_crypto_1.createHmac)('sha256', process.env.SESSION_SECRET)
        .update(`${canonical}.${expMs}`)
        .digest('base64url');
    return `v1.${Buffer.from(canonical).toString('base64url')}.${expMs}.${sig}`;
}
(0, node_test_1.describe)('player session tokens', () => {
    (0, node_test_1.before)(() => {
        process.env.SESSION_SECRET = 'test-secret-do-not-use-in-prod';
        _storage_js_1.kv.get = async (key) => {
            if (key.startsWith('auth-session:'))
                return (epochs.get(key) ?? null);
            if (key.startsWith('auth:')) {
                return (missingAccounts.has(authName(key)) ? null : { hash: 'exists', salt: 'exists' });
            }
            return null;
        };
        _storage_js_1.kv.incr = async (key) => {
            const next = (epochs.get(key) ?? 0) + 1;
            epochs.set(key, next);
            return next;
        };
    });
    (0, node_test_1.beforeEach)(() => {
        epochs.clear();
        missingAccounts.clear();
    });
    (0, node_test_1.after)(() => {
        _storage_js_1.kv.get = originalGet;
        _storage_js_1.kv.incr = originalIncr;
        if (PRIOR_SECRET === undefined)
            delete process.env.SESSION_SECRET;
        else
            process.env.SESSION_SECRET = PRIOR_SECRET;
    });
    (0, node_test_1.it)('round-trips a freshly issued token to the canonical account name', async () => {
        const token = (0, _auth_js_1.issuePlayerToken)('Rill');
        node_assert_1.strict.ok(token);
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)(token), 'rill');
    });
    (0, node_test_1.it)('canonicalizes names exactly like save/auth storage keys', async () => {
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)((0, _auth_js_1.issuePlayerToken)('  MiXeDCase  ')), 'mixedcase');
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)((0, _auth_js_1.issuePlayerToken)('Cool Ninja')), 'coolninja');
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)((0, _auth_js_1.issuePlayerToken)('Naruto-Uzumaki_99')), 'naruto-uzumaki_99');
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)((0, _auth_js_1.issuePlayerToken)('a'.repeat(40))), 'a'.repeat(32));
    });
    (0, node_test_1.it)('does not issue a usable token for an empty canonical name', async () => {
        node_assert_1.strict.equal((0, _auth_js_1.issuePlayerToken)('!!!'), null);
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)(''), null);
    });
    (0, node_test_1.it)('rejects tampered name, expiry, epoch, and signature fields', async () => {
        const token = (0, _auth_js_1.issuePlayerToken)('alice');
        const nameParts = token.split('.');
        nameParts[1] = Buffer.from('bob').toString('base64url');
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)(nameParts.join('.')), null);
        const expiryParts = token.split('.');
        expiryParts[2] = String(Number(expiryParts[2]) + 600_000);
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)(expiryParts.join('.')), null);
        const epochParts = token.split('.');
        epochParts[3] = '1';
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)(epochParts.join('.')), null);
        const signatureParts = token.split('.');
        signatureParts[4] = `${signatureParts[4].slice(0, -2)}AA`;
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)(signatureParts.join('.')), null);
    });
    (0, node_test_1.it)('rejects expired and malformed tokens', async () => {
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)((0, _auth_js_1.issuePlayerToken)('alice', -1_000)), null);
        for (const malformed of [
            '',
            'garbage',
            'a.b.c',
            'v2.x.123.sig',
            'v2.x.123.0.sig.extra',
            'v3.x.123.0.sig',
        ]) {
            node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)(malformed), null);
        }
    });
    (0, node_test_1.it)('rejects tokens signed under another secret', async () => {
        const token = (0, _auth_js_1.issuePlayerToken)('alice');
        process.env.SESSION_SECRET = 'a-completely-different-secret';
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)(token), null);
        process.env.SESSION_SECRET = 'test-secret-do-not-use-in-prod';
    });
    (0, node_test_1.it)('disables token issue and verification without SESSION_SECRET', async () => {
        delete process.env.SESSION_SECRET;
        node_assert_1.strict.equal((0, _auth_js_1.issuePlayerToken)('alice'), null);
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)('v1.YWxpY2U.9999999999999.sig'), null);
        process.env.SESSION_SECRET = 'test-secret-do-not-use-in-prod';
    });
    (0, node_test_1.it)('revokes an old token immediately when the account epoch rotates', async () => {
        const token = (0, _auth_js_1.issuePlayerToken)('alice', undefined, 0);
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)(token), 'alice');
        node_assert_1.strict.equal(await (0, _auth_js_1.rotatePlayerSessionEpoch)('alice'), 1);
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)(token), null);
        const replacement = (0, _auth_js_1.issuePlayerToken)('alice', undefined, 1);
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)(replacement), 'alice');
    });
    (0, node_test_1.it)('rejects a token immediately when its auth record is deleted', async () => {
        const token = (0, _auth_js_1.issuePlayerToken)('alice');
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)(token), 'alice');
        await (0, _auth_js_1.rotatePlayerSessionEpoch)('alice');
        missingAccounts.add('alice');
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)(token), null);
    });
    (0, node_test_1.it)('accepts a legacy v1 token only while the account remains at epoch zero', async () => {
        const token = legacyToken('alice', Date.now() + 60_000);
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)(token), 'alice');
        epochs.set((0, _auth_js_1.playerSessionEpochKey)('alice'), 1);
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)(token), null);
    });
    (0, node_test_1.it)('fails closed when the shared epoch is corrupt or unavailable', async () => {
        const token = (0, _auth_js_1.issuePlayerToken)('alice');
        epochs.set((0, _auth_js_1.playerSessionEpochKey)('alice'), Number.NaN);
        node_assert_1.strict.equal(await (0, _auth_js_1.verifyPlayerToken)(token), null);
    });
});
