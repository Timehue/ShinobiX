import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { levelGapMult, vanguardXpForLevel, vanguardSealsForRank, rankFromXp } from './_vanguard-rewards.js';

describe('levelGapMult', () => {
    it('full reward within 10 levels (either direction)', () => {
        assert.equal(levelGapMult(40, 30), 1);
        assert.equal(levelGapMult(40, 40), 1);
        assert.equal(levelGapMult(40, 50), 1);
    });
    it('50% reward 10-20 levels below attacker', () => {
        assert.equal(levelGapMult(50, 39), 0.5);
        assert.equal(levelGapMult(50, 30), 0.5);
    });
    it('0 reward >20 levels below attacker', () => {
        assert.equal(levelGapMult(50, 29), 0);
        assert.equal(levelGapMult(100, 1), 0);
    });
    it('no penalty for fighting higher-level players', () => {
        assert.equal(levelGapMult(30, 100), 1);
    });
});

describe('vanguardXpForLevel', () => {
    it('returns 100 XP for level 1-30 opponents', () => {
        assert.equal(vanguardXpForLevel(1), 100);
        assert.equal(vanguardXpForLevel(30), 100);
    });
    it('adds +10 XP per level above 30', () => {
        assert.equal(vanguardXpForLevel(31), 110);
        assert.equal(vanguardXpForLevel(50), 300);
        assert.equal(vanguardXpForLevel(100), 800);
    });
});

describe('vanguardSealsForRank', () => {
    it('matches the rank table (1,1,2,2,3,3,4,4,5,5)', () => {
        assert.equal(vanguardSealsForRank(1), 1);
        assert.equal(vanguardSealsForRank(2), 1);
        assert.equal(vanguardSealsForRank(3), 2);
        assert.equal(vanguardSealsForRank(4), 2);
        assert.equal(vanguardSealsForRank(5), 3);
        assert.equal(vanguardSealsForRank(6), 3);
        assert.equal(vanguardSealsForRank(7), 4);
        assert.equal(vanguardSealsForRank(8), 4);
        assert.equal(vanguardSealsForRank(9), 5);
        assert.equal(vanguardSealsForRank(10), 5);
    });
    it('rank 0 returns 0 (unranked)', () => {
        assert.equal(vanguardSealsForRank(0), 0);
    });
    it('clamps above rank 10', () => {
        assert.equal(vanguardSealsForRank(99), 5);
    });
});

describe('rankFromXp (baseline curve)', () => {
    it('Rank 1 at 0 XP', () => {
        assert.equal(rankFromXp(0), 1);
    });
    it('Rank 2 at 100 XP (first threshold)', () => {
        assert.equal(rankFromXp(100), 2);
        assert.equal(rankFromXp(99), 1);
    });
    it('Rank 10 at 32,850 XP (max threshold)', () => {
        assert.equal(rankFromXp(32850), 10);
        assert.equal(rankFromXp(32849), 9);
    });
    it('caps at Rank 10 above max threshold', () => {
        assert.equal(rankFromXp(1_000_000), 10);
    });
});
