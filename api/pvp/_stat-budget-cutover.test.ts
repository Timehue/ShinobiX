import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { readDailyPvpStatBudget, readDailyStatBudget, reserveDailyStatPoints } from '../_daily-stat-budget.js';
import { STAT_BUDGET_SPLIT_DAY } from '../_stat-budget-cutover.js';
import { reservePvpCombatStatBudget } from './_combat-stat-budget.js';

const boundary = Date.parse(`${STAT_BUDGET_SPLIT_DAY}T00:00:00Z`);
const before = boundary - 1;
const oldDay = new Date(before).toISOString().slice(0, 10);
const oldKey = `combat-stat-count:rin:${oldDay}`;
const hash = (id: string) => createHash('sha256').update(id).digest('hex');
const allocation = (battleId: string, points: number) => ({ version: 1 as const, battleId, points });
async function seedOld(store: ReturnType<typeof _makeMemoryKv>, points = 48) {
    const allocations = Object.fromEntries(Array.from({ length: points / 6 }, (_, i) => {
        const id = `old-pvp-${i}`;
        return [hash(id), allocation(id, 6)];
    }));
    await store.set(oldKey, { version: 1, day: oldDay, spent: points, allocations });
}
const pvp = (store: Parameters<typeof reservePvpCombatStatBudget>[0], battleId: string, eventAt = before) =>
    reservePvpCombatStatBudget(store, { playerName: 'rin', battleId, eventAt, requested: 6, cap: 50 });

test('old-key PvP earnings cannot acquire a fresh allowance before cutover', async () => {
    const store = _makeMemoryKv();
    await seedOld(store);
    assert.deepEqual(await readDailyPvpStatBudget(store, 'rin', before), { day: oldDay, spent: 48, cap: 60 });
    assert.equal((await pvp(store, 'new-1')).points, 6);
    assert.equal((await pvp(store, 'new-2')).points, 6);
    assert.equal((await pvp(store, 'new-3')).points, 0);
    assert.equal(await store.get(`pvp-stat-count:rin:${oldDay}`), null);
    assert.equal((await reserveDailyStatPoints(store, { playerName: 'rin', receiptId: 'mission:late', eventAt: before, requested: 3 })).points, 0);
});

test('crash after old reservation before save replays the original allocation even after UTC cutover', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: boundary + 60_000 });
    const store = _makeMemoryKv();
    await seedOld(store);
    const original = await store.get(oldKey);
    const replay = await reservePvpCombatStatBudget(store, { playerName: 'rin', battleId: 'old-pvp-0', eventAt: before, requested: 1, cap: 50 });
    assert.deepEqual(replay, { points: 6, replayed: true, day: oldDay });
    assert.deepEqual(await store.get(oldKey), original);
    assert.equal(await store.get(`pvp-stat-count:rin:${STAT_BUDGET_SPLIT_DAY}`), null);
});

test('old numeric counters and mission spend remain shared and bounded before cutover', async () => {
    const store = _makeMemoryKv();
    await store.set(oldKey, 59);
    assert.equal((await pvp(store, 'numeric')).points, 1);
    assert.equal((await pvp(store, 'numeric-again')).points, 0);
    assert.deepEqual(await readDailyStatBudget(store, 'rin', before), { day: oldDay, spent: 60, cap: 60 });
});

test('an old worker racing a new reservation uses the same CAS row without losing either receipt', async () => {
    const store = _makeMemoryKv();
    await seedOld(store);
    let raced = false;
    const mixed = {
        get: store.get.bind(store),
        compareSet: async (...args: Parameters<typeof store.compareSet>) => {
            if (!raced) {
                raced = true;
                assert.equal(args[0], oldKey);
                const raw = await store.get<any>(oldKey);
                const oldWorker = { ...raw, spent: raw.spent + 6, allocations: { ...raw.allocations, [hash('old-racing')]: allocation('old-racing', 6) } };
                assert.equal(await store.compareSet(oldKey, raw, oldWorker, { ex: 72 * 3600 }), true);
            }
            return store.compareSet(...args);
        },
    };
    assert.equal((await pvp(mixed, 'new-racing')).points, 6);
    const row = await store.get<any>(oldKey);
    assert.equal(row.spent, 60);
    assert.equal(row.allocations[hash('old-racing')].points, 6);
    assert.equal(row.allocations[hash('new-racing')].points, 6);
    assert.equal((await pvp(store, 'after-race')).points, 0);
});

test('lost acknowledgement and same-battle concurrency preserve old-day idempotency', async () => {
    const store = _makeMemoryKv();
    await seedOld(store, 54);
    const lossy = { get: store.get.bind(store), compareSet: async (...args: Parameters<typeof store.compareSet>) => {
        const committed = await store.compareSet(...args);
        if (committed) throw new Error('lost ack');
        return committed;
    } };
    assert.equal((await pvp(lossy, 'same')).points, 6);
    const replies = await Promise.all([pvp(store, 'same'), pvp(store, 'same')]);
    assert.ok(replies.every(reply => reply.replayed && reply.points === 6));
    assert.equal((await store.get<any>(oldKey)).spent, 60);
});

test('the boundary opens independent 120 PvE and 50 PvP budgets without changing old receipts', async () => {
    const store = _makeMemoryKv();
    await seedOld(store, 60);
    const original = await store.get(oldKey);
    const mission = await reserveDailyStatPoints(store, { playerName: 'rin', receiptId: 'mission:new-day', eventAt: boundary, requested: 120 });
    assert.equal(mission.points, 120);
    let pvpTotal = 0;
    for (let i = 0; i < 10; i++) pvpTotal += (await pvp(store, `new-day-${i}`, boundary)).points;
    assert.equal(pvpTotal, 50);
    assert.deepEqual(await readDailyPvpStatBudget(store, 'rin', boundary), { day: STAT_BUDGET_SPLIT_DAY, spent: 50, cap: 50 });
    assert.deepEqual(await readDailyStatBudget(store, 'rin', boundary), { day: STAT_BUDGET_SPLIT_DAY, spent: 120, cap: 120 });
    assert.deepEqual(await store.get(oldKey), original);
    assert.equal((await pvp(store, 'old-pvp-0', before)).replayed, true);
});
