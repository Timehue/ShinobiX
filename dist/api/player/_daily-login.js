"use strict";
/*
 * Pure core for the daily login-streak reward (api/player/daily-login.ts).
 * Split out from the IO handler so the streak + payout math is unit-testable on
 * its own (same pattern as the _*-validate.ts cores).
 *
 * Server is authoritative: the handler runs computeLoginReward INSIDE the
 * save lock with failClosed, then persists. The CLIENT mirrors only the ryo
 * curve below (shinobij.client/src/lib/daily-briefing.ts) for a pre-claim
 * preview — keep dailyLoginRyo() in sync across the two.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STREAK_SHARD_REWARD = exports.STREAK_SHARD_INTERVAL = exports.LOGIN_RYO_CAP = exports.LOGIN_RYO_PER_LEVEL = exports.LOGIN_RYO_BASE = void 0;
exports.dailyLoginRyo = dailyLoginRyo;
exports.computeLoginReward = computeLoginReward;
exports.daysUntilShardBonus = daysUntilShardBonus;
// Reward curve — "modest, level-scaled". L5 ≈ 1,000 · L50 ≈ 5,500 · capped at L75+.
exports.LOGIN_RYO_BASE = 500;
exports.LOGIN_RYO_PER_LEVEL = 100;
exports.LOGIN_RYO_CAP = 8000;
// Every Nth consecutive day grants the shard bonus.
exports.STREAK_SHARD_INTERVAL = 7;
exports.STREAK_SHARD_REWARD = 5;
function dailyLoginRyo(level) {
    const lv = Math.max(1, Math.floor(Number(level) || 1));
    return Math.min(exports.LOGIN_RYO_CAP, exports.LOGIN_RYO_BASE + exports.LOGIN_RYO_PER_LEVEL * lv);
}
function cleanStreak(v) {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
}
/**
 * Decide today's login reward. Idempotent per UTC day: if lastDate is today,
 * nothing is granted and the existing streak is echoed back. A consecutive day
 * (lastDate === yesterday) extends the streak; any gap resets it to 1.
 */
function computeLoginReward(i) {
    if (i.lastDate === i.today) {
        return { alreadyClaimed: true, streak: cleanStreak(i.prevStreak), ryo: 0, fateShards: 0 };
    }
    const streak = i.lastDate === i.yesterday ? cleanStreak(i.prevStreak) + 1 : 1;
    const ryo = dailyLoginRyo(i.level);
    const fateShards = streak % exports.STREAK_SHARD_INTERVAL === 0 ? exports.STREAK_SHARD_REWARD : 0;
    return { alreadyClaimed: false, streak, ryo, fateShards };
}
/** Whole days until the next shard milestone (0 when today's claim hits one). */
function daysUntilShardBonus(streak) {
    const s = cleanStreak(streak);
    return (exports.STREAK_SHARD_INTERVAL - (s % exports.STREAK_SHARD_INTERVAL)) % exports.STREAK_SHARD_INTERVAL;
}
