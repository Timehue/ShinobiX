import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creditPvpJutsuMastery } from './_jutsu-mastery-reward.js';
import { computePvpWinGains } from '../_xp-engine.js';
import type { PvpSession } from './session.js';
const session = (extra = {}) => ({ winner: 'p1', rewardSector: 99, rewardStronghold: 'deathsgate',
    realFighters: { p1: true, p2: true },
    p1: { character: { jutsu: [{ id: 'cast' }, { id: 'uncast' }, { id: 'legacy-test' }] } },
    jutsuUsed: { p1: ['cast', 'cast', 'forged', 'legacy-test'], p2: ['uncast'] }, ...extra }) as unknown as PvpSession;
test('mastery awards one per used jutsu, respects decay, caps and grandfathered mastery', () => {
    const char = { level: 100, jutsuMastery: [{ jutsuId: 'cast', level: 1, xp: 40 }, { jutsuId: 'uncast', level: 1, xp: 0 }] };
    const next = creditPvpJutsuMastery(char, session(), 1);
    assert.equal(next.awarded, 40);
    assert.deepEqual(next.character.jutsuMastery, [{ jutsuId: 'cast', level: 2, xp: 30 }, { jutsuId: 'uncast', level: 1, xp: 0 }]);
    assert.equal(creditPvpJutsuMastery(char, session(), 0.5).awarded, 20);
    const capped = { level: 100, jutsuMastery: [{ jutsuId: 'cast', level: 50, xp: 0 }] };
    assert.equal(creditPvpJutsuMastery(capped, session(), 1).character, capped);
    assert.equal(creditPvpJutsuMastery(char, session({ winner: 'draw' }), 1).awarded, 0);
    assert.equal(creditPvpJutsuMastery(char, session({ ranked: true }), 1).awarded, 0);
    assert.equal(creditPvpJutsuMastery(char, session({ jutsuUsed: undefined }), 1).awarded, 0);
    assert.equal(creditPvpJutsuMastery(char, session({ realFighters: { p1: true, p2: false } }), 1).awarded, 0);
    const belowCap = { level: 100, jutsuMastery: [{ jutsuId: 'cast', level: 49, xp: 2440 }] };
    assert.equal(creditPvpJutsuMastery(belowCap, session(), 1).awarded, 10);
    const grandfathered = { level: 1, jutsuMastery: [{ jutsuId: 'cast', level: 49, xp: 0 }] };
    assert.equal(creditPvpJutsuMastery(grandfathered, session(), 1).character, grandfathered);
});
test('stronghold doubles Death’s Gate base rewards only for the exact sector and stamp', () => {
    assert.equal(computePvpWinGains({}, 99, 'deathsgate').ryoGain, 300);
    assert.equal(computePvpWinGains({}, 99).ryoGain, 150);
    assert.equal(computePvpWinGains({}, 12, 'deathsgate').ryoGain, 75);
    assert.equal(computePvpWinGains({ activePetId: 'p', pets: [{ id: 'p', trait: 'Swift' }] }, 99, 'deathsgate').growthMult, 5);
});
