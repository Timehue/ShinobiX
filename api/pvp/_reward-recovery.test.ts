import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import type { PvpSession } from './session.js';
import {
    ensurePvpTerminalRecoveryPublication,
    loadPvpRewardRecoverySnapshot,
    sealPvpRewardRecoverySnapshot,
} from './_reward-recovery.js';
import { loadPvpPendingSessionPointer } from './_pending-session.js';

function terminal(battleId: string): PvpSession {
    const now = Date.now();
    return {
        battleId,
        p1: { name: 'winner' },
        p2: { name: 'loser' },
        status: 'done',
        winner: 'p1',
        joined: { p1: true, p2: true },
        realFighters: { p1: true, p2: true },
        log: [],
        createdAt: now - 100,
        endedAt: now,
    } as unknown as PvpSession;
}

describe('PvP reward recovery snapshot', () => {
    it('seals one canonical session and reloads it after the live row is deleted', async () => {
        const store = _makeMemoryKv();
        const session = terminal('pvp-recovery-one');
        await store.set(`pvp:${session.battleId}`, session);
        const sealed = await sealPvpRewardRecoverySnapshot(store, session.battleId, session);
        await store.del(`pvp:${session.battleId}`);
        assert.deepEqual(await loadPvpRewardRecoverySnapshot(store, session.battleId), sealed);
    });

    it('accepts a canonical JSON replay but rejects a conflicting terminal row', async () => {
        const store = _makeMemoryKv();
        const session = { ...terminal('pvp-recovery-two'), recentMoveTokens: undefined } as PvpSession;
        await sealPvpRewardRecoverySnapshot(store, session.battleId, session);
        await sealPvpRewardRecoverySnapshot(store, session.battleId, JSON.parse(JSON.stringify(session)) as PvpSession);
        await assert.rejects(
            sealPvpRewardRecoverySnapshot(store, session.battleId, { ...session, winner: 'p2' }),
            /snapshot-conflict/,
        );
    });

    it('fails closed on a malformed server-owned snapshot', async () => {
        const store = _makeMemoryKv();
        await store.set('pvp:reward-recovery:pvp-bad', { version: 1, battleId: 'pvp-bad' });
        await assert.rejects(
            loadPvpRewardRecoverySnapshot(store, 'pvp-bad'),
            /snapshot-invalid/,
        );
    });

    it('requires the snapshot and both discovery pointers, then never resurrects a completed actor', async () => {
        const store = _makeMemoryKv();
        const session = terminal('pvp-recovery-publication');
        await ensurePvpTerminalRecoveryPublication(store, session.battleId, session);
        assert.equal((await loadPvpPendingSessionPointer(store, 'winner'))?.battleId, session.battleId);
        assert.equal((await loadPvpPendingSessionPointer(store, 'loser'))?.battleId, session.battleId);

        await store.set(`pvp:rewarded:winner:${session.battleId}`, {
            version: 2,
            outcome: 'win',
            claimedAt: Date.now(),
            completionState: 'completed',
            completedAt: Date.now(),
            serverCreditsState: 'completed',
            serverCreditsCompletedAt: Date.now(),
        });
        await ensurePvpTerminalRecoveryPublication(store, session.battleId, session);
        assert.equal(await loadPvpPendingSessionPointer(store, 'winner'), null);
        assert.equal((await loadPvpPendingSessionPointer(store, 'loser'))?.battleId, session.battleId);
    });

    it('propagates a precommit publication outage and converges on retry', async () => {
        const base = _makeMemoryKv();
        const session = terminal('pvp-recovery-retry');
        let failed = false;
        const store = {
            get: base.get.bind(base),
            delIfEqual: base.delIfEqual.bind(base),
            compareSet: async (...args: Parameters<typeof base.compareSet>) => {
                if (!failed && args[0] === `pvp:reward-recovery:${session.battleId}`) {
                    failed = true;
                    throw new Error('snapshot-write-down');
                }
                return base.compareSet(...args);
            },
        };
        await assert.rejects(
            ensurePvpTerminalRecoveryPublication(store, session.battleId, session),
            /snapshot-write-down/,
        );
        await ensurePvpTerminalRecoveryPublication(base, session.battleId, session);
        assert.equal((await loadPvpPendingSessionPointer(base, 'winner'))?.battleId, session.battleId);
    });

    it('migrates a canonical v1 snapshot and seals one absolute terminal deadline without extending it', async () => {
        const store = _makeMemoryKv();
        const session = terminal('pvp-recovery-deadline');
        const key = `pvp:reward-recovery:${session.battleId}`;
        await store.set(key, { version: 1, battleId: session.battleId, session });
        await sealPvpRewardRecoverySnapshot(store, session.battleId, session);
        const first = await store.get<Record<string, unknown>>(key);
        const expectedDeadline = Number(session.endedAt) + 48 * 60 * 60 * 1_000;
        assert.equal(first?.version, 2);
        assert.equal(first?.expiresAt, expectedDeadline);

        await sealPvpRewardRecoverySnapshot(store, session.battleId, session);
        const replay = await store.get<Record<string, unknown>>(key);
        assert.deepEqual(replay, first);
    });
});
