"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _sync_js_1 = require("./_sync.js");
(0, node_test_1.describe)('achievement sync settlement', () => {
    (0, node_test_1.it)('silently seeds first-load eligibility without a retroactive payout', () => {
        const out = (0, _sync_js_1.applyAchievementSync)({ level: 10, ryo: 0, fateShards: 0 }, 123);
        strict_1.default.ok(out.character.unlockedAchievements.includes('level-10'));
        strict_1.default.ok(out.character.claimedAchievementRewards.includes('level-10'));
        strict_1.default.equal(out.character.ryo, 0);
        strict_1.default.deepEqual(out.newlyRewarded, []);
    });
    (0, node_test_1.it)('pays each newly eligible achievement once', () => {
        const first = (0, _sync_js_1.applyAchievementSync)({ level: 9, ryo: 0, fateShards: 0, unlockedAchievements: [], claimedAchievementRewards: [] }, 1);
        const earned = (0, _sync_js_1.applyAchievementSync)({ ...first.character, level: 10 }, 2);
        strict_1.default.deepEqual(earned.newlyRewarded, ['level-10']);
        strict_1.default.equal(earned.character.ryo, 2000);
        const replay = (0, _sync_js_1.applyAchievementSync)(earned.character, 3);
        strict_1.default.deepEqual(replay.newlyRewarded, []);
        strict_1.default.equal(replay.character.ryo, 2000);
    });
    (0, node_test_1.it)('treats legacy unlocked IDs as already claimed during migration', () => {
        const out = (0, _sync_js_1.applyAchievementSync)({ level: 10, ryo: 0, unlockedAchievements: ['level-10'] });
        strict_1.default.equal(out.character.ryo, 0);
        strict_1.default.deepEqual(out.newlyRewarded, []);
    });
    (0, node_test_1.it)('backfills wearable titles from server-eligible achievements', () => {
        const out = (0, _sync_js_1.applyAchievementSync)({ level: 100, ryo: 0, unlockedAchievements: [], claimedAchievementRewards: [] });
        strict_1.default.ok(out.character.earnedTitles.includes('Centenarian'));
    });
});
