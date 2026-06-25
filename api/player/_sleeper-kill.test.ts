import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sleeperTargetBlock, computeSleeperSeals } from './sleeper-kill.js';
import { DAILY_SEAL_CAP, PER_TARGET_DAILY_CAP } from '../pvp/_vanguard-rewards.js';

function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
}

describe('sleeperTargetBlock (sleeper KO gating)', () => {
    const liveTarget = { level: 40 };

    it('404 when the target save has no character', () => {
        assert.deepEqual(sleeperTargetBlock(undefined, 18), { status: 404, error: 'Target not found.' });
    });

    it('409 safe-zone for a village/Central logout (sector 0)', () => {
        const b = sleeperTargetBlock(liveTarget, 0);
        assert.equal(b?.status, 409);
        assert.match(b!.error, /safe zone/);
    });

    it('409 safe-zone for a non-finite sector', () => {
        assert.equal(sleeperTargetBlock(liveTarget, NaN)?.status, 409);
    });

    it('403 Academy protection for a sub-Genin target (level < 15)', () => {
        assert.equal(sleeperTargetBlock({ level: 14 }, 18)?.status, 403);
        assert.equal(sleeperTargetBlock({ level: 1 }, 18)?.status, 403);
    });

    it('409 when the target is already hospitalized (already KO\'d)', () => {
        const b = sleeperTargetBlock({ level: 40, hospitalized: true }, 18);
        assert.equal(b?.status, 409);
        assert.match(b!.error, /already been defeated/);
    });

    it('allows a valid sleeper (Genin+, wild sector, not hospitalized)', () => {
        assert.equal(sleeperTargetBlock({ level: 40 }, 18), null);
        assert.equal(sleeperTargetBlock({ level: 15 }, 1), null);
    });
});

describe('computeSleeperSeals (capped Vanguard payout, no escort / no fight gate)', () => {
    // Rank-5 Vanguard, even-level KO, no mastery, fresh day → base seal table value.
    const winner = { professionRank: 5, level: 40 };
    const loser = { level: 40 };

    it('grants the rank-table seals for an even-level KO', () => {
        const grant = computeSleeperSeals(winner, loser, 'victim');
        assert.ok(grant, 'expected a grant');
        assert.equal(grant!.seals, 3);            // VANGUARD_SEALS_PER_KILL[5]
        assert.equal(grant!.xpGain, 220);          // vanguardXpForLevel(40)=200, rank>=2 → ×1.1
        assert.deepEqual(grant!.nextByTarget, { victim: 3 });
    });

    it('returns null when the target is >20 levels below (gap rule zeroes the seals)', () => {
        assert.equal(computeSleeperSeals({ professionRank: 5, level: 100 }, { level: 40 }, 'victim'), null);
    });

    it('respects the per-target daily cap (no seals once the target is maxed today)', () => {
        const maxedWinner = {
            professionRank: 5,
            level: 40,
            vanguardDailyResetDate: todayKey(),
            dailyHonorSealsByTarget: { victim: PER_TARGET_DAILY_CAP },
        };
        assert.equal(computeSleeperSeals(maxedWinner, loser, 'victim'), null);
    });

    it('respects the global daily seal cap', () => {
        const cappedWinner = {
            professionRank: 5,
            level: 40,
            vanguardDailyResetDate: todayKey(),
            dailyHonorSealsEarned: DAILY_SEAL_CAP,
        };
        assert.equal(computeSleeperSeals(cappedWinner, loser, 'victim'), null);
    });
});
