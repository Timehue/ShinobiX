import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueSignedDevSessionToken, verifySignedDevSessionToken } from '../shinobij.client/dev-session-auth.js';

const secret = Buffer.alloc(32, 7);

test('signed Vite dev token authenticates only its claimed player', () => {
    const token = issueSignedDevSessionToken('Rill', secret);
    assert.equal(verifySignedDevSessionToken(token, 'rill', secret), 'rill');
    assert.equal(verifySignedDevSessionToken(token, 'someone-else', secret), null);
});

test('a structurally valid but never-issued Vite dev token is rejected', () => {
    const forged = `dev.${Buffer.from('victim').toString('base64url')}.${'x'.repeat(43)}.${'y'.repeat(43)}`;
    assert.equal(verifySignedDevSessionToken(forged, 'victim', secret), null);
});

test('tampering with the player payload or signature invalidates a Vite dev token', () => {
    const token = issueSignedDevSessionToken('rill', secret);
    const parts = token.split('.');
    const renamed = `dev.${Buffer.from('victim').toString('base64url')}.${parts[2]}.${parts[3]}`;
    assert.equal(verifySignedDevSessionToken(renamed, 'victim', secret), null);
    // The final base64url char of a 32-byte signature carries only 4 significant bits, so
    // editing it can decode back to the same bytes; flip a whole signature byte instead.
    const forgedSignature = Buffer.from(parts[3], 'base64url');
    forgedSignature[0] ^= 0xff;
    const tampered = `dev.${parts[1]}.${parts[2]}.${forgedSignature.toString('base64url')}`;
    assert.equal(verifySignedDevSessionToken(tampered, 'rill', secret), null);
});
