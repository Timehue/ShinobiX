import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applySectorExploreReward, DAILY_SECTOR_EXPLORE_LIMIT, sectorExploreReward } from './_explore.js';

describe('sector exploration settlement', () => {
    it('uses the canonical sector formula and rejects out-of-world sectors', () => {
        assert.deepEqual(sectorExploreReward(25), { sector: 25, xp: 25, ryo: 16 });
        assert.equal(sectorExploreReward(0), null);
        assert.equal(sectorExploreReward(61), null);
    });

    it('commits XP, ryo, and counters from stored state', () => {
        const result = applySectorExploreReward({ level: 1, xp: 0, ryo: 5, totalTilesExplored: 8 }, 10, '2026-07-12');
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.reward.xp, 22);
        assert.equal(result.reward.ryo, 12);
        assert.equal(result.character.ryo, 17);
        assert.equal(result.character.totalTilesExplored, 9);
        assert.equal(result.character.dailyTilesExplored, 1);
    });

    it('resets on a new date and fails closed at the dedicated daily limit', () => {
        const capped = applySectorExploreReward({ serverExploreDate: '2026-07-12', serverExploresToday: DAILY_SECTOR_EXPLORE_LIMIT }, 1, '2026-07-12');
        assert.deepEqual(capped, { ok: false, reason: 'daily-limit' });
        const reset = applySectorExploreReward({ serverExploreDate: '2026-07-11', serverExploresToday: DAILY_SECTOR_EXPLORE_LIMIT }, 1, '2026-07-12');
        assert.equal(reset.ok, true);
        if (reset.ok) assert.equal(reset.character.serverExploresToday, 1);
    });
});
