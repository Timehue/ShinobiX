import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creditPvpJutsuMastery } from './_jutsu-mastery-reward.js';
import { computePvpWinGains } from '../_xp-engine.js';
import type { PvpSession } from './session.js';
const session = (extra = {}) => ({ winner: 'p1', rewardSector: 99, rewardStronghold: 'deathsgate',
    realFighters: { p1: true, p2: true },
    p1: { character: { jutsu: [{ id: 'cast' }, { id: 'uncast' }, { id: 'legacy-test' }] } },
    p2: { character: { jutsu: [{ id: 'uncast' }] } },
    jutsuUsed: { p1: ['cast', 'cast', 'forged', 'legacy-test'], p2: ['uncast'] }, ...extra }) as unknown as PvpSession;
const open = (extra = {}) => session({ rewardSector: 12, rewardStronghold: undefined, ...extra });

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
    const prior = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { fn(); } finally {
        for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}

test('mastery awards one per used jutsu, respects the credit factor, caps and grandfathered mastery', () => {
    withEnv({ PVP_PURSE_SCALE: undefined, PVP_MASTERY_40_49: undefined }, () => {
        const char = { level: 100, jutsuMastery: [{ jutsuId: 'cast', level: 1, xp: 40 }, { jutsuId: 'uncast', level: 1, xp: 0 }] };
        // The anchored purse is live by default, so the Obsidian interior is 1.5x: floor(10 x 1.5) = 15.
        const next = creditPvpJutsuMastery(char, session(), 1);
        assert.equal(next.awarded, 15);
        assert.deepEqual(next.character.jutsuMastery, [{ jutsuId: 'cast', level: 2, xp: 5 }, { jutsuId: 'uncast', level: 1, xp: 0 }]);
        assert.equal(creditPvpJutsuMastery(char, session(), 0.5).awarded, 7);
        assert.equal(creditPvpJutsuMastery(char, session(), 0).awarded, 0, 'a fight that pays no ryo pays no mastery');
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
});

test('the legacy 75-flat purse keeps the old x4 stronghold mastery', () => {
    withEnv({ PVP_PURSE_SCALE: '0' }, () => {
        const char = { level: 100, jutsuMastery: [{ jutsuId: 'cast', level: 1, xp: 40 }] };
        const next = creditPvpJutsuMastery(char, session(), 1);
        assert.equal(next.awarded, 40);
        assert.deepEqual(next.character.jutsuMastery, [{ jutsuId: 'cast', level: 2, xp: 30 }]);
        assert.equal(creditPvpJutsuMastery(char, session(), 0.5).awarded, 20);
    });
});

test('Lv40-49 rows earn 60 a win and 30 an engaged loss per valid fight (#23)', () => {
    withEnv({ PVP_PURSE_SCALE: undefined, PVP_MASTERY_40_49: undefined }, () => {
        const row = (level: number) => ({ level: 100, jutsuMastery: [{ jutsuId: 'cast', level, xp: 0 }, { jutsuId: 'uncast', level, xp: 0 }] });
        assert.equal(creditPvpJutsuMastery(row(40), open(), 1).awarded, 60);
        assert.equal(creditPvpJutsuMastery(row(40), session(), 1).awarded, 90, 'Obsidian 1.5x');
        assert.equal(creditPvpJutsuMastery(row(39), open(), 1).awarded, 10);
        assert.equal(creditPvpJutsuMastery(row(45), open(), 0.5).awarded, 30);
        // The loser is credited for its own side's casts only.
        assert.equal(creditPvpJutsuMastery(row(45), open(), 1, 'loss').awarded, 30);
        assert.equal(creditPvpJutsuMastery(row(39), open(), 1, 'loss').awarded, 0);
        const lossRows = creditPvpJutsuMastery(row(45), open(), 1, 'loss').character.jutsuMastery as Array<{ jutsuId: string; xp: number }>;
        assert.deepEqual(lossRows.map((r) => [r.jutsuId, r.xp]), [['cast', 0], ['uncast', 30]]);
    });
    withEnv({ PVP_MASTERY_40_49: '0' }, () => {
        const row = { level: 100, jutsuMastery: [{ jutsuId: 'cast', level: 40, xp: 0 }, { jutsuId: 'uncast', level: 45, xp: 0 }] };
        assert.equal(creditPvpJutsuMastery(row, open(), 1).awarded, 10, 'switch off: today\'s 10 per win');
        assert.equal(creditPvpJutsuMastery(row, open(), 1, 'loss').awarded, 0, 'switch off: no loss mastery');
    });
});

test('banked XP at or past the threshold never levels a row (I-1)', () => {
    // A forged Lv40 row holding 20,000 XP cascaded to Lv49 on one casual win,
    // because a 0-XP step still levelled and looped with `remaining` untouched.
    const forged = { level: 100, jutsuMastery: [{ jutsuId: 'cast', level: 40, xp: 20_000 }] };
    const out = creditPvpJutsuMastery(forged, session(), 1);
    assert.equal(out.awarded, 0);
    assert.equal(out.character, forged, 'the row is left exactly as stored');
    const banked = { level: 100, jutsuMastery: [{ jutsuId: 'cast', level: 1, xp: 5000 }] };
    const lvl1 = creditPvpJutsuMastery(banked, session(), 1);
    assert.equal(lvl1.awarded, 0);
    assert.deepEqual(lvl1.character.jutsuMastery, [{ jutsuId: 'cast', level: 1, xp: 5000 }]);
});

test('the legacy win wrapper keeps the 75-flat stronghold table for the exact sector and stamp', () => {
    assert.equal(computePvpWinGains({}, 99, 'deathsgate').ryoGain, 300);
    assert.equal(computePvpWinGains({}, 99).ryoGain, 150);
    assert.equal(computePvpWinGains({}, 12, 'deathsgate').ryoGain, 75);
    assert.equal(computePvpWinGains({ activePetId: 'p', pets: [{ id: 'p', trait: 'Swift' }] }, 99, 'deathsgate').ryoGain, 300);
});
