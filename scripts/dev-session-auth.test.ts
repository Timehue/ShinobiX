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
    assert.equal(verifySignedDevSessionToken(`${token.slice(0, -1)}x`, 'rill', secret), null);
});
