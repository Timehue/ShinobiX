import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { onlineStore } from './online-store.js';
import { flushPresenceUpdates, setPresenceBroadcastIo } from './presence-broadcast.js';
import { noteBattleEnded, noteBattleStarted } from './battle-projection.js';
import { leaveStrongholdPresence, touchStrongholdPresence } from '../_stronghold-presence.js';

// Socket clients take a full sector roster only now and then, so changes that
// happen inside the store must be pushed where they happen. Each case below
// used to reach sector-mates only through that roster.

type Emit = { room: string; event: string; payload: Record<string, unknown> };

function fakeIo() {
    const emits: Emit[] = [];
    const target = {
        to(room: string) {
            const emit = (event: string, payload: Record<string, unknown>) => { emits.push({ room, event, payload }); return true; };
            return { except: () => ({ emit }), emit };
        },
    };
    return { emits, io: target as unknown as Parameters<typeof setPresenceBroadcastIo>[0] };
}

const NAMES = ['store-fighter', 'store-traveler', 'store-kicked', 'store-infiltrator', 'store-returner'];

function updatesIn(emits: Emit[], room: string) {
    return emits.filter((e) => e.room === room && e.event === 'presence:updates')
        .flatMap((e) => e.payload.players as Array<Record<string, unknown>>);
}
function leavesIn(emits: Emit[], room: string) {
    return emits.filter((e) => e.room === room && e.event === 'presence:leave').flatMap((e) => e.payload.names as string[]);
}

describe('store-side presence changes reach sector-mates', () => {
    let env: ReturnType<typeof fakeIo>;
    beforeEach(() => {
        env = fakeIo();
        setPresenceBroadcastIo(env.io);
    });
    afterEach(() => {
        setPresenceBroadcastIo(null);
        for (const name of NAMES) {
            onlineStore.remove(name);
            leaveStrongholdPresence(name);
        }
    });

    it('a fight starting and ending is pushed, so peers never see a stale Ready or Fighting', () => {
        onlineStore.upsert({ name: 'store-fighter', sector: 20, character: { name: 'store-fighter', level: 9 } });
        noteBattleStarted('store-fighter');
        flushPresenceUpdates();
        assert.deepEqual(updatesIn(env.emits, 'sector:20').map((p) => [p.name, p.inBattle]), [['store-fighter', true]]);
        env.emits.length = 0;
        noteBattleEnded('store-fighter');
        flushPresenceUpdates();
        assert.deepEqual(updatesIn(env.emits, 'sector:20').map((p) => [p.name, p.inBattle]), [['store-fighter', false]]);
    });

    it('a trip that matures on a plain read leaves the origin at once and arrives on the next flush', async () => {
        // No socket involved: a socket-less player's beat reads the store and the
        // trip settles there. Nothing announced this move before.
        onlineStore.upsert({ name: 'store-traveler', sector: 12, character: { name: 'store-traveler', level: 4 } });
        assert.ok(onlineStore.startTravel('store-traveler', 13, Date.now() + 30));
        await delay(40);
        assert.equal(onlineStore.get('store-traveler')?.sector, 13);
        assert.deepEqual(leavesIn(env.emits, 'sector:12'), ['store-traveler'], 'the leave is immediate');
        flushPresenceUpdates();
        assert.deepEqual(updatesIn(env.emits, 'sector:13').map((p) => p.name), ['store-traveler']);
        assert.deepEqual(updatesIn(env.emits, 'sector:12'), [], 'never re-added to the origin');
    });

    it('an admin kick or ban clears the player from the sector', () => {
        onlineStore.upsert({ name: 'store-kicked', sector: 31, character: null });
        onlineStore.remove('store-kicked');
        assert.deepEqual(leavesIn(env.emits, 'sector:31'), ['store-kicked']);
    });

    it('a restored boot row whose owner comes back elsewhere leaves the snapshot sector', () => {
        const store = onlineStore as unknown as { restore: (rows: unknown[]) => number };
        const now = Date.now();
        store.restore([{ name: 'store-returner', displayName: 'store-returner', sector: 12, lastSeenAt: now, connectedAt: now }]);
        onlineStore.upsert({ name: 'store-returner', sector: 18, character: { name: 'store-returner', level: 2 } });
        assert.deepEqual(leavesIn(env.emits, 'sector:12'), ['store-returner']);
        flushPresenceUpdates();
        assert.deepEqual(updatesIn(env.emits, 'sector:18').map((p) => p.name), ['store-returner']);
    });

    it('entering and leaving a stronghold is pushed; walking inside it is not', () => {
        onlineStore.upsert({ name: 'store-infiltrator', sector: 44, character: { name: 'store-infiltrator', level: 100 } });
        touchStrongholdPresence('store-infiltrator', 44, 5);
        flushPresenceUpdates();
        assert.deepEqual(updatesIn(env.emits, 'sector:44').map((p) => [p.name, p.stronghold]), [['store-infiltrator', { sector: 44, tile: 5 }]]);
        env.emits.length = 0;
        touchStrongholdPresence('store-infiltrator', 44, 6);
        flushPresenceUpdates();
        assert.deepEqual(env.emits, [], 'a step inside is the stronghold poll\'s business');
        leaveStrongholdPresence('store-infiltrator');
        flushPresenceUpdates();
        assert.deepEqual(updatesIn(env.emits, 'sector:44').map((p) => [p.name, p.stronghold]), [['store-infiltrator', undefined]]);
    });

    it('with realtime detached, store changes are silent', () => {
        setPresenceBroadcastIo(null);
        onlineStore.upsert({ name: 'store-fighter', sector: 20, character: null });
        noteBattleStarted('store-fighter');
        onlineStore.remove('store-fighter');
        touchStrongholdPresence('store-infiltrator', 44, 5);
        flushPresenceUpdates();
        assert.deepEqual(env.emits, []);
    });
});
