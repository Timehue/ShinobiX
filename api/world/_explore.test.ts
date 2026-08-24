import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    applySectorExploreReward,
    DAILY_SECTOR_EXPLORE_LIMIT,
    rollSectorExploreOutcome,
    sectorExploreReward,
    SECTOR_EXPLORE_CHEST_CHANCE,
} from './_explore.js';
import {
    OWNER_VILLAGE_POOL_BONUS,
    SECTOR_CHEST_POOL_PER_DAY,
    SECTOR_EXPLORE_POOL_PER_DAY,
} from './_sector-pool.js';
import { MAX_WILD_SECTOR } from '../../shared/sector-geo.js';

describe('sector exploration settlement', () => {
    it('server-selects the authored chest, battle, and quiet outcomes', () => {
        const sequence = (...values: number[]) => {
            let index = 0;
            return () => values[index++] ?? 0;
        };
        assert.deepEqual(rollSectorExploreOutcome(sequence(0.149)), { kind: 'chest' });
        assert.deepEqual(rollSectorExploreOutcome(sequence(0.15, 0.80)), { kind: 'battle' });
        assert.deepEqual(rollSectorExploreOutcome(sequence(0.99, 0.8001)), { kind: 'none' });
        assert.deepEqual(
            rollSectorExploreOutcome(sequence(0.01, 0.20), false),
            { kind: 'battle' },
            'a capped chest falls through to the battle roll',
        );
    });

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

describe('shared sector pool sizing against the explore ceilings', () => {
    it('needs a real crowd to drain a sector, and leaves the world plenty of slack', () => {
        // The per-player ceiling is GLOBAL, not per-sector, so one maxed player
        // can spend all 150 explores on a single tile.
        assert.equal(SECTOR_EXPLORE_POOL_PER_DAY / DAILY_SECTOR_EXPLORE_LIMIT, 10,
            '10 maxed players to pick a non-owner sector clean (500/day was 3.3)');
        assert.equal(
            Math.floor(SECTOR_EXPLORE_POOL_PER_DAY * (1 + OWNER_VILLAGE_POOL_BONUS)) / DAILY_SECTOR_EXPLORE_LIMIT, 15,
            'and 15 for the village standing on ground it owns');
        // World capacity vs the officially supported 200-player ceiling: the
        // pool must not be a de-facto global cap on exploring.
        const worldCapacity = MAX_WILD_SECTOR * SECTOR_EXPLORE_POOL_PER_DAY;
        const worldDemand = 200 * DAILY_SECTOR_EXPLORE_LIMIT;
        assert.equal(worldCapacity, 99_000);
        assert.equal(worldDemand, 30_000);
        assert.ok(worldCapacity >= worldDemand * 3,
            `world explore capacity ${worldCapacity} must leave 3x headroom over ${worldDemand} of demand`);
    });

    it('sizes the chest pool so it can never be the binding constraint', () => {
        // A fully farmed sector yields exactly SECTOR_EXPLORE_POOL_PER_DAY x the
        // authored chest rate in expectation. At 500/75 that was 75.0 expected
        // against a 75 cap, so roughly half of fully farmed sectors stranded
        // chests. The ratio must stay exact.
        assert.equal(SECTOR_EXPLORE_POOL_PER_DAY * SECTOR_EXPLORE_CHEST_CHANCE, SECTOR_CHEST_POOL_PER_DAY);
        assert.equal(SECTOR_CHEST_POOL_PER_DAY, 225);
    });
});
