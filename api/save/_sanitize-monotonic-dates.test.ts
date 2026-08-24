import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';

// These tests pin the bounded legacy sanitizer itself. Release mode defaults
// to the stricter receipt-backed raw-save boundary and is covered separately.
process.env.STRICT_RAW_SAVE_LEDGER = '0';

/*
 * lastDailyReset / lastHuntReset: monotonic-forward AND never past the server's
 * UTC today. A device clock running ahead (or a forged stamp) used to be able
 * to pre-stamp tomorrow; because the stamp only ever advances, that could never
 * be corrected, and every same-day counter floor keyed on
 * `stored === SERVER_UTC_DATE` was skipped for a whole day.
 */

type Char = Record<string, unknown>;
const wrap = (character: Char) => ({ character });
const sanitize = (incoming: Char, existing: Char | null) =>
    sanitizeCharacterSave(wrap(incoming), existing ? wrap(existing) : null).character as Record<string, any>;

/*
 * FIXED CLOCK, deliberately. The sanitizer derives SERVER_UTC_DATE from its own
 * `new Date()` at call time, so reading the wall clock a second time out here
 * would make every assertion below a race with UTC midnight: a run that starts
 * at 23:59:59.9 computes TODAY as one date and the sanitizer computes another,
 * and the suite fails for the calendar rather than for the code. Freezing Date
 * (only Date — timers are untouched) pins both reads to the same instant.
 */
const FIXED_NOW = Date.UTC(2026, 7, 22, 12, 0, 0);
before(() => mock.timers.enable({ apis: ['Date'], now: FIXED_NOW }));
after(() => mock.timers.reset());

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayOffset = (days: number) => utcDay(FIXED_NOW + days * 86_400_000);
const TODAY = utcDay(FIXED_NOW); // matches the sanitizer's SERVER_UTC_DATE
const TOMORROW = dayOffset(1);
const YESTERDAY = dayOffset(-1);

test('daily stamps: a future date is clamped to the server UTC today', () => {
    const out = sanitize({ lastDailyReset: TOMORROW, lastHuntReset: dayOffset(3) }, { lastDailyReset: YESTERDAY, lastHuntReset: YESTERDAY });
    assert.equal(out.lastDailyReset, TODAY);
    assert.equal(out.lastHuntReset, TODAY);
});

test('daily stamps: a future date on the very first set is clamped too', () => {
    const out = sanitize({ lastDailyReset: TOMORROW }, {});
    assert.equal(out.lastDailyReset, TODAY);
});

test('daily stamps: backdating is still reverted to the stored stamp', () => {
    const out = sanitize({ lastDailyReset: YESTERDAY }, { lastDailyReset: TODAY });
    assert.equal(out.lastDailyReset, TODAY);
});

test('daily stamps: the legit midnight roll (yesterday -> today) passes', () => {
    const out = sanitize({ lastDailyReset: TODAY, dailyMissionsCompleted: 0 }, { lastDailyReset: YESTERDAY, dailyMissionsCompleted: 9 });
    assert.equal(out.lastDailyReset, TODAY);
    assert.equal(out.dailyMissionsCompleted, 0, 'a real new day frees the counter');
});

test('daily stamps: a stored future stamp (pre-clamp tamper) may come back to today instead of pinning', () => {
    const out = sanitize({ lastDailyReset: TODAY }, { lastDailyReset: TOMORROW });
    assert.equal(out.lastDailyReset, TODAY);
});

test('daily stamps: clamping a future stamp to today keeps the same-day counter floors keyed on the stored stamp', () => {
    // Stored says today with 5 missions done; the client pre-stamps tomorrow and
    // zeroes the counter. The stamp comes back to today and the floor holds.
    const out = sanitize({ lastDailyReset: TOMORROW, dailyMissionsCompleted: 0, dailyPetWins: 0 }, { lastDailyReset: TODAY, dailyMissionsCompleted: 5, dailyPetWins: 3 });
    assert.equal(out.lastDailyReset, TODAY);
    assert.equal(out.dailyMissionsCompleted, 5);
    assert.equal(out.dailyPetWins, 3);
    const hunt = sanitize({ lastHuntReset: TOMORROW, dailyHuntsCompleted: 0 }, { lastHuntReset: TODAY, dailyHuntsCompleted: 4 });
    assert.equal(hunt.lastHuntReset, TODAY);
    assert.equal(hunt.dailyHuntsCompleted, 4);
});

test('daily stamps: an absent incoming stamp is left alone', () => {
    const out = sanitize({}, { lastDailyReset: TODAY });
    assert.equal(out.lastDailyReset, undefined);
});
