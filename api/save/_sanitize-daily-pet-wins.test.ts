import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';
import { definitionsFor } from './_state-ownership.js';

/*
 * dailyPetWins is the only thing bounding the pet-arena ryo faucet.
 * api/pet/battle-result.ts and api/pet/showdown.ts both read the counter
 * straight off the save to decide whether the 100/day cap is spent, and both
 * pay `opponentLevel * 2` ryo per win — so a save that lands a lower value
 * mid-day buys another hundred paid wins. No tampering is required for the
 * accidental version: a second tab holding a stale count zeroes it on its next
 * autosave.
 *
 * Same guard, same gate, same shape as the dailyMissionsCompleted and
 * dailyHollowGateRuns floors alongside it in the sanitizer.
 */

type Char = Record<string, unknown>;
const wrap = (character: Char) => ({ character });
const sanitize = (incoming: Char, existing: Char | null) =>
    sanitizeCharacterSave(wrap(incoming), existing ? wrap(existing) : null).character as Record<string, any>;

const TODAY = new Date().toISOString().slice(0, 10); // matches the sanitizer's SERVER_UTC_DATE

test('dailyPetWins: a save carrying a lower count within the same UTC day is floored to the server count', () => {
    const out = sanitize(
        { lastDailyReset: TODAY, dailyPetWins: 0 },    // stale tab (or forged): cap looks unspent
        { lastDailyReset: TODAY, dailyPetWins: 100 },  // server-stored: cap already spent today
    );
    assert.equal(out.dailyPetWins, 100, 'cannot drop below the server-recorded pet wins for today');
});

test('dailyPetWins: a partial rollback within the day is floored too', () => {
    const out = sanitize(
        { lastDailyReset: TODAY, dailyPetWins: 7 },
        { lastDailyReset: TODAY, dailyPetWins: 41 },
    );
    assert.equal(out.dailyPetWins, 41, 'the floor is the stored value, not merely non-negative');
});

test('dailyPetWins: legit same-day increment kept; genuine new-day reset untouched', () => {
    assert.equal(
        sanitize({ lastDailyReset: TODAY, dailyPetWins: 6 }, { lastDailyReset: TODAY, dailyPetWins: 5 }).dailyPetWins,
        6,
        'legit increment 5->6 kept',
    );
    assert.equal(
        sanitize({ lastDailyReset: TODAY, dailyPetWins: 0 }, { lastDailyReset: '2000-01-01', dailyPetWins: 100 }).dailyPetWins,
        0,
        'a real UTC day roll still resets the counter to 0',
    );
});

test('dailyPetWins: a missing incoming value cannot erase the same-day count', () => {
    // Dropping the field entirely is the cheapest possible bypass, so `?? 0`
    // must resolve to the floor rather than to an absent field the readers then
    // treat as zero wins.
    const out = sanitize({ lastDailyReset: TODAY }, { lastDailyReset: TODAY, dailyPetWins: 88 });
    assert.equal(out.dailyPetWins, 88, 'an omitted counter is refilled from the stored value');
});

test('dailyPetWins: negative and fractional values normalize like its neighbours', () => {
    assert.equal(
        sanitize({ lastDailyReset: TODAY, dailyPetWins: -50 }, { lastDailyReset: TODAY, dailyPetWins: 3 }).dailyPetWins,
        3,
        'a negative count cannot buy headroom under the cap',
    );
    assert.equal(
        sanitize({ lastDailyReset: TODAY, dailyPetWins: 9.9 }, { lastDailyReset: TODAY, dailyPetWins: 0 }).dailyPetWins,
        9,
        'floored to an integer, same as dailyMissionsCompleted',
    );
});

test('dailyPetWins is classified as a server-clamped field, matching its neighbours', () => {
    // The manifest is what an auditor reads to decide whether a counter is
    // guarded. Leaving it tagged client-state while the floor exists (or the
    // reverse) is exactly the drift the manifest is meant to prevent.
    const defs = definitionsFor('dailyPetWins').filter((d) => d.scope === 'character');
    assert.equal(defs.length, 1, 'exactly one character-scope entry');
    assert.equal(defs[0].category, 'server-clamped');
    assert.match(String(defs[0].note ?? ''), /floored at stored within the same UTC day/);
});
