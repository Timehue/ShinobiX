"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const _catalog_js_1 = require("./_catalog.js");
(0, node_test_1.describe)('achievement authority catalog', () => {
    (0, node_test_1.it)('has exact ID parity with the client catalog', () => {
        const source = (0, node_fs_1.readFileSync)('shinobij.client/src/constants/achievements.ts', 'utf8');
        const clientIds = [...source.matchAll(/\bid:\s*"([^"]+)"/g)].map((match) => match[1]);
        strict_1.default.deepEqual(new Set(_catalog_js_1.ACHIEVEMENT_RULES.map((rule) => rule.id)), new Set(clientIds));
        strict_1.default.equal(_catalog_js_1.ACHIEVEMENT_RULES.length, clientIds.length);
        const titleBlock = source.match(/TITLE_ACHIEVEMENT_IDS[\s\S]*?\]\);/)?.[0] ?? '';
        const clientTitleIds = [...titleBlock.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);
        strict_1.default.deepEqual(new Set(Object.keys(_catalog_js_1.ACHIEVEMENT_TITLES)), new Set(clientTitleIds));
    });
    (0, node_test_1.it)('evaluates numeric and compound rules from stored state', () => {
        const ids = (0, _catalog_js_1.eligibleAchievementIds)({ level: 100, ryo: 1_000_000, bankRyo: 0, itemStacks: [{ itemId: 'x', count: 100 }], weeklyBossKills: { a: 1, b: 1, c: 1, d: 1, e: 1 }, unspentStats: 0 });
        for (const id of ['level-10', 'level-100', 'ryo-25k', 'secret-untouched', 'secret-packrat', 'secret-weekly-bosses-5', 'secret-minmaxer'])
            strict_1.default.ok(ids.includes(id), id);
    });
    (0, node_test_1.it)('uses canonical public and hidden rewards', () => {
        strict_1.default.deepEqual((0, _catalog_js_1.achievementRewardForIds)(['level-10', 'secret-packrat']), { ryo: 5000, fateShards: 1 });
    });
});
