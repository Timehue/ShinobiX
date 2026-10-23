import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeLoginReward,
    dailyLoginRyo,
    daysUntilShardBonus,
    loginShardsForClaimDay,
    LOGIN_RYO_CAP,
    STREAK_EARLY_SHARD_DAYS,
    STREAK_EARLY_SHARD_REWARD,
    STREAK_SHARD_REWARD,
} from './_daily-login.js';

test('dailyLoginRyo is modest, level-scaled, and capped', () => {
    assert.equal(dailyLoginRyo(1), 600);
    assert.equal(dailyLoginRyo(5), 1000);
    assert.equal(dailyLoginRyo(50), 5500);
    assert.equal(dailyLoginRyo(75), LOGIN_RYO_CAP); // 500 + 100*75 = 8000
    assert.equal(dailyLoginRyo(100), LOGIN_RYO_CAP); // capped
    assert.equal(dailyLoginRyo(0), 600); // floor of level 1
});

test('first-ever claim starts a streak of 1 with no shards', () => {
    const r = computeLoginReward({ lastDate: '', prevStreak: 0, level: 5, today: '2026-06-23', yesterday: '2026-06-22' });
    assert.equal(r.alreadyClaimed, false);
    assert.equal(r.streak, 1);
    assert.equal(r.ryo, 1000);
    assert.equal(r.fateShards, 0);
});

test('consecutive day extends the streak', () => {
    const r = computeLoginReward({ lastDate: '2026-06-22', prevStreak: 3, level: 10, today: '2026-06-23', yesterday: '2026-06-22' });
    assert.equal(r.streak, 4);
    assert.equal(r.alreadyClaimed, false);
});

test('a gap keeps counting claim days (the streak never resets)', () => {
    const r = computeLoginReward({ lastDate: '2026-06-20', prevStreak: 6, level: 10, today: '2026-06-23', yesterday: '2026-06-22' });
    assert.equal(r.streak, 7);
    assert.equal(r.fateShards, STREAK_SHARD_REWARD);
    const early = computeLoginReward({ lastDate: '2026-05-01', prevStreak: 1, level: 10, today: '2026-06-23', yesterday: '2026-06-22' });
    assert.equal(early.streak, 2);
    assert.equal(early.fateShards, STREAK_EARLY_SHARD_REWARD, 'a return weeks later still pays claim day 2');
});

test('every 7th claim day grants 5 fate shards', () => {
    const day7 = computeLoginReward({ lastDate: '2026-06-22', prevStreak: 6, level: 10, today: '2026-06-23', yesterday: '2026-06-22' });
    assert.equal(day7.streak, 7);
    assert.equal(day7.fateShards, STREAK_SHARD_REWARD);
    const day8 = computeLoginReward({ lastDate: '2026-06-23', prevStreak: 7, level: 10, today: '2026-06-24', yesterday: '2026-06-23' });
    assert.equal(day8.streak, 8);
    assert.equal(day8.fateShards, 0);
    const day14 = computeLoginReward({ lastDate: '2026-06-29', prevStreak: 13, level: 10, today: '2026-06-30', yesterday: '2026-06-29' });
    assert.equal(day14.fateShards, STREAK_SHARD_REWARD);
});

test('claim days 2 and 3 add the early return bonus, once each', () => {
    assert.deepEqual([...STREAK_EARLY_SHARD_DAYS], [2, 3]);
    assert.equal(STREAK_EARLY_SHARD_REWARD, 2);
    const paid = [1, 2, 3, 4, 5, 6, 7, 8, 14, 21].map((day) => loginShardsForClaimDay(day));
    assert.deepEqual(paid, [0, 2, 2, 0, 0, 0, 5, 0, 5, 5]);
    assert.equal(loginShardsForClaimDay(0), 0);
    assert.equal(loginShardsForClaimDay(-3), 0);
    let streak = 0;
    let total = 0;
    for (let day = 1; day <= 7; day += 1) {
        const r = computeLoginReward({ lastDate: `2026-06-0${day}`, prevStreak: streak, level: 10, today: `2026-06-1${day}`, yesterday: '' });
        streak = r.streak;
        total += r.fateShards;
    }
    assert.equal(total, 2 * STREAK_EARLY_SHARD_REWARD + STREAK_SHARD_REWARD, 'the first week pays 4 + 5');
});

test('claiming twice the same day is idempotent (no grant, streak preserved)', () => {
    const r = computeLoginReward({ lastDate: '2026-06-23', prevStreak: 4, level: 10, today: '2026-06-23', yesterday: '2026-06-22' });
    assert.deepEqual(r, { alreadyClaimed: true, streak: 4, ryo: 0, fateShards: 0 });
});

test('daysUntilShardBonus counts down to the 7-day milestone', () => {
    assert.equal(daysUntilShardBonus(1), 6);
    assert.equal(daysUntilShardBonus(6), 1);
    assert.equal(daysUntilShardBonus(7), 0);
    assert.equal(daysUntilShardBonus(8), 6);
});
