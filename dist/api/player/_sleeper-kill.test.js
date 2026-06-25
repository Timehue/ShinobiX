"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const sleeper_kill_js_1 = require("./sleeper-kill.js");
const _vanguard_rewards_js_1 = require("../pvp/_vanguard-rewards.js");
function todayKey() {
    return new Date().toISOString().slice(0, 10);
}
(0, node_test_1.describe)('sleeperTargetBlock (sleeper KO gating)', () => {
    const liveTarget = { level: 40 };
    (0, node_test_1.it)('404 when the target save has no character', () => {
        node_assert_1.strict.deepEqual((0, sleeper_kill_js_1.sleeperTargetBlock)(undefined, 18), { status: 404, error: 'Target not found.' });
    });
    (0, node_test_1.it)('409 safe-zone for a village/Central logout (sector 0)', () => {
        const b = (0, sleeper_kill_js_1.sleeperTargetBlock)(liveTarget, 0);
        node_assert_1.strict.equal(b?.status, 409);
        node_assert_1.strict.match(b.error, /safe zone/);
    });
    (0, node_test_1.it)('409 safe-zone for a non-finite sector', () => {
        node_assert_1.strict.equal((0, sleeper_kill_js_1.sleeperTargetBlock)(liveTarget, NaN)?.status, 409);
    });
    (0, node_test_1.it)('409 when the target is already hospitalized (already KO\'d)', () => {
        const b = (0, sleeper_kill_js_1.sleeperTargetBlock)({ level: 40, hospitalized: true }, 18);
        node_assert_1.strict.equal(b?.status, 409);
        node_assert_1.strict.match(b.error, /already been defeated/);
    });
    (0, node_test_1.it)('allows a sleeper of ANY level (no Academy protection on this path)', () => {
        // Per owner decision: every sleeper is attackable regardless of level.
        node_assert_1.strict.equal((0, sleeper_kill_js_1.sleeperTargetBlock)({ level: 1 }, 18), null);
        node_assert_1.strict.equal((0, sleeper_kill_js_1.sleeperTargetBlock)({ level: 11 }, 44), null);
        node_assert_1.strict.equal((0, sleeper_kill_js_1.sleeperTargetBlock)({ level: 14 }, 18), null);
        node_assert_1.strict.equal((0, sleeper_kill_js_1.sleeperTargetBlock)({ level: 40 }, 18), null);
    });
});
(0, node_test_1.describe)('computeSleeperSeals (capped Vanguard payout, no escort / no fight gate)', () => {
    // Rank-5 Vanguard, even-level KO, no mastery, fresh day → base seal table value.
    const winner = { professionRank: 5, level: 40 };
    const loser = { level: 40 };
    (0, node_test_1.it)('grants the rank-table seals for an even-level KO', () => {
        const grant = (0, sleeper_kill_js_1.computeSleeperSeals)(winner, loser, 'victim');
        node_assert_1.strict.ok(grant, 'expected a grant');
        node_assert_1.strict.equal(grant.seals, 3); // VANGUARD_SEALS_PER_KILL[5]
        node_assert_1.strict.equal(grant.xpGain, 220); // vanguardXpForLevel(40)=200, rank>=2 → ×1.1
        node_assert_1.strict.deepEqual(grant.nextByTarget, { victim: 3 });
    });
    (0, node_test_1.it)('returns null when the target is >20 levels below (gap rule zeroes the seals)', () => {
        node_assert_1.strict.equal((0, sleeper_kill_js_1.computeSleeperSeals)({ professionRank: 5, level: 100 }, { level: 40 }, 'victim'), null);
    });
    (0, node_test_1.it)('respects the per-target daily cap (no seals once the target is maxed today)', () => {
        const maxedWinner = {
            professionRank: 5,
            level: 40,
            vanguardDailyResetDate: todayKey(),
            dailyHonorSealsByTarget: { victim: _vanguard_rewards_js_1.PER_TARGET_DAILY_CAP },
        };
        node_assert_1.strict.equal((0, sleeper_kill_js_1.computeSleeperSeals)(maxedWinner, loser, 'victim'), null);
    });
    (0, node_test_1.it)('respects the global daily seal cap', () => {
        const cappedWinner = {
            professionRank: 5,
            level: 40,
            vanguardDailyResetDate: todayKey(),
            dailyHonorSealsEarned: _vanguard_rewards_js_1.DAILY_SEAL_CAP,
        };
        node_assert_1.strict.equal((0, sleeper_kill_js_1.computeSleeperSeals)(cappedWinner, loser, 'victim'), null);
    });
});
