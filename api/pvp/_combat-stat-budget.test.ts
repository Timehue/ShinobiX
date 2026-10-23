import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { reservePvpCombatStatBudget } from './_combat-stat-budget.js';

const EVENT = Date.UTC(2026, 7, 15, 23, 59);

describe('PvP event-time combat-stat budget', () => {
    it('allocates under the event UTC day and replays without spending twice', async () => {
        const store = _makeMemoryKv();
        const first = await reservePvpCombatStatBudget(store, {
            playerName: 'Winner', battleId: 'battle-a', eventAt: EVENT, requested: 3, cap: 5,
        });
        const replay = await reservePvpCombatStatBudget(store, {
            playerName: 'Winner', battleId: 'battle-a', eventAt: EVENT, requested: 3, cap: 5,
        });
        const second = await reservePvpCombatStatBudget(store, {
            playerName: 'Winner', battleId: 'battle-b', eventAt: EVENT, requested: 3, cap: 5,
        });
        assert.deepEqual(first, { points: 3, replayed: false, day: '2026-08-15' });
        assert.deepEqual(replay, { points: 3, replayed: true, day: '2026-08-15' });
        assert.equal(second.points, 2);
    });

    it('recovers a lost CAS acknowledgement exactly and fails closed on malformed state', async () => {
        const base = _makeMemoryKv();
        const store = {
            get: base.get.bind(base),
            compareSet: async (...args: Parameters<typeof base.compareSet>) => {
                const committed = await base.compareSet(...args);
                if (committed) throw new Error('lost-ack');
                return committed;
            },
        };
        const result = await reservePvpCombatStatBudget(store, {
            playerName: 'Winner', battleId: 'battle-a', eventAt: EVENT, requested: 3, cap: 5,
        });
        assert.equal(result.points, 3);
        await base.set('combat-stat-count:winner:2026-08-16', { version: 1, day: '2026-08-16', spent: 99, allocations: {} });
        await assert.rejects(reservePvpCombatStatBudget(base, {
            playerName: 'Winner', battleId: 'battle-b', eventAt: EVENT + 60_000, requested: 3, cap: 5,
        }), /budget-invalid/);
    });

    it('migrates the bounded legacy numeric counter without reopening spent points', async () => {
        const store = _makeMemoryKv();
        await store.set('combat-stat-count:winner:2026-08-15', 4);
        const result = await reservePvpCombatStatBudget(store, {
            playerName: 'Winner', battleId: 'battle-migrate', eventAt: EVENT, requested: 3, cap: 5,
        });
        assert.equal(result.points, 1);
        const row = await store.get<Record<string, unknown>>('combat-stat-count:winner:2026-08-15');
        assert.equal(row?.version, 1);
        assert.equal(row?.spent, 5);
        assert.equal(row?.legacySpent, 4);
        assert.deepEqual(await reservePvpCombatStatBudget(store, {
            playerName: 'Winner', battleId: 'battle-migrate', eventAt: EVENT, requested: 3, cap: 5,
        }), { points: 1, replayed: true, day: '2026-08-15' });
        assert.equal((await reservePvpCombatStatBudget(store, {
            playerName: 'Winner', battleId: 'battle-after-migrate', eventAt: EVENT, requested: 3, cap: 5,
        })).points, 0);
    });

    // The cap is the DAILY_STAT_POINT_CAP dial, and hunt/field claims share the
    // row, so neither a lowered cap nor a long day may fail a fight's reward.
    it('a row spent past a lowered cap grants 0 instead of failing every reservation', async () => {
        const store = _makeMemoryKv();
        await store.set('combat-stat-count:winner:2026-08-15', { version: 1, day: '2026-08-15', spent: 70, legacySpent: 70, allocations: {} });
        assert.deepEqual(await reservePvpCombatStatBudget(store, {
            playerName: 'Winner', battleId: 'battle-lowered', eventAt: EVENT, requested: 6, cap: 60,
        }), { points: 0, replayed: false, day: '2026-08-15' });
    });

    it('a full allocation table on a spent budget still settles the next battle at 0', async () => {
        const store = _makeMemoryKv();
        const allocations: Record<string, unknown> = {};
        for (let i = 0; i < 128; i += 1) {
            const battleId = `old-${i}`;
            allocations[createHash('sha256').update(battleId).digest('hex')] = { version: 1, battleId, points: 0 };
        }
        await store.set('combat-stat-count:winner:2026-08-15', { version: 1, day: '2026-08-15', spent: 60, legacySpent: 60, allocations });
        assert.deepEqual(await reservePvpCombatStatBudget(store, {
            playerName: 'Winner', battleId: 'battle-129', eventAt: EVENT, requested: 3, cap: 60,
        }), { points: 0, replayed: false, day: '2026-08-15' });
    });
});
