"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _auth_js_1 = require("./_auth.js");
// Stateless session-token issue/verify. Pure CPU (HMAC) — no KV, no scrypt,
// no network. SESSION_SECRET is read at call time, so we set it here and
// restore the prior value afterward so other suites are unaffected.
const PRIOR_SECRET = process.env.SESSION_SECRET;
(0, node_test_1.describe)('player session tokens', () => {
    (0, node_test_1.before)(() => {
        process.env.SESSION_SECRET = 'test-secret-do-not-use-in-prod';
    });
    (0, node_test_1.after)(() => {
        if (PRIOR_SECRET === undefined)
            delete process.env.SESSION_SECRET;
        else
            process.env.SESSION_SECRET = PRIOR_SECRET;
    });
    (0, node_test_1.it)('round-trips: a freshly issued token verifies to the canonical name', () => {
        const token = (0, _auth_js_1.issuePlayerToken)('Rill');
        node_assert_1.strict.ok(token, 'token should be issued when SESSION_SECRET is set');
        node_assert_1.strict.equal((0, _auth_js_1.verifyPlayerToken)(token), 'rill', 'verify returns canonical lowercased name');
    });
    (0, node_test_1.it)('canonicalizes the name (trim + lowercase) like the password path', () => {
        const token = (0, _auth_js_1.issuePlayerToken)('  MiXeDCase  ');
        node_assert_1.strict.equal((0, _auth_js_1.verifyPlayerToken)(token), 'mixedcase');
    });
    (0, node_test_1.it)('rejects a tampered name segment', () => {
        const token = (0, _auth_js_1.issuePlayerToken)('alice');
        const parts = token.split('.');
        // Swap the name payload to "bob" (base64url) but keep alice's signature.
        parts[1] = Buffer.from('bob', 'utf8').toString('base64url');
        node_assert_1.strict.equal((0, _auth_js_1.verifyPlayerToken)(parts.join('.')), null);
    });
    (0, node_test_1.it)('rejects a tampered expiry (extending lifetime forges the sig)', () => {
        const token = (0, _auth_js_1.issuePlayerToken)('alice');
        const parts = token.split('.');
        parts[2] = String(Number(parts[2]) + 10 * 60_000); // push expiry out
        node_assert_1.strict.equal((0, _auth_js_1.verifyPlayerToken)(parts.join('.')), null);
    });
    (0, node_test_1.it)('rejects a tampered signature', () => {
        const token = (0, _auth_js_1.issuePlayerToken)('alice');
        const parts = token.split('.');
        parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
        node_assert_1.strict.equal((0, _auth_js_1.verifyPlayerToken)(parts.join('.')), null);
    });
    (0, node_test_1.it)('rejects an expired token', () => {
        // Negative TTL → already expired the instant it is minted.
        const token = (0, _auth_js_1.issuePlayerToken)('alice', -1000);
        node_assert_1.strict.equal((0, _auth_js_1.verifyPlayerToken)(token), null);
    });
    (0, node_test_1.it)('rejects malformed tokens', () => {
        node_assert_1.strict.equal((0, _auth_js_1.verifyPlayerToken)(''), null);
        node_assert_1.strict.equal((0, _auth_js_1.verifyPlayerToken)('garbage'), null);
        node_assert_1.strict.equal((0, _auth_js_1.verifyPlayerToken)('a.b.c'), null); // too few parts
        node_assert_1.strict.equal((0, _auth_js_1.verifyPlayerToken)('a.b.c.d.e'), null); // too many parts
        node_assert_1.strict.equal((0, _auth_js_1.verifyPlayerToken)('v2.x.123.sig'), null); // wrong version
    });
    (0, node_test_1.it)('a token signed under a different secret does not verify', () => {
        const token = (0, _auth_js_1.issuePlayerToken)('alice');
        process.env.SESSION_SECRET = 'a-completely-different-secret';
        node_assert_1.strict.equal((0, _auth_js_1.verifyPlayerToken)(token), null);
        process.env.SESSION_SECRET = 'test-secret-do-not-use-in-prod'; // restore for later cases
    });
    (0, node_test_1.it)('disabled when SESSION_SECRET is unset: issue returns null, verify returns null', () => {
        delete process.env.SESSION_SECRET;
        node_assert_1.strict.equal((0, _auth_js_1.issuePlayerToken)('alice'), null);
        node_assert_1.strict.equal((0, _auth_js_1.verifyPlayerToken)('v1.YWxpY2U.9999999999999.sig'), null);
        process.env.SESSION_SECRET = 'test-secret-do-not-use-in-prod'; // restore for after()
    });
});
