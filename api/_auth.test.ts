import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { issuePlayerToken, verifyPlayerToken } from './_auth.js';

// Stateless session-token issue/verify. Pure CPU (HMAC) — no KV, no scrypt,
// no network. SESSION_SECRET is read at call time, so we set it here and
// restore the prior value afterward so other suites are unaffected.

const PRIOR_SECRET = process.env.SESSION_SECRET;

describe('player session tokens', () => {
    before(() => {
        process.env.SESSION_SECRET = 'test-secret-do-not-use-in-prod';
    });
    after(() => {
        if (PRIOR_SECRET === undefined) delete process.env.SESSION_SECRET;
        else process.env.SESSION_SECRET = PRIOR_SECRET;
    });

    it('round-trips: a freshly issued token verifies to the canonical name', () => {
        const token = issuePlayerToken('Rill');
        assert.ok(token, 'token should be issued when SESSION_SECRET is set');
        assert.equal(verifyPlayerToken(token!), 'rill', 'verify returns canonical lowercased name');
    });

    it('canonicalizes the name (trim + lowercase) like the password path', () => {
        const token = issuePlayerToken('  MiXeDCase  ');
        assert.equal(verifyPlayerToken(token!), 'mixedcase');
    });

    it('rejects a tampered name segment', () => {
        const token = issuePlayerToken('alice')!;
        const parts = token.split('.');
        // Swap the name payload to "bob" (base64url) but keep alice's signature.
        parts[1] = Buffer.from('bob', 'utf8').toString('base64url');
        assert.equal(verifyPlayerToken(parts.join('.')), null);
    });

    it('rejects a tampered expiry (extending lifetime forges the sig)', () => {
        const token = issuePlayerToken('alice')!;
        const parts = token.split('.');
        parts[2] = String(Number(parts[2]) + 10 * 60_000); // push expiry out
        assert.equal(verifyPlayerToken(parts.join('.')), null);
    });

    it('rejects a tampered signature', () => {
        const token = issuePlayerToken('alice')!;
        const parts = token.split('.');
        parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
        assert.equal(verifyPlayerToken(parts.join('.')), null);
    });

    it('rejects an expired token', () => {
        // Negative TTL → already expired the instant it is minted.
        const token = issuePlayerToken('alice', -1000)!;
        assert.equal(verifyPlayerToken(token), null);
    });

    it('rejects malformed tokens', () => {
        assert.equal(verifyPlayerToken(''), null);
        assert.equal(verifyPlayerToken('garbage'), null);
        assert.equal(verifyPlayerToken('a.b.c'), null);       // too few parts
        assert.equal(verifyPlayerToken('a.b.c.d.e'), null);   // too many parts
        assert.equal(verifyPlayerToken('v2.x.123.sig'), null); // wrong version
    });

    it('a token signed under a different secret does not verify', () => {
        const token = issuePlayerToken('alice')!;
        process.env.SESSION_SECRET = 'a-completely-different-secret';
        assert.equal(verifyPlayerToken(token), null);
        process.env.SESSION_SECRET = 'test-secret-do-not-use-in-prod'; // restore for later cases
    });

    it('disabled when SESSION_SECRET is unset: issue returns null, verify returns null', () => {
        delete process.env.SESSION_SECRET;
        assert.equal(issuePlayerToken('alice'), null);
        assert.equal(verifyPlayerToken('v1.YWxpY2U.9999999999999.sig'), null);
        process.env.SESSION_SECRET = 'test-secret-do-not-use-in-prod'; // restore for after()
    });
});
