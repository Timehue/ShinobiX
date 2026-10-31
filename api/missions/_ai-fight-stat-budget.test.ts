import assert from 'node:assert/strict';
import { test } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { DAILY_COMBAT_STAT_CAP } from '../_stat-growth.js';
import { readDailyStatBudget } from '../_daily-stat-budget.js';
import { reserveCombatStatBudget } from '../pvp/_combat-stat-budget.js';
import { aiFightStatPointsForWin } from './_ai-fight-reward.js';

test('zero rolls stay zero on retry, paying rolls reserve once, and the last win cannot exceed 120', async () => {
    const playerName = 'statrollbudget';
    const eventAt = Date.UTC(2026, 10, 2, 12);
    const store = _makeMemoryKv();
    const tokens = new Map<number, string>();
    for (let i = 0; tokens.size < 4 && i < 1000; i++) {
        const token = `statroll${i}`;
        tokens.set(aiFightStatPointsForWin(playerName, token), token);
    }
    assert.equal(tokens.size, 4);
    const reserve = (token: string) => reserveCombatStatBudget(store, {
        playerName, battleId: `ai-fight:${token}`, eventAt,
        requested: aiFightStatPointsForWin(playerName, token), cap: DAILY_COMBAT_STAT_CAP,
    });
    const zero = tokens.get(0)!;
    assert.equal((await reserve(zero)).points, 0);
    assert.equal((await reserve(zero)).points, 0, 'a zero has no budget allocation but cannot reroll');
    assert.equal((await readDailyStatBudget(store, playerName, eventAt)).spent, 0);
    const three = tokens.get(3)!;
    const concurrent = await Promise.all([reserve(three), reserve(three)]);
    assert.deepEqual(concurrent.map(result => result.points), [3, 3]);
    assert.equal(concurrent.filter(result => result.replayed).length, 1);
    assert.equal((await readDailyStatBudget(store, playerName, eventAt)).spent, 3);
    await reserveCombatStatBudget(store, { playerName, battleId: 'earlier-activities', eventAt, requested: 116, cap: DAILY_COMBAT_STAT_CAP });
    const last = await reserve(tokens.get(2)!);
    assert.equal(last.points, 1, 'a roll of 2 pays only the remaining point');
    assert.equal((await reserve(tokens.get(1)!)).points, 0, 'a spent budget pays nothing');
    assert.equal((await reserve(zero)).points, 0);
    assert.equal((await readDailyStatBudget(store, playerName, eventAt)).spent, 120);
});
