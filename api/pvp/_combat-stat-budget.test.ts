import { strict as assert } from 'node:assert';
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
});
