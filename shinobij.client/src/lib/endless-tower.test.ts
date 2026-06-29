import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    endlessWaveReward,
    towerDailyXpSoftCap,
    creditTowerXpWithSoftCap,
    applyTowerCashOut,
    TOWER_XP_OVERCAP_FACTOR,
} from './endless-tower';
import type { Character, EndlessTowerRun } from '../types/character';

// Phase 2: the Endless Tower stays a great ryo/material farm but its CHARACTER-XP
// is daily-soft-capped so it can't bypass the ~90-day level curve.

describe('towerDailyXpSoftCap — ~half a day of modeled income', () => {
    it('scales with level (60·L + 450)', () => {
        assert.equal(towerDailyXpSoftCap(1), 510);
        assert.equal(towerDailyXpSoftCap(50), 3450);
        assert.equal(towerDailyXpSoftCap(100), 6450);
    });
    it('floors junk levels to 1', () => {
        assert.equal(towerDailyXpSoftCap(0), 510);
        assert.equal(towerDailyXpSoftCap(-5), 510);
    });
});

describe('creditTowerXpWithSoftCap', () => {
    it('credits full XP under the daily cap', () => {
        const { credited, rawEarned } = creditTowerXpWithSoftCap(100, 0, 50);
        assert.equal(credited, 100);
        assert.equal(rawEarned, 100);
    });
    it('decays the portion above the cap to the overcap factor', () => {
        const cap = towerDailyXpSoftCap(50); // 3450
        const { credited } = creditTowerXpWithSoftCap(5000, 0, 50);
        const over = 5000 - cap;
        assert.equal(credited, cap + Math.floor(over * TOWER_XP_OVERCAP_FACTOR));
    });
    it('already at the cap → all further XP is decayed', () => {
        const { credited } = creditTowerXpWithSoftCap(1000, towerDailyXpSoftCap(50), 50);
        assert.equal(credited, Math.floor(1000 * TOWER_XP_OVERCAP_FACTOR));
    });
    it('partially over the cap splits full + decayed', () => {
        const { credited } = creditTowerXpWithSoftCap(1000, 3000, 50); // cap 3450, room 450
        assert.equal(credited, 450 + Math.floor(550 * TOWER_XP_OVERCAP_FACTOR));
    });
    it('never credits more than was banked, and rawEarned is the gross', () => {
        for (const [banked, earned, lvl] of [[100, 0, 5], [9999, 1000, 80], [3450, 3450, 50], [0, 0, 1]] as const) {
            const { credited, rawEarned } = creditTowerXpWithSoftCap(banked, earned, lvl);
            assert.ok(credited <= banked, `credited ${credited} <= banked ${banked}`);
            assert.ok(credited >= 0);
            assert.equal(rawEarned, banked);
        }
    });
    it('is monotonic in banked XP (more in → at least as much out)', () => {
        let prev = -1;
        for (const banked of [0, 500, 3450, 4000, 10000]) {
            const { credited } = creditTowerXpWithSoftCap(banked, 0, 50);
            assert.ok(credited >= prev, `credited rises @${banked}`);
            prev = credited;
        }
    });
});

describe('applyTowerCashOut — credits via gainXp, banks ryo, tracks daily, clears run', () => {
    // stub gainXp that just records the credited amount onto xp (no level-up math)
    const stubGainXp = (c: Character, amt: number): Character => ({ ...c, xp: (c.xp ?? 0) + amt });
    const run = (bankedXp: number): EndlessTowerRun => ({ wave: 10, bankedRyo: 500, bankedXp, startedAt: 0, highestMilestoneClaimed: 0 });

    it('soft-caps the credited XP, banks ryo uncapped, tracks raw daily, nulls the run', () => {
        const char = { level: 50, xp: 0, ryo: 100, lastDailyReset: 'D', dailyTowerXp: 0 } as unknown as Character;
        const out = applyTowerCashOut(char, run(5000), 'D', stubGainXp);
        const cap = towerDailyXpSoftCap(50); // 3450
        assert.equal(out.xp, cap + Math.floor((5000 - cap) * TOWER_XP_OVERCAP_FACTOR)); // credited, soft-capped
        assert.equal(out.ryo, 600);            // ryo uncapped (100 + 500)
        assert.equal(out.dailyTowerXp, 5000);  // raw tracked toward the cap
        assert.equal(out.endlessTowerRun, null);
        assert.equal(out.endlessTowerBestWave, 10);
    });
    it('resets the daily counter across a day boundary', () => {
        const char = { level: 50, xp: 0, ryo: 0, lastDailyReset: 'OLD', dailyTowerXp: 9999 } as unknown as Character;
        const out = applyTowerCashOut(char, run(100), 'NEW', stubGainXp);
        assert.equal(out.dailyTowerXp, 100); // yesterday's count dropped
        assert.equal(out.xp, 100);           // under today's cap → full credit
        assert.equal(out.lastDailyReset, 'NEW');
    });
});

describe('endlessWaveReward — unchanged per-wave shape (sanity)', () => {
    it('still scales ryo/xp with wave and level', () => {
        const w1 = endlessWaveReward(1, 50);
        const w10 = endlessWaveReward(10, 50);
        assert.ok(w10.xp > w1.xp && w10.ryo > w1.ryo);
        assert.equal(endlessWaveReward(10, 50).isMilestone, true);
    });
});
