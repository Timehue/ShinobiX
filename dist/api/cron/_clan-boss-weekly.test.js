"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _clan_boss_weekly_js_1 = require("./_clan-boss-weekly.js");
(0, node_test_1.describe)('Clan Boss weekly reward record', () => {
    const reward = { ryo: 30_000, fateShards: 3, boneCharms: 5, clanXp: 1_500 };
    (0, node_test_1.it)('commits treasury values and the weekly receipt in one record mutation', () => {
        const initial = {
            level: 1,
            xp: 0,
            members: Array.from({ length: 10 }, (_, i) => ({ name: `member-${i}` })),
            treasury: { ryo: 200, fateShards: 1, boneCharms: 2 },
        };
        const result = (0, _clan_boss_weekly_js_1.applyClanBossRewardToRecord)(initial, reward, '2026-W29');
        node_assert_1.strict.equal(result.applied, true);
        node_assert_1.strict.deepEqual(result.record.treasury, { ryo: 30_200, fateShards: 4, boneCharms: 7 });
        node_assert_1.strict.deepEqual(result.record.clanBossRewardReceipts, ['2026-W29']);
        node_assert_1.strict.ok(Number(result.record.xp) > 0);
    });
    (0, node_test_1.it)('replays the same week without adding currency or XP twice', () => {
        const first = (0, _clan_boss_weekly_js_1.applyClanBossRewardToRecord)({
            level: 1,
            xp: 0,
            members: Array.from({ length: 10 }, (_, i) => ({ name: `member-${i}` })),
            treasury: { ryo: 0, fateShards: 0, boneCharms: 0 },
        }, reward, '2026-W29');
        const replay = (0, _clan_boss_weekly_js_1.applyClanBossRewardToRecord)(first.record, reward, '2026-W29');
        node_assert_1.strict.equal(replay.applied, false);
        node_assert_1.strict.deepEqual(replay.record, first.record);
    });
    (0, node_test_1.it)('keeps distinct weeks independently payable', () => {
        const first = (0, _clan_boss_weekly_js_1.applyClanBossRewardToRecord)({ members: [], treasury: {} }, reward, '2026-W29');
        const second = (0, _clan_boss_weekly_js_1.applyClanBossRewardToRecord)(first.record, reward, '2026-W30');
        node_assert_1.strict.equal(second.applied, true);
        node_assert_1.strict.deepEqual(second.record.clanBossRewardReceipts, ['2026-W29', '2026-W30']);
        node_assert_1.strict.equal(second.record.treasury.ryo, 60_000);
    });
});
