import assert from 'node:assert/strict';
import test from 'node:test';
import { _shouldCache } from '../_storage.js';
import { LockContendedError, withLockCore } from '../_lock.js';
import { lobbyExpiresAt } from './lobby.js';
import { newLobby } from './_lobby-core.js';

test('cross-worker lobby reads bypass process cache', () => {
    assert.equal(_shouldCache('arena:lobby:ABCDEFGH'), false);
});

test('contended lobby mutation fails before its callback can overwrite another worker', async () => {
    let mutated = false;
    await assert.rejects(
        withLockCore('arena:lobby:ABCDEFGH', async () => { mutated = true; }, {
            tryAcquire: async () => null,
            release: async () => undefined,
        }, { failClosed: true, maxAttempts: 1, baseBackoffMs: 0 }),
        LockContendedError,
    );
    assert.equal(mutated, false);
});

test('lobby writes preserve an absolute lifetime instead of refreshing forever', () => {
    const createdAt = 1_800_000_000_000;
    const lobby = newLobby('ABCDEFGH', 'host', createdAt);
    const openExpiry = lobbyExpiresAt(lobby);
    assert.equal(openExpiry, createdAt + 30 * 60_000);
    lobby.state = 'running';
    lobby.startedAt = createdAt + 29 * 60_000;
    assert.equal(lobbyExpiresAt(lobby), createdAt + 45 * 60_000,
        'late starts remain bounded by the absolute 45-minute lifecycle');
});
