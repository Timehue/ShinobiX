"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _explore_js_1 = require("./_explore.js");
(0, node_test_1.describe)('sector exploration settlement', () => {
    (0, node_test_1.it)('uses the canonical sector formula and rejects out-of-world sectors', () => {
        node_assert_1.strict.deepEqual((0, _explore_js_1.sectorExploreReward)(25), { sector: 25, xp: 25, ryo: 16 });
        node_assert_1.strict.equal((0, _explore_js_1.sectorExploreReward)(0), null);
        node_assert_1.strict.equal((0, _explore_js_1.sectorExploreReward)(61), null);
    });
    (0, node_test_1.it)('commits XP, ryo, and counters from stored state', () => {
        const result = (0, _explore_js_1.applySectorExploreReward)({ level: 1, xp: 0, ryo: 5, totalTilesExplored: 8 }, 10, '2026-07-12');
        node_assert_1.strict.equal(result.ok, true);
        if (!result.ok)
            return;
        node_assert_1.strict.equal(result.reward.xp, 22);
        node_assert_1.strict.equal(result.reward.ryo, 12);
        node_assert_1.strict.equal(result.character.ryo, 17);
        node_assert_1.strict.equal(result.character.totalTilesExplored, 9);
        node_assert_1.strict.equal(result.character.dailyTilesExplored, 1);
    });
    (0, node_test_1.it)('resets on a new date and fails closed at the dedicated daily limit', () => {
        const capped = (0, _explore_js_1.applySectorExploreReward)({ serverExploreDate: '2026-07-12', serverExploresToday: _explore_js_1.DAILY_SECTOR_EXPLORE_LIMIT }, 1, '2026-07-12');
        node_assert_1.strict.deepEqual(capped, { ok: false, reason: 'daily-limit' });
        const reset = (0, _explore_js_1.applySectorExploreReward)({ serverExploreDate: '2026-07-11', serverExploresToday: _explore_js_1.DAILY_SECTOR_EXPLORE_LIMIT }, 1, '2026-07-12');
        node_assert_1.strict.equal(reset.ok, true);
        if (reset.ok)
            node_assert_1.strict.equal(reset.character.serverExploresToday, 1);
    });
});
