import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { onlineStore } from './online-store.js';
import { presenceBroadcastSignature } from './presence-input.js';
import {
    PRESENCE_BATCHED_ROOM,
    PRESENCE_LEGACY_ROOM,
    __presenceBroadcastStateForTest,
    announcePresenceLeave,
    flushPresenceUpdates,
    queuePresenceUpdate,
    registerPresenceClient,
    setPresenceBroadcastIo,
} from './presence-broadcast.js';
import type { OnlinePlayer } from './types.js';

type Emit = { room: string; except: string | null; event: string; payload: Record<string, unknown> };

function fakeIo() {
    const emits: Emit[] = [];
    const target = {
        to(room: string) {
            const op = {
                except: (except: string) => ({ emit: (event: string, payload: Record<string, unknown>) => { emits.push({ room, except, event, payload }); return true; } }),
                emit: (event: string, payload: Record<string, unknown>) => { emits.push({ room, except: null, event, payload }); return true; },
            };
            return op;
        },
    };
    return { emits, io: target as unknown as Parameters<typeof setPresenceBroadcastIo>[0] };
}

function fakeSocket() {
    const rooms: string[] = [];
    const handlers = new Map<string, () => void>();
    return {
        rooms,
        disconnect: () => handlers.get('disconnect')?.(),
        socket: { join: (room: string) => { rooms.push(room); }, on: (event: string, fn: () => void) => { handlers.set(event, fn); } } as never,
    };
}

const PLAYERS = ['batch-alpha', 'batch-beta'];

describe('batched sector presence broadcasts', () => {
    let env: ReturnType<typeof fakeIo>;
    beforeEach(() => {
        env = fakeIo();
        setPresenceBroadcastIo(env.io);
    });
    afterEach(() => {
        setPresenceBroadcastIo(null);
        for (const name of PLAYERS) onlineStore.remove(name);
    });

    it('collapses a burst into one frame per sector with each player\'s current record', () => {
        onlineStore.upsert({ name: 'batch-alpha', sector: 12, character: { name: 'batch-alpha', level: 3 } });
        onlineStore.upsert({ name: 'batch-beta', sector: 12, character: { name: 'batch-beta', level: 5 } });
        queuePresenceUpdate('batch-alpha', 12);
        queuePresenceUpdate('Batch-Alpha', 12);
        queuePresenceUpdate('batch-beta', 12);
        onlineStore.upsert({ name: 'batch-alpha', sector: 12, character: { name: 'batch-alpha', level: 4 } });
        flushPresenceUpdates();

        assert.equal(env.emits.length, 1, 'one frame for the sector, not one per change');
        const [frame] = env.emits;
        assert.deepEqual([frame.room, frame.except, frame.event], ['sector:12', PRESENCE_LEGACY_ROOM, 'presence:updates']);
        const players = frame.payload.players as Array<{ name: string; level: number }>;
        assert.deepEqual(players.map((p) => p.name).sort(), ['batch-alpha', 'batch-beta']);
        assert.equal(players.find((p) => p.name === 'batch-alpha')?.level, 4, 'the flush reads the latest state');
        assert.equal(__presenceBroadcastStateForTest().pending.size, 0);
    });

    it('skips a player who left the sector or went offline before the flush (no ghost)', () => {
        onlineStore.upsert({ name: 'batch-alpha', sector: 0, character: null });
        queuePresenceUpdate('batch-alpha', 12);
        queuePresenceUpdate('batch-beta', 12);
        flushPresenceUpdates();
        assert.equal(env.emits.length, 0);
    });

    it('sends per-player frames only while an older client is connected', () => {
        const batched = fakeSocket();
        const legacy = fakeSocket();
        registerPresenceClient(batched.socket, true);
        registerPresenceClient(legacy.socket, false);
        assert.deepEqual([batched.rooms, legacy.rooms], [[PRESENCE_BATCHED_ROOM], [PRESENCE_LEGACY_ROOM]]);

        onlineStore.upsert({ name: 'batch-alpha', sector: 7, character: null });
        queuePresenceUpdate('batch-alpha', 7);
        flushPresenceUpdates();
        assert.deepEqual(env.emits.map((e) => [e.event, e.except]), [
            ['presence:updates', PRESENCE_LEGACY_ROOM],
            ['presence:update', PRESENCE_BATCHED_ROOM],
        ]);

        legacy.disconnect();
        assert.equal(__presenceBroadcastStateForTest().legacyClients, 0);
        env.emits.length = 0;
        queuePresenceUpdate('batch-alpha', 7);
        flushPresenceUpdates();
        assert.deepEqual(env.emits.map((e) => e.event), ['presence:updates']);
    });

    it('announces an HTTP-driven departure immediately to the old sector', () => {
        announcePresenceLeave('Batch-Alpha', 12);
        assert.deepEqual(env.emits, [{ room: 'sector:12', except: null, event: 'presence:leave', payload: { sector: 12, names: ['batch-alpha'] } }]);
    });

    it('does nothing without a socket server', () => {
        setPresenceBroadcastIo(null);
        queuePresenceUpdate('batch-alpha', 12);
        assert.equal(__presenceBroadcastStateForTest().pending.size, 0);
    });
});

describe('what counts as a visible presence change', () => {
    const base: OnlinePlayer = {
        name: 'rill', displayName: 'Rill', sector: 12, lastSeenAt: 1, connectedAt: 1, pendingAttacker: null,
        character: { name: 'Rill', level: 9, village: 'Stormveil Village', clan: 'Ash', specialty: 'Taijutsu', hp: 40, maxHp: 100, chakra: 10 },
        tile: 3,
    };
    const sig = presenceBroadcastSignature;

    it('ignores HP/chakra regen ticks, heartbeats and tile moves, which peers never receive in this frame', () => {
        assert.equal(sig({ ...base, character: { ...base.character, hp: 41, chakra: 11 } }), sig(base));
        assert.equal(sig({ ...base, lastSeenAt: 99 }), sig(base));
        assert.equal(sig({ ...base, tile: 8 }), sig(base));
    });

    it('changes for battle, travel, level, village, clan, specialty and display name', () => {
        for (const changed of [
            { ...base, inBattle: true },
            { ...base, travelingUntil: 5_000 },
            { ...base, displayName: 'RILL' },
            { ...base, character: { ...base.character, level: 10 } },
            { ...base, character: { ...base.character, village: 'Frostfang Village' } },
            { ...base, character: { ...base.character, clan: 'Oak' } },
            { ...base, character: { ...base.character, specialty: 'Ninjutsu' } },
        ]) assert.notEqual(sig(changed), sig(base));
        assert.equal(sig(null), '');
    });
});
