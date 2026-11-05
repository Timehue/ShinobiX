process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disconnectPlayerSockets, setRealtimeDisconnector } from './notify.js';
import { rotatePlayerSessionEpoch } from '../_auth.js';

/*
 * The socket handshake is the only place a socket is authenticated. A ban or
 * an epoch rotation (sign out other devices, password change, recovery,
 * deletion) used to leave every open socket working (2026-11-04).
 */

test('disconnectPlayerSockets targets the canonical user room', () => {
    const rooms: string[] = [];
    setRealtimeDisconnector((room) => { rooms.push(room); });
    try {
        disconnectPlayerSockets('Kai Storm');
        disconnectPlayerSockets('');
        disconnectPlayerSockets(null);
    } finally { setRealtimeDisconnector(null); }
    assert.equal(rooms.length, 1);
    assert.match(rooms[0], /^user:kai/);
});

test('a session-epoch rotation closes that player\'s sockets', async () => {
    const rooms: string[] = [];
    setRealtimeDisconnector((room) => { rooms.push(room); });
    try {
        await rotatePlayerSessionEpoch('rotated');
        await new Promise((resolve) => setTimeout(resolve, 400));
    } finally { setRealtimeDisconnector(null); }
    assert.deepEqual(rooms, ['user:rotated']);
});

test('without a socket layer it is a no-op', () => {
    assert.doesNotThrow(() => disconnectPlayerSockets('anyone'));
});
