import { test } from 'node:test';
import assert from 'node:assert/strict';

test('Google proof is signed, expires independently, and follows session revocation', async (t) => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.SESSION_SECRET = 'google-proof-test-secret';
    process.env.GOOGLE_SESSION_PROOF_PHASE = 'enforce';
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

test('rollout phases accept existing sessions, gate issuance, and safely drain v3', async (t) => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.SESSION_SECRET = 'google-proof-test-secret';
    const auth = await import('./_auth.js');
    const now = Date.now();
    process.env.GOOGLE_SESSION_PROOF_PHASE = 'issue';
    const proof = auth.issueGooglePlayerToken('rolloutowner')!;
    assert.ok(proof.startsWith('v3.'));
    for (const phase of [undefined, 'prepare', 'issue', 'enforce', 'drain', 'ENFORCE', 'typo']) {
        if (phase === undefined) delete process.env.GOOGLE_SESSION_PROOF_PHASE;
        else process.env.GOOGLE_SESSION_PROOF_PHASE = phase;
        const issued = auth.issueGooglePlayerToken('rolloutowner')!;
        assert.ok(issued.startsWith(phase === 'issue' || phase === 'enforce' ? 'v3.' : 'v2.'), String(phase));
        assert.equal(await auth.verifyPlayerToken(issued), 'rolloutowner');
        assert.equal(await auth.verifyPlayerToken(proof), 'rolloutowner', 'verification never depends on activation');
        assert.equal(await auth.googlePlayerTokenAuthenticatedAt(issued) !== null, phase === 'issue' || phase === 'enforce');
    }
    process.env.GOOGLE_SESSION_PROOF_PHASE = 'prepare';
    assert.equal(await auth.maybeRefreshPlayerToken(proof), null, 'prepare does not prematurely refresh');
    process.env.GOOGLE_SESSION_PROOF_PHASE = 'drain';
    const drained = await auth.maybeRefreshPlayerToken(proof);
    assert.ok(drained?.startsWith('v2.'), 'drain converts even a fresh v3');
    assert.equal(await auth.verifyPlayerToken(drained!), 'rolloutowner');
    assert.equal(await auth.googlePlayerTokenAuthenticatedAt(drained!), null, 'drain cannot renew Google proof');
    assert.equal(await auth.maybeRefreshPlayerToken(drained!), null, 'fresh v2 does not churn');
    const forged = proof.split('.');
    forged[4] = String(Number(forged[4]) + 1);
    assert.equal(await auth.maybeRefreshPlayerToken(forged.join('.')), null);
    t.mock.method(Date, 'now', () => now + 25 * 60 * 60_000);
    assert.equal(await auth.maybeRefreshPlayerToken(proof), null, 'expired sessions cannot drain');
    t.mock.restoreAll();
    await auth.rotatePlayerSessionEpoch('rolloutowner');
    assert.equal(await auth.maybeRefreshPlayerToken(proof), null, 'revoked sessions cannot drain');
    assert.equal(await auth.verifyPlayerToken(drained!), null, 'drained tokens keep the original epoch');
    delete process.env.GOOGLE_SESSION_PROOF_PHASE;
});
