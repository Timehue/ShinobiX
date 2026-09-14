import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { battleStateKey, type BattleStateProjection } from '../_realtime/battle-projection.js';
import { runBattleLapseSweep } from './_battle-lapse-sweep.js';
import type { LapseReconciliation } from '../_battle-lapse.js';

/*
 * F08 backstop — the sweep walks the per-player battle projections and asks
 * the owning mode to reconcile each one whose gameplay expiry has passed. It
 * never touches session rows itself and drains a backlog within a budget.
 */

const NOW = 1_800_000_000_000;

function projection(kind: BattleStateProjection['kind'], sessionId: string, expiresAt: number): BattleStateProjection {
    return { version: 1, kind, sessionId, startedAt: NOW - 3_600_000, expiresAt };
}

describe('battle lapse sweep', () => {
    it('reconciles only expired projections, attributing each to its player', async () => {
        const kv = _makeMemoryKv();
        await kv.set(battleStateKey('rill'), projection('solo-pve', 'run-1', NOW - 1));
        await kv.set(battleStateKey('mira'), projection('tower', 'tower-7', NOW + 60_000));
        await kv.set(battleStateKey('kato'), projection('pvp', 'duel-3', NOW - 60_000));
        await kv.set(battleStateKey('junk'), { not: 'a projection' });
        await kv.set('save:rill', { unrelated: true });
        const calls: Array<{ kind: string; sessionId: string; playerName: string }> = [];
        const result = await runBattleLapseSweep({
            kv,
            now: () => NOW,
            reconcile: async (lapsed, playerName): Promise<LapseReconciliation> => {
                calls.push({ ...lapsed, playerName });
                return { ...lapsed, transitioned: lapsed.kind !== 'pvp', settled: lapsed.kind === 'solo-pve' };
            },
        });
        assert.deepEqual(calls.sort((a, b) => a.sessionId.localeCompare(b.sessionId)), [
            { kind: 'pvp', sessionId: 'duel-3', playerName: 'kato' },
            { kind: 'solo-pve', sessionId: 'run-1', playerName: 'rill' },
        ]);
        assert.equal(result.scanned, 4, 'every projection row is scanned, nothing else');
        assert.equal(result.lapsed, 2);
        assert.equal(result.transitioned, 1);
        assert.equal(result.settled, 1);
        assert.deepEqual(result.errors, []);
        assert.equal(result.truncated, false);
    });

    it('drains a backlog within its budget and reports the truncation', async () => {
        const kv = _makeMemoryKv();
        for (let i = 0; i < 5; i += 1) await kv.set(battleStateKey(`p${i}`), projection('solo-pve', `run-${i}`, NOW - 1));
        let calls = 0;
        const result = await runBattleLapseSweep({
            kv, now: () => NOW, budget: 3,
            reconcile: async (lapsed) => { calls += 1; return { ...lapsed, transitioned: true, settled: true }; },
        });
        assert.equal(calls, 3);
        assert.equal(result.truncated, true);
    });

    it('a reconciler failure is reported, never thrown, and never stops the pass', async () => {
        const kv = _makeMemoryKv();
        await kv.set(battleStateKey('a'), projection('solo-pve', 'run-a', NOW - 1));
        await kv.set(battleStateKey('b'), projection('solo-pve', 'run-b', NOW - 1));
        const result = await runBattleLapseSweep({
            kv, now: () => NOW,
            reconcile: async (lapsed) => {
                if (lapsed.sessionId === 'run-a') throw new Error('store-down');
                return { ...lapsed, transitioned: true, settled: false, error: 'in-flight' };
            },
        });
        assert.equal(result.lapsed, 2);
        assert.equal(result.transitioned, 1);
        assert.deepEqual(result.errors, ['solo-pve:run-a: store-down'], 'an in-flight duplicate is not an error');
    });
});
