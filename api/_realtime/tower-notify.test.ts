import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
    kickTowerPlayers,
    setRealtimeEmitter,
    TOWER_RECONNECT_KICK,
} from './notify.js';

afterEach(() => setRealtimeEmitter(null));

describe('Tower authenticated realtime revision kicks', () => {
    it('targets only canonical per-player rooms, deduplicates tabs/names, and carries no private state', () => {
        const emitted: Array<{ room: string; event: string; payload: unknown }> = [];
        setRealtimeEmitter((room, event, payload) => emitted.push({ room, event, payload }));
        const payload = {
            channel: 'party' as const,
            reason: 'changed' as const,
            partyId: `tparty-${'a'.repeat(32)}`,
            version: 7,
        };
        kickTowerPlayers(['Alice', 'alice', null, '', 'Bob The Ninja'], payload);
        assert.deepEqual(emitted, [
            { room: 'user:alice', event: 'tower:kick', payload },
            { room: 'user:bobtheninja', event: 'tower:kick', payload },
        ]);
        const wire = JSON.stringify(emitted);
        for (const forbidden of ['inviteCode', 'members', 'actors', 'session', 'character', 'password', 'token']) {
            assert.equal(wire.includes(forbidden), false, `${forbidden} must never enter the push hint`);
        }
    });

    it('is best-effort and remains a no-op without an attached socket server', () => {
        assert.doesNotThrow(() => kickTowerPlayers(['alice'], {
            channel: 'session', reason: 'action', runId: 'tower-run', actionVersion: 3,
        }));

        const reached: string[] = [];
        setRealtimeEmitter((room) => {
            if (room === 'user:alice') throw new Error('socket adapter unavailable');
            reached.push(room);
        });
        assert.doesNotThrow(() => kickTowerPlayers(['alice', 'bob'], {
            channel: 'session', reason: 'settled', runId: 'tower-run', actionVersion: 4,
        }));
        assert.deepEqual(reached, ['user:bob']);
    });

    it('defines a content-free reconnect reconcile contract', () => {
        assert.deepEqual(TOWER_RECONNECT_KICK, { channel: 'reconcile', reason: 'socket-connected' });
        assert.equal(Object.isFrozen(TOWER_RECONNECT_KICK), true);
        const socket = readFileSync(resolve(process.cwd(), 'api/_realtime/socket.ts'), 'utf8');
        const auth = socket.indexOf("io.use(async (socket, next) =>");
        const connected = socket.indexOf("io.on('connection'");
        const userRoom = socket.indexOf("socket.join(`user:${name}`)", connected);
        const reconcile = socket.indexOf("socket.emit('tower:kick', TOWER_RECONNECT_KICK)", connected);
        assert.ok(auth >= 0 && auth < connected, 'HTTP-equivalent auth gates the connection handler');
        assert.ok(connected < userRoom && userRoom < reconcile, 'reconcile emits only after the authenticated user room is joined');
    });
});
