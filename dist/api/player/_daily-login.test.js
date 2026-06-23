"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _daily_login_js_1 = require("./_daily-login.js");
(0, node_test_1.test)('dailyLoginRyo is modest, level-scaled, and capped', () => {
    strict_1.default.equal((0, _daily_login_js_1.dailyLoginRyo)(1), 600);
    strict_1.default.equal((0, _daily_login_js_1.dailyLoginRyo)(5), 1000);
    strict_1.default.equal((0, _daily_login_js_1.dailyLoginRyo)(50), 5500);
    strict_1.default.equal((0, _daily_login_js_1.dailyLoginRyo)(75), _daily_login_js_1.LOGIN_RYO_CAP); // 500 + 100*75 = 8000
    strict_1.default.equal((0, _daily_login_js_1.dailyLoginRyo)(100), _daily_login_js_1.LOGIN_RYO_CAP); // capped
    strict_1.default.equal((0, _daily_login_js_1.dailyLoginRyo)(0), 600); // floor of level 1
});
(0, node_test_1.test)('first-ever claim starts a streak of 1', () => {
    const r = (0, _daily_login_js_1.computeLoginReward)({ lastDate: '', prevStreak: 0, level: 5, today: '2026-06-23', yesterday: '2026-06-22' });
    strict_1.default.equal(r.alreadyClaimed, false);
    strict_1.default.equal(r.streak, 1);
    strict_1.default.equal(r.ryo, 1000);
    strict_1.default.equal(r.fateShards, 0);
});
(0, node_test_1.test)('consecutive day extends the streak', () => {
    const r = (0, _daily_login_js_1.computeLoginReward)({ lastDate: '2026-06-22', prevStreak: 3, level: 10, today: '2026-06-23', yesterday: '2026-06-22' });
    strict_1.default.equal(r.streak, 4);
    strict_1.default.equal(r.alreadyClaimed, false);
});
(0, node_test_1.test)('a gap resets the streak to 1', () => {
    const r = (0, _daily_login_js_1.computeLoginReward)({ lastDate: '2026-06-20', prevStreak: 6, level: 10, today: '2026-06-23', yesterday: '2026-06-22' });
    strict_1.default.equal(r.streak, 1);
});
(0, node_test_1.test)('every 7th consecutive day grants 5 fate shards', () => {
    const day7 = (0, _daily_login_js_1.computeLoginReward)({ lastDate: '2026-06-22', prevStreak: 6, level: 10, today: '2026-06-23', yesterday: '2026-06-22' });
    strict_1.default.equal(day7.streak, 7);
    strict_1.default.equal(day7.fateShards, _daily_login_js_1.STREAK_SHARD_REWARD);
    const day8 = (0, _daily_login_js_1.computeLoginReward)({ lastDate: '2026-06-23', prevStreak: 7, level: 10, today: '2026-06-24', yesterday: '2026-06-23' });
    strict_1.default.equal(day8.streak, 8);
    strict_1.default.equal(day8.fateShards, 0);
    const day14 = (0, _daily_login_js_1.computeLoginReward)({ lastDate: '2026-06-29', prevStreak: 13, level: 10, today: '2026-06-30', yesterday: '2026-06-29' });
    strict_1.default.equal(day14.fateShards, _daily_login_js_1.STREAK_SHARD_REWARD);
});
(0, node_test_1.test)('claiming twice the same day is idempotent (no grant, streak preserved)', () => {
    const r = (0, _daily_login_js_1.computeLoginReward)({ lastDate: '2026-06-23', prevStreak: 4, level: 10, today: '2026-06-23', yesterday: '2026-06-22' });
    strict_1.default.deepEqual(r, { alreadyClaimed: true, streak: 4, ryo: 0, fateShards: 0 });
});
(0, node_test_1.test)('daysUntilShardBonus counts down to the 7-day milestone', () => {
    strict_1.default.equal((0, _daily_login_js_1.daysUntilShardBonus)(1), 6);
    strict_1.default.equal((0, _daily_login_js_1.daysUntilShardBonus)(6), 1);
    strict_1.default.equal((0, _daily_login_js_1.daysUntilShardBonus)(7), 0);
    strict_1.default.equal((0, _daily_login_js_1.daysUntilShardBonus)(8), 6);
});
