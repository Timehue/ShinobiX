import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACHIEVEMENT_RULES, ACHIEVEMENT_TITLES, achievementRewardForIds, eligibleAchievementIds } from './_catalog.js';

describe('achievement authority catalog', () => {
    it('has exact ID parity with the client catalog', () => {
        const source = readFileSync('shinobij.client/src/constants/achievements.ts', 'utf8');
        const clientIds = [...source.matchAll(/\bid:\s*"([^"]+)"/g)].map((match) => match[1]);
        assert.deepEqual(new Set(ACHIEVEMENT_RULES.map((rule) => rule.id)), new Set(clientIds));
        assert.equal(ACHIEVEMENT_RULES.length, clientIds.length);
        const titleBlock = source.match(/TITLE_ACHIEVEMENT_IDS[\s\S]*?\]\);/)?.[0] ?? '';
        const clientTitleIds = [...titleBlock.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);
        assert.deepEqual(new Set(Object.keys(ACHIEVEMENT_TITLES)), new Set(clientTitleIds));
    });
    it('evaluates numeric and compound rules from stored state', () => {
        const ids = eligibleAchievementIds({ level: 100, ryo: 1_000_000, bankRyo: 0, itemStacks: [{ itemId: 'x', count: 100 }], weeklyBossKills: { a: 1, b: 1, c: 1, d: 1, e: 1 }, unspentStats: 0 });
        for (const id of ['level-10', 'level-100', 'ryo-25k', 'secret-untouched', 'secret-packrat', 'secret-weekly-bosses-5', 'secret-minmaxer']) assert.ok(ids.includes(id), id);
    });
    it('uses canonical public and hidden rewards', () => {
        assert.deepEqual(achievementRewardForIds(['level-10', 'secret-packrat']), { ryo: 5000, fateShards: 1 });
    });
});
