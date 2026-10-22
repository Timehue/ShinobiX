import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from './_storage.js';
import { DAILY_COMBAT_STAT_CAP } from './_stat-growth.js';
import { reserveCombatStatBudget } from './pvp/_combat-stat-budget.js';
import { dailyStatBudgetKey, readDailyStatBudget, reserveDailyStatPoints } from './_daily-stat-budget.js';

const DAY = Date.UTC(2026, 10, 2, 9, 0, 0);

describe('the mission-claim view of the shared daily stat-point budget', () => {
    it('reads and replays exactly the rows the combat reservation writes', async () => {
        const store = _makeMemoryKv();
        const fight = await reserveCombatStatBudget(store, { playerName: 'Rin', battleId: 'ai-fight:t1', eventAt: DAY, requested: 3, cap: DAILY_COMBAT_STAT_CAP });
        assert.equal(fight.points, 3);
        assert.equal(dailyStatBudgetKey('Rin', '2026-11-02'), 'combat-stat-count:rin:2026-11-02');
        assert.deepEqual(await readDailyStatBudget(store, 'Rin', DAY), { day: '2026-11-02', spent: 3, cap: 60 });

        const claim = await reserveDailyStatPoints(store, { playerName: 'Rin', receiptId: 'mission:2026-11-02:hunt:hunt-wild-boar:p1', eventAt: DAY, requested: 4 });
        assert.deepEqual([claim.points, claim.replayed, claim.budget.spent], [4, false, 7]);
        // The same receipt id the combat writer would see as a replay.
        const viaCombat = await reserveCombatStatBudget(store, { playerName: 'Rin', battleId: 'mission:2026-11-02:hunt:hunt-wild-boar:p1', eventAt: DAY, requested: 4, cap: DAILY_COMBAT_STAT_CAP });
        assert.deepEqual([viaCombat.points, viaCombat.replayed], [4, true]);
        // And a combat allocation looks like a replay to the claim path.
        const fightAgain = await reserveDailyStatPoints(store, { playerName: 'Rin', receiptId: 'ai-fight:t1', eventAt: DAY, requested: 3 });
        assert.deepEqual([fightAgain.points, fightAgain.replayed], [3, true]);
    });

    it('a spent budget pays 0 and writes nothing, so the allocation table never fills from claims', async () => {
        const store = _makeMemoryKv();
        await reserveCombatStatBudget(store, { playerName: 'kai', battleId: 'battle-big', eventAt: DAY, requested: 99, cap: DAILY_COMBAT_STAT_CAP });
        const key = dailyStatBudgetKey('kai', '2026-11-02');
        const before = structuredClone(await store.get(key));
        for (let i = 0; i < 200; i += 1) {
            const out = await reserveDailyStatPoints(store, { playerName: 'kai', receiptId: `mission:2026-11-02:field:fetch-d:r${i}`, eventAt: DAY, requested: 3 });
            assert.equal(out.points, 0);
        }
        assert.deepEqual(await store.get(key), before);
    });

    it('a legacy numeric row counts as spent and a new day starts fresh', async () => {
        const store = _makeMemoryKv();
        await store.set(dailyStatBudgetKey('mei', '2026-11-02'), 58);
        const out = await reserveDailyStatPoints(store, { playerName: 'mei', receiptId: 'mission:x', eventAt: DAY, requested: 4 });
        assert.deepEqual([out.points, out.budget.spent], [2, 60]);
        const tomorrow = await reserveDailyStatPoints(store, { playerName: 'mei', receiptId: 'mission:y', eventAt: DAY + 86_400_000, requested: 4 });
        assert.deepEqual([tomorrow.points, tomorrow.budget], [4, { day: '2026-11-03', spent: 4, cap: 60 }]);
    });

    it('a zero request never writes an allocation', async () => {
        const store = _makeMemoryKv();
        const out = await reserveDailyStatPoints(store, { playerName: 'zed', receiptId: 'mission:z', eventAt: DAY, requested: 0 });
        assert.deepEqual([out.points, out.budget.spent], [0, 0]);
        assert.equal(await store.get(dailyStatBudgetKey('zed', '2026-11-02')), null);
    });
});
