import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { _makeMemoryKv } from '../_storage.js';
import {
    activatePvpPendingSessionPointer,
    clearPvpPendingSessionPointer,
    loadPvpPendingSessionPointer,
    pendingPointersForSession,
    publishPvpPendingSessionPointer,
    pendingPointerMatchesSession,
    requirePvpPendingSessionOwnership,
} from './_pending-session.js';

const older = {
    version: 1 as const,
    playerName: 'alice',
    battleId: 'pvp-older',
    role: 'p1' as const,
    createdAt: 100,
    phase: 'active' as const,
};

describe('PvP pending-session pointer', () => {
    it('is owner scoped and permits exact same-battle refresh', async () => {
        const store = _makeMemoryKv();
        assert.deepEqual(await publishPvpPendingSessionPointer(store, older), { pointer: older, created: true });
        assert.deepEqual(await publishPvpPendingSessionPointer(store, older), { pointer: older, created: false });
        assert.deepEqual(await loadPvpPendingSessionPointer(store, 'Alice'), older);
        assert.equal(await loadPvpPendingSessionPointer(store, 'Bob'), null);
    });

    it('never lets another battle overwrite the single-flight or a stale completion delete its successor', async () => {
        const store = _makeMemoryKv();
        const newer = { ...older, battleId: 'pvp-newer', createdAt: 200 };
        await publishPvpPendingSessionPointer(store, older);
        await assert.rejects(
            publishPvpPendingSessionPointer(store, newer),
            /pending-session-conflict/,
        );
        assert.deepEqual(await loadPvpPendingSessionPointer(store, 'alice'), older);
        assert.equal(await clearPvpPendingSessionPointer(store, 'alice', older.battleId, older.createdAt), true);
        await publishPvpPendingSessionPointer(store, newer);
        assert.equal(await clearPvpPendingSessionPointer(store, 'alice', older.battleId, older.createdAt), false);
        assert.deepEqual(await loadPvpPendingSessionPointer(store, 'alice'), newer);
    });

    it('binds a stable battle capability to its exact session creation generation', async () => {
        const store = _makeMemoryKv();
        await publishPvpPendingSessionPointer(store, older);
        await assert.rejects(
            publishPvpPendingSessionPointer(store, { ...older, createdAt: older.createdAt + 1 }),
            /pending-session-conflict/,
        );
        await assert.rejects(
            activatePvpPendingSessionPointer(store, older.playerName, older.battleId, older.createdAt + 1),
            /activation-conflict/,
        );
        const matchingSession = {
            battleId: older.battleId,
            createdAt: older.createdAt,
            p1: { name: 'Alice' },
            p2: { name: 'Bob' },
            realFighters: { p1: true, p2: true },
        } as import('./session.js').PvpSession;
        assert.equal(pendingPointerMatchesSession(older, matchingSession), true);
        assert.equal(pendingPointerMatchesSession(older, {
            ...matchingSession,
            createdAt: older.createdAt + 1,
        }), false);
    });

    it('fails closed on malformed server state', async () => {
        const store = _makeMemoryKv();
        await store.set('pvp:pending-session:alice', '{bad');
        await assert.rejects(
            loadPvpPendingSessionPointer(store, 'alice'),
            /pointer-invalid/,
        );
    });

    it('renews an exact reserving capability, fences expiry, and activates exactly', async () => {
        const store = _makeMemoryKv();
        const reserving = {
            ...older,
            phase: 'reserving' as const,
            reservedUntil: 150,
        };
        await publishPvpPendingSessionPointer(store, reserving);
        const renewed = await publishPvpPendingSessionPointer(store, {
            ...reserving,
            reservedUntil: 250,
        });
        assert.equal(renewed.pointer.reservedUntil, 250);
        await requirePvpPendingSessionOwnership(store, renewed.pointer, 249);
        await assert.rejects(
            requirePvpPendingSessionOwnership(store, renewed.pointer, 250),
            /publication-ownership-lost/,
        );
        const active = await activatePvpPendingSessionPointer(store, 'alice', reserving.battleId, reserving.createdAt);
        assert.equal(active.phase, 'active');
        await requirePvpPendingSessionOwnership(store, active, 999_999);
    });

    it('does not classify an unreadable clear readback as confirmed absence', async () => {
        const base = _makeMemoryKv();
        await publishPvpPendingSessionPointer(base, older);
        let reads = 0;
        const store = {
            get: async <T>(key: string): Promise<T | null> => {
                reads += 1;
                if (reads > 1) throw new Error('readback-down');
                return base.get<T>(key);
            },
            delIfEqual: async () => { throw new Error('lost-delete-ack'); },
        };
        await assert.rejects(
            clearPvpPendingSessionPointer(store, 'alice', older.battleId, older.createdAt),
            /lost-delete-ack/,
        );
    });

    it('proves terminal TTL refresh with an immutable deadline body transition', async () => {
        const now = Date.now();
        const createdAt = now - 5_000;
        const active = { ...older, createdAt };
        const base = _makeMemoryKv();
        await publishPvpPendingSessionPointer(base, active, now);
        const terminal = {
            battleId: active.battleId,
            p1: { name: 'alice' },
            p2: { name: 'bob' },
            realFighters: { p1: true, p2: false },
            joined: { p1: true, p2: true },
            rewardAuthority: 'challenge',
            createdAt,
            endedAt: now,
            status: 'done',
        } as import('./session.js').PvpSession;
        const desired = pendingPointersForSession(terminal)[0]!;
        const originalCompareSet = base.compareSet.bind(base);
        let terminalWrites = 0;
        const store = {
            ...base,
            async compareSet(key: string, expected: unknown, next: unknown, options?: { ex?: number }) {
                if (key === 'pvp:pending-session:alice') {
                    terminalWrites += 1;
                    assert.equal(await originalCompareSet(key, expected, next, options), true);
                    throw new Error('lost terminal pointer refresh acknowledgement');
                }
                return originalCompareSet(key, expected, next, options);
            },
        };
        const recovered = await publishPvpPendingSessionPointer(store, desired, now);
        assert.equal(recovered.pointer.recoveryExpiresAt, now + 48 * 60 * 60 * 1000);
        assert.equal(terminalWrites, 1);

        // A later helper sees the deadline already embedded and must not issue
        // an identical CAS whose readback cannot prove TTL metadata changed.
        await publishPvpPendingSessionPointer(store, desired, now + 1_000);
        assert.equal(terminalWrites, 1);
    });
});
