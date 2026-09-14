import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';
import { definitionsFor } from './_state-ownership.js';
import { mergePreservingImages } from '../_utils.js';

/*
 * dailyFateSpins bounds the free Sunscar Fate Dice. api/festival/sunscar.ts
 * reads the counter off the save to decide whether the five-a-day cap is spent,
 * and every draw pays ryo and stat points, with a Fate Shard on a triple. So it
 * gets the same same-day floor as dailyPetWins and dailyMissionsCompleted: a
 * save carrying a lower count (a stale second tab is enough) must not reopen it.
 *
 * Every same-day floor, and every cap reader, keys on the lastDailyReset stamp,
 * so these tests also pin that a save cannot blank the stamp and that a
 * non-numeric counter cannot turn into the null that readers treat as zero.
 */

type Char = Record<string, unknown>;
const wrap = (character: Char) => ({ character });
const sanitize = (incoming: Char, existing: Char | null) =>
    sanitizeCharacterSave(wrap(incoming), existing ? wrap(existing) : null).character as Record<string, any>;

/** What the save endpoint actually persists: the sanitized payload merged over
 *  the stored record, then serialized to JSON (NaN and Infinity become null). */
const persisted = (incoming: Char, existing: Char) =>
    (JSON.parse(JSON.stringify(mergePreservingImages(sanitizeCharacterSave(wrap(incoming), wrap(existing)), wrap(existing)))) as {
        character: Record<string, any>;
    }).character;

// Fixed clock, so the sanitizer's own `new Date()` and TODAY below can never
// straddle UTC midnight and fail the suite for the calendar.
const FIXED_NOW = Date.UTC(2026, 8, 14, 12, 0, 0);
before(() => mock.timers.enable({ apis: ['Date'], now: FIXED_NOW }));
after(() => mock.timers.reset());
const TODAY = new Date(FIXED_NOW).toISOString().slice(0, 10);
const YESTERDAY = new Date(FIXED_NOW - 86_400_000).toISOString().slice(0, 10);

test('dailyFateSpins: a lower count within the same UTC day is floored to the stored count', () => {
    const out = sanitize({ lastDailyReset: TODAY, dailyFateSpins: 0 }, { lastDailyReset: TODAY, dailyFateSpins: 5 });
    assert.equal(out.dailyFateSpins, 5, 'the cap stays spent for the rest of the day');
    const partial = sanitize({ lastDailyReset: TODAY, dailyFateSpins: 2 }, { lastDailyReset: TODAY, dailyFateSpins: 4 });
    assert.equal(partial.dailyFateSpins, 4, 'the floor is the stored value, not merely non-negative');
});

test('dailyFateSpins: a legit increment is kept and a genuine new UTC day still resets it', () => {
    assert.equal(sanitize({ lastDailyReset: TODAY, dailyFateSpins: 3 }, { lastDailyReset: TODAY, dailyFateSpins: 2 }).dailyFateSpins, 3);
    const newDay = sanitize({ lastDailyReset: TODAY, dailyFateSpins: 0 }, { lastDailyReset: YESTERDAY, dailyFateSpins: 5 });
    assert.equal(newDay.dailyFateSpins, 0, 'yesterday\'s spins do not carry into today');
    assert.equal(newDay.lastDailyReset, TODAY);
});

test('dailyFateSpins: an omitted counter is refilled from the stored value', () => {
    assert.equal(sanitize({ lastDailyReset: TODAY }, { lastDailyReset: TODAY, dailyFateSpins: 4 }).dailyFateSpins, 4);
});

test('dailyFateSpins: negative, fractional and non-numeric values normalize to the floor', () => {
    const stored = { lastDailyReset: TODAY, dailyFateSpins: 3 };
    assert.equal(sanitize({ lastDailyReset: TODAY, dailyFateSpins: -50 }, stored).dailyFateSpins, 3);
    assert.equal(sanitize({ lastDailyReset: TODAY, dailyFateSpins: 4.9 }, stored).dailyFateSpins, 4);
    for (const junk of ['x', 'Infinity', Number.POSITIVE_INFINITY, Number.NaN, {}]) {
        const out = persisted({ lastDailyReset: TODAY, dailyFateSpins: junk }, stored);
        assert.equal(out.dailyFateSpins, 3, `${JSON.stringify(junk)} is written as the stored count, not as null`);
    }
});

test('daily stamps: a blank or non-string stamp keeps the stored stamp, so the floors still apply', () => {
    const stored = { lastDailyReset: TODAY, dailyFateSpins: 5, dailyPetWins: 100, dailyMissionsCompleted: 30 };
    for (const blank of ['', null, 0, false, 20260914]) {
        const out = persisted({ lastDailyReset: blank, dailyFateSpins: 0, dailyPetWins: 0, dailyMissionsCompleted: 0 }, stored);
        assert.equal(out.lastDailyReset, TODAY, `${JSON.stringify(blank)} does not erase today's stamp`);
        assert.equal(out.dailyFateSpins, 5);
        assert.equal(out.dailyPetWins, 100);
        assert.equal(out.dailyMissionsCompleted, 30);
    }
    const hunt = persisted({ lastHuntReset: '', dailyHuntsCompleted: 0 }, { lastHuntReset: TODAY, dailyHuntsCompleted: 9 });
    assert.equal(hunt.lastHuntReset, TODAY, 'the hunt stamp gets the same protection');
    assert.equal(hunt.dailyHuntsCompleted, 9);
});

test('daily stamps: an omitted stamp survives the write through the endpoint merge', () => {
    const out = persisted({ dailyFateSpins: 0 }, { lastDailyReset: TODAY, dailyFateSpins: 5 });
    assert.equal(out.lastDailyReset, TODAY);
    assert.equal(out.dailyFateSpins, 5);
});

test('daily stamps: a blank stamp on a save with no stored stamp changes nothing', () => {
    // Nothing to protect: no floor applies without a stored same-day stamp.
    assert.equal(sanitize({ lastDailyReset: '' }, { dailyFateSpins: 2 }).lastDailyReset, '');
});

test('same-day floors: a non-numeric counter is written as the stored count, never as null', () => {
    const stored = {
        lastDailyReset: TODAY, lastHuntReset: TODAY,
        dailyMissionsCompleted: 30, dailyPetWins: 100, dailyHuntsCompleted: 9, dailyHollowGateRuns: 2,
    };
    const out = persisted({
        lastDailyReset: TODAY, lastHuntReset: TODAY,
        dailyMissionsCompleted: 'x', dailyPetWins: Number.NaN, dailyHuntsCompleted: Number.POSITIVE_INFINITY, dailyHollowGateRuns: 'x',
    }, stored);
    assert.equal(out.dailyMissionsCompleted, 30);
    assert.equal(out.dailyPetWins, 100);
    assert.equal(out.dailyHuntsCompleted, 9);
    assert.equal(out.dailyHollowGateRuns, 2);
});

test('dailyFateSpins is classified as a server-clamped field, like the other floored counters', () => {
    const defs = definitionsFor('dailyFateSpins').filter((d) => d.scope === 'character');
    assert.equal(defs.length, 1, 'exactly one character-scope entry');
    assert.equal(defs[0].category, 'server-clamped');
    assert.match(String(defs[0].note ?? ''), /floored at stored within the same UTC day/);
});
