import { test } from 'node:test';
import assert from 'node:assert/strict';

test('Google proof is signed, expires independently, and follows session revocation', async (t) => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.SESSION_SECRET = 'google-proof-test-secret';
    const auth = await import('./_auth.js');
    const { googleSignInIsRecent } = await import('./player-auth.js');
    const now = Date.now();
    const recent = auth.issueGooglePlayerToken('proofowner', 0, now)!;
    assert.equal(await auth.verifyPlayerToken(recent), 'proofowner');
    assert.equal(await googleSignInIsRecent(recent, now), true);
    assert.equal(await googleSignInIsRecent(recent, now + 31 * 60_000), false);
    assert.equal(await googleSignInIsRecent(auth.issuePlayerToken('proofowner')!, now), false);
    const oldProof = auth.issueGooglePlayerToken('proofowner', 0, now - 31 * 60_000)!;
    assert.equal(await auth.verifyPlayerToken(oldProof), 'proofowner', 'expired proof still permits normal play');
    assert.equal(await googleSignInIsRecent(oldProof, now), false);
    const forged = oldProof.split('.');
    forged[4] = String(now);
    assert.equal(await auth.verifyPlayerToken(forged.join('.')), null);
    assert.equal(await googleSignInIsRecent(forged.join('.'), now), false);
    // Refresh an ordinary long-lived session without minting new Google proof.
    t.mock.method(Date, 'now', () => now - 13 * 60 * 60_000);
    const aging = auth.issueGooglePlayerToken('proofowner')!;
    t.mock.restoreAll();
    const refreshed = await auth.maybeRefreshPlayerToken(aging);
    assert.ok(refreshed);
    assert.equal(await auth.verifyPlayerToken(refreshed), 'proofowner');
    assert.equal(await googleSignInIsRecent(refreshed), false);
    await auth.rotatePlayerSessionEpoch('proofowner');
    assert.equal(await auth.verifyPlayerToken(recent), null);
    assert.equal(await googleSignInIsRecent(recent), false);
});
