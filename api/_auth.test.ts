import { createHmac } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { kv } from './_storage.js';
import {
    issuePlayerToken,
    playerSessionEpochKey,
    rotatePlayerSessionEpoch,
    verifyPlayerToken,
} from './_auth.js';

const PRIOR_SECRET = process.env.SESSION_SECRET;
const originalGet = kv.get;
const originalIncr = kv.incr;
const epochs = new Map<string, number>();
const missingAccounts = new Set<string>();

function authName(key: string): string {
    return key.slice('auth:'.length);
}

function legacyToken(name: string, expMs: number): string {
    const canonical = name.toLowerCase();
    const sig = createHmac('sha256', process.env.SESSION_SECRET!)
        .update(`${canonical}.${expMs}`)
        .digest('base64url');
    return `v1.${Buffer.from(canonical).toString('base64url')}.${expMs}.${sig}`;
}

describe('player session tokens', () => {
    before(() => {
        process.env.SESSION_SECRET = 'test-secret-do-not-use-in-prod';
        kv.get = async <T,>(key: string) => {
            if (key.startsWith('auth-session:')) return (epochs.get(key) ?? null) as T | null;
            if (key.startsWith('auth:')) {
                return (missingAccounts.has(authName(key)) ? null : { hash: 'exists', salt: 'exists' }) as T | null;
            }
            return null;
        };
        kv.incr = async (key: string) => {
            const next = (epochs.get(key) ?? 0) + 1;
            epochs.set(key, next);
            return next;
        };
    });

    beforeEach(() => {
        // Reset the secret every test so a prior test that mutates it (and could
        // fail before restoring) can never leak the wrong secret forward. Keeps
        // the suite deterministic regardless of test order or a mid-test throw.
        process.env.SESSION_SECRET = 'test-secret-do-not-use-in-prod';
        epochs.clear();
        missingAccounts.clear();
    });

    after(() => {
        kv.get = originalGet;
        kv.incr = originalIncr;
        if (PRIOR_SECRET === undefined) delete process.env.SESSION_SECRET;
        else process.env.SESSION_SECRET = PRIOR_SECRET;
    });

    it('round-trips a freshly issued token to the canonical account name', async () => {
        const token = issuePlayerToken('Rill');
        assert.ok(token);
        assert.equal(await verifyPlayerToken(token), 'rill');
    });

    it('canonicalizes names exactly like save/auth storage keys', async () => {
        assert.equal(await verifyPlayerToken(issuePlayerToken('  MiXeDCase  ')!), 'mixedcase');
        assert.equal(await verifyPlayerToken(issuePlayerToken('Cool Ninja')!), 'coolninja');
        assert.equal(await verifyPlayerToken(issuePlayerToken('Naruto-Uzumaki_99')!), 'naruto-uzumaki_99');
        assert.equal(await verifyPlayerToken(issuePlayerToken('a'.repeat(40))!), 'a'.repeat(32));
    });

    it('does not issue a usable token for an empty canonical name', async () => {
        assert.equal(issuePlayerToken('!!!'), null);
        assert.equal(await verifyPlayerToken(''), null);
    });

    it('rejects tampered name, expiry, epoch, and signature fields', async () => {
        const token = issuePlayerToken('alice')!;

        const nameParts = token.split('.');
        nameParts[1] = Buffer.from('bob').toString('base64url');
        assert.equal(await verifyPlayerToken(nameParts.join('.')), null);

        const expiryParts = token.split('.');
        expiryParts[2] = String(Number(expiryParts[2]) + 600_000);
        assert.equal(await verifyPlayerToken(expiryParts.join('.')), null);

        const epochParts = token.split('.');
        epochParts[3] = '1';
        assert.equal(await verifyPlayerToken(epochParts.join('.')), null);

        const signatureParts = token.split('.');
        // Flip the final character to one guaranteed to differ, so the tamper is
        // never accidentally a no-op. Overwriting the last chars with a fixed
        // 'AA' left the signature unchanged whenever the real HMAC already ended
        // in 'AA' (~1/1000 of runs — base64url's final char is a restricted set),
        // and that collision, not any env race, is what made this test flaky.
        const realSig = signatureParts[4];
        signatureParts[4] = realSig.slice(0, -1) + (realSig.endsWith('A') ? 'B' : 'A');
        assert.equal(await verifyPlayerToken(signatureParts.join('.')), null);
    });

    it('rejects expired and malformed tokens', async () => {
        assert.equal(await verifyPlayerToken(issuePlayerToken('alice', -1_000)!), null);
        for (const malformed of [
            '',
            'garbage',
            'a.b.c',
            'v2.x.123.sig',
            'v2.x.123.0.sig.extra',
            'v3.x.123.0.sig',
        ]) {
            assert.equal(await verifyPlayerToken(malformed), null);
        }
    });

    it('rejects tokens signed under another secret', async () => {
        const token = issuePlayerToken('alice')!;
        process.env.SESSION_SECRET = 'a-completely-different-secret';
        assert.equal(await verifyPlayerToken(token), null);
        // beforeEach restores the canonical secret for the next test.
    });

    it('disables token issue and verification without SESSION_SECRET', async () => {
        delete process.env.SESSION_SECRET;
        assert.equal(issuePlayerToken('alice'), null);
        assert.equal(await verifyPlayerToken('v1.YWxpY2U.9999999999999.sig'), null);
        // beforeEach restores the canonical secret for the next test.
    });

    it('revokes an old token immediately when the account epoch rotates', async () => {
        const token = issuePlayerToken('alice', undefined, 0)!;
        assert.equal(await verifyPlayerToken(token), 'alice');
        assert.equal(await rotatePlayerSessionEpoch('alice'), 1);
        assert.equal(await verifyPlayerToken(token), null);

        const replacement = issuePlayerToken('alice', undefined, 1)!;
        assert.equal(await verifyPlayerToken(replacement), 'alice');
    });

    it('rejects a token immediately when its auth record is deleted', async () => {
        const token = issuePlayerToken('alice')!;
        assert.equal(await verifyPlayerToken(token), 'alice');
        await rotatePlayerSessionEpoch('alice');
        missingAccounts.add('alice');
        assert.equal(await verifyPlayerToken(token), null);
    });

    it('accepts a legacy v1 token only while the account remains at epoch zero', async () => {
        const token = legacyToken('alice', Date.now() + 60_000);
        assert.equal(await verifyPlayerToken(token), 'alice');
        epochs.set(playerSessionEpochKey('alice'), 1);
        assert.equal(await verifyPlayerToken(token), null);
    });

    it('fails closed when the shared epoch is corrupt or unavailable', async () => {
        const token = issuePlayerToken('alice')!;
        epochs.set(playerSessionEpochKey('alice'), Number.NaN);
        assert.equal(await verifyPlayerToken(token), null);
    });
});
