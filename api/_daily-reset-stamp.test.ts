import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { advanceLastDailyReset, LAST_DAILY_RESET_COUNTERS } from './_daily-reset-stamp.js';
import { hasDailyMissionSlot, markMissionCompletedFields } from './missions/_mission-catalog.js';

const YESTERDAY = '2026-10-21';
const TODAY = '2026-10-22';

describe('advanceLastDailyReset (2026-10 rebalance, PET-8)', () => {
    it('names exactly the counters the server keys to lastDailyReset', () => {
        assert.deepEqual([...LAST_DAILY_RESET_COUNTERS], ['dailyPetWins', 'dailyMissionsCompleted', 'dailyFateSpins', 'dailyHollowGateRuns']);
    });

    it('a new day zeroes every stale shared counter', () => {
        const char = { lastDailyReset: YESTERDAY, dailyPetWins: 100, dailyMissionsCompleted: 20, dailyFateSpins: 5, dailyHollowGateRuns: 3 };
        assert.deepEqual(advanceLastDailyReset(char, TODAY), {
            dailyPetWins: 0, dailyMissionsCompleted: 0, dailyFateSpins: 0, dailyHollowGateRuns: 0, lastDailyReset: TODAY,
        });
    });

    it('a new day adds no field the save did not hold, and leaves other day stamps alone', () => {
        const char = { lastDailyReset: YESTERDAY, dailyPetWins: 4, dailyHuntsCompleted: 20, lastHuntReset: YESTERDAY, dailyTowerXp: 900 };
        assert.deepEqual(advanceLastDailyReset(char, TODAY), { dailyPetWins: 0, lastDailyReset: TODAY });
        assert.deepEqual(advanceLastDailyReset({}, TODAY), { lastDailyReset: TODAY });
    });

    it('the same day keeps every counter', () => {
        assert.deepEqual(advanceLastDailyReset({ lastDailyReset: TODAY, dailyPetWins: 100, dailyMissionsCompleted: 20 }, TODAY), { lastDailyReset: TODAY });
    });

    it('is monotonic: an older day never rewinds the stamp or zeroes a newer day', () => {
        // A delayed settlement stamped with its own (earlier) day must not reopen
        // today's 100-win arena cap or the 20-mission board.
        assert.deepEqual(advanceLastDailyReset({ lastDailyReset: TODAY, dailyPetWins: 100, dailyMissionsCompleted: 20 }, YESTERDAY), {});
    });
});

describe('the mission writer rolls the shared day (PET-8)', () => {
    it('a first claim of the day zeroes yesterday\'s arena wins', () => {
        const char = { lastDailyReset: YESTERDAY, dailyPetWins: 100, dailyMissionsCompleted: 20, totalMissionsCompleted: 50, clanMissionContrib: 3 };
        const next = { ...char, ...markMissionCompletedFields(char, TODAY, '2026-10') };
        assert.equal(next.lastDailyReset, TODAY);
        assert.equal(next.dailyMissionsCompleted, 1);
        assert.equal(next.dailyPetWins, 0, 'yesterday\'s 100 arena wins must not lock today\'s arena');
        assert.ok(hasDailyMissionSlot(next, TODAY));
    });

    it('a same-day claim leaves the arena counter as it was', () => {
        const char = { lastDailyReset: TODAY, dailyPetWins: 7, dailyMissionsCompleted: 2 };
        const next = { ...char, ...markMissionCompletedFields(char, TODAY, '2026-10') };
        assert.equal(next.dailyPetWins, 7);
        assert.equal(next.dailyMissionsCompleted, 3);
    });
});
