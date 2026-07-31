import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applySectorExploreReward, DAILY_SECTOR_EXPLORE_LIMIT, sectorExploreReward } from './_explore.js';
import { MAX_WILD_SECTOR } from '../../shared/sector-geo.js';

describe('sector exploration settlement', () => {
    it('uses the canonical sector formula and rejects out-of-world sectors', () => {
        // Character XP retired: the old xp line (20 + sector/5) folds into ryo
        // — sector 25: ryo (10+6) + (10+2) = 28, xp always 0.
        assert.deepEqual(sectorExploreReward(25), { sector: 25, xp: 0, ryo: 28 });
        assert.equal(sectorExploreReward(0), null);
        assert.equal(sectorExploreReward(MAX_WILD_SECTOR + 1), null);
    });

    it('settles every sector the world map lets you explore', () => {
        // The world map now FAILS an explore the server refuses, so a stale
        // ceiling here would make the outermost sectors unexplorable rather
        // than merely unpaid. The 2026-07 renumbering already widened the
        // world once past the old hard-coded 60.
        for (let sector = 1; sector <= MAX_WILD_SECTOR; sector++) {
            assert.ok(sectorExploreReward(sector), `sector ${sector} must settle`);
        }
    });

    it('commits ryo and counters from stored state (xp retired, level derived)', () => {
        const result = applySectorExploreReward({ level: 1, xp: 0, ryo: 5, totalTilesExplored: 8 }, 10, '2026-07-12');
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.reward.xp, 0);
        assert.equal(result.reward.ryo, (10 + 2) + (10 + 1)); // sector 10: 12 + 11 = 23
        assert.equal(result.character.ryo, 5 + 23);
        assert.equal((result.character as Record<string, unknown>).xp, 0, 'frozen xp untouched');
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
