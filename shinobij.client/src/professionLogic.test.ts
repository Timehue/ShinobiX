import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    getProfessionRankForXp,
    professionXpMultiplier,
    petTamerPveMultiplier,
    petTamerTrainingSpeedPct,
    petTamerExpeditionMult,
    levelGapSealMultiplier,
    vanguardXpForKill,
    vanguardSealsForKill,
    targetTooYoungForRewards,
} from './professionLogic.js';

describe('getProfessionRankForXp', () => {
    it('starts at Rank 1 with 0 XP', () => {
        assert.equal(getProfessionRankForXp('vanguard', 0), 1);
    });
    it('Healer needs 1.5× XP to reach Rank 2', () => {
        // Baseline Rank 2 threshold = 100, Healer = 150
        assert.equal(getProfessionRankForXp('vanguard', 100), 2);
        assert.equal(getProfessionRankForXp('healer', 100), 1);
        assert.equal(getProfessionRankForXp('healer', 150), 2);
    });
    it('caps at Rank 10', () => {
        assert.equal(getProfessionRankForXp('vanguard', 100_000), 10);
        assert.equal(getProfessionRankForXp('healer', 1_000_000), 10);
    });
});

describe('professionXpMultiplier (Vanguard Rank 2 perk)', () => {
    it('1× for non-Vanguard', () => {
        assert.equal(professionXpMultiplier('healer', 5), 1);
        assert.equal(professionXpMultiplier('petTamer', 10), 1);
    });
    it('1× for Vanguard Rank 1', () => {
        assert.equal(professionXpMultiplier('vanguard', 1), 1);
    });
    it('1.1× for Vanguard Rank 2+', () => {
        assert.equal(professionXpMultiplier('vanguard', 2), 1.1);
        assert.equal(professionXpMultiplier('vanguard', 5), 1.1);
        assert.equal(professionXpMultiplier('vanguard', 10), 1.1);
    });
});

describe('petTamerPveMultiplier', () => {
    it('1× for non-Pet Tamer', () => {
        assert.equal(petTamerPveMultiplier('healer', 5), 1);
        assert.equal(petTamerPveMultiplier(undefined, 5), 1);
    });
    it('+5% at rank 0', () => {
        assert.equal(petTamerPveMultiplier('petTamer', 0), 1.05);
    });
    it('+20% at rank 10', () => {
        assert.equal(petTamerPveMultiplier('petTamer', 10), 1.20);
    });
});

describe('petTamerTrainingSpeedPct', () => {
    it('0 for non-Pet Tamer', () => {
        assert.equal(petTamerTrainingSpeedPct('healer', 5), 0);
    });
    it('10% at unlock, 20% at rank 10', () => {
        assert.equal(petTamerTrainingSpeedPct('petTamer', 0), 10);
        assert.equal(petTamerTrainingSpeedPct('petTamer', 10), 20);
    });
});

describe('petTamerExpeditionMult', () => {
    it('1× for non-Pet Tamer', () => {
        assert.equal(petTamerExpeditionMult('vanguard', 5), 1);
    });
    it('+10% at unlock, +25% at rank 10', () => {
        assert.equal(petTamerExpeditionMult('petTamer', 0), 1.10);
        assert.equal(petTamerExpeditionMult('petTamer', 10), 1.25);
    });
});

describe('levelGapSealMultiplier', () => {
    it('full reward within 10 levels', () => {
        assert.equal(levelGapSealMultiplier(40, 30), 1);
        assert.equal(levelGapSealMultiplier(40, 50), 1);
    });
    it('50% for 10-20 below attacker', () => {
        assert.equal(levelGapSealMultiplier(50, 39), 0.5);
        assert.equal(levelGapSealMultiplier(50, 30), 0.5);
    });
    it('0 for >20 below attacker', () => {
        assert.equal(levelGapSealMultiplier(50, 29), 0);
        assert.equal(levelGapSealMultiplier(100, 1), 0);
    });
});

describe('vanguardXpForKill', () => {
    it('100 XP for level 1-30 opponents', () => {
        assert.equal(vanguardXpForKill(1), 100);
        assert.equal(vanguardXpForKill(30), 100);
    });
    it('+10 XP per level above 30', () => {
        assert.equal(vanguardXpForKill(40), 200);
        assert.equal(vanguardXpForKill(100), 800);
    });
});

describe('targetTooYoungForRewards', () => {
    it('false when no createdAt', () => {
        assert.equal(targetTooYoungForRewards(undefined), false);
    });
    it('true for accounts <72h old', () => {
        const created = Date.now() - 24 * 60 * 60 * 1000; // 24h ago
        assert.equal(targetTooYoungForRewards(created), true);
    });
    it('false for older accounts', () => {
        const created = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 days ago
        assert.equal(targetTooYoungForRewards(created), false);
    });
});

describe('vanguardSealsForKill', () => {
    const baseOpts = {
        killerProfession: 'vanguard' as const,
        killerRank: 10,
        killerLevel: 50,
        opponentName: 'bob',
        opponentLevel: 50,
        opponentCreatedAt: Date.now() - 10 * 24 * 60 * 60 * 1000, // 10 days
        todayKey: '2026-05-25',
        dailyResetDate: '2026-05-25',
        dailyHonorSealsEarned: 0,
        dailyHonorSealsByTarget: {},
    };

    it('0 for non-Vanguard', () => {
        const r = vanguardSealsForKill({ ...baseOpts, killerProfession: 'healer' });
        assert.equal(r.amount, 0);
    });
    it('Rank 10 Vanguard gets 3 Seals against a fresh target (per-target cap)', () => {
        // Base 5 Seals at Rank 10, but per-target cap of 3 limits first kill
        // against any unique target to 3.
        const r = vanguardSealsForKill(baseOpts);
        assert.equal(r.amount, 3);
    });
    it('0 against very low-level opponents', () => {
        const r = vanguardSealsForKill({ ...baseOpts, opponentLevel: 25 });
        assert.equal(r.amount, 0);
    });
    it('50% against 10-20 below', () => {
        // floor(5 * 0.5) = 2; still under per-target cap of 3 → grants 2.
        const r = vanguardSealsForKill({ ...baseOpts, opponentLevel: 39 });
        assert.equal(r.amount, 2);
    });
    it('per-target daily cap at 3', () => {
        const r = vanguardSealsForKill({
            ...baseOpts,
            dailyHonorSealsByTarget: { bob: 3 },
        });
        assert.equal(r.amount, 0);
    });
    it('updatedByTarget tracks per-target accrual', () => {
        const r = vanguardSealsForKill({ ...baseOpts, dailyHonorSealsByTarget: { bob: 1 } });
        assert.equal(r.amount, 2); // cap is 3 minus 1 already
        assert.equal(r.updatedByTarget.bob, 3);
    });
    it('0 for too-young targets', () => {
        const r = vanguardSealsForKill({ ...baseOpts, opponentCreatedAt: Date.now() - 1 * 60 * 60 * 1000 });
        assert.equal(r.amount, 0);
    });
    it('resets per-target counts on a new day', () => {
        const r = vanguardSealsForKill({
            ...baseOpts,
            todayKey: '2026-05-26',
            dailyResetDate: '2026-05-25',  // yesterday
            dailyHonorSealsByTarget: { bob: 3 },  // stale yesterday count
        });
        // Per-target cap is 3, so even on a fresh day a single kill against
        // bob earns at most 3 (Rank 10 base is 5, but capped to 3).
        assert.equal(r.amount, 3);
        assert.equal(r.updatedByTarget.bob, 3);  // resets to 0 then adds 3
    });
});
