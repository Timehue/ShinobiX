import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeLoginReward,
    dailyLoginRyo,
    daysUntilShardBonus,
    LOGIN_RYO_CAP,
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

test('first-ever claim starts a streak of 1', () => {
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

test('a gap resets the streak to 1', () => {
    const r = computeLoginReward({ lastDate: '2026-06-20', prevStreak: 6, level: 10, today: '2026-06-23', yesterday: '2026-06-22' });
    assert.equal(r.streak, 1);
});

test('every 7th consecutive day grants 5 fate shards', () => {
    const day7 = computeLoginReward({ lastDate: '2026-06-22', prevStreak: 6, level: 10, today: '2026-06-23', yesterday: '2026-06-22' });
    assert.equal(day7.streak, 7);
    assert.equal(day7.fateShards, STREAK_SHARD_REWARD);
    const day8 = computeLoginReward({ lastDate: '2026-06-23', prevStreak: 7, level: 10, today: '2026-06-24', yesterday: '2026-06-23' });
    assert.equal(day8.streak, 8);
    assert.equal(day8.fateShards, 0);
    const day14 = computeLoginReward({ lastDate: '2026-06-29', prevStreak: 13, level: 10, today: '2026-06-30', yesterday: '2026-06-29' });
    assert.equal(day14.fateShards, STREAK_SHARD_REWARD);
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
