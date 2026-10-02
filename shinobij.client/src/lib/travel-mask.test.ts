import { test } from 'node:test';
import assert from 'node:assert/strict';
import { travelMaskMs, travelMaskStartedAt, TRAVEL_MASK_MS, TRAVEL_MASK_MAX_MS } from './travel-mask.js';
import { WORLD_TRAVEL_MS } from '../../../api/player/travel.js';

test('the mask fallback matches the server travel duration', () => {
    assert.equal(TRAVEL_MASK_MS, WORLD_TRAVEL_MS);
});

test('the server duration is used verbatim', () => {
    assert.equal(travelMaskMs(WORLD_TRAVEL_MS), 3_000);
    assert.equal(travelMaskMs(0), 0); // already in the destination sector
});

test('a server predating travelMs falls back to the three-second mask', () => {
    assert.equal(travelMaskMs(undefined), TRAVEL_MASK_MS);
    assert.equal(travelMaskMs(null), TRAVEL_MASK_MS);
    assert.equal(travelMaskMs('not a number'), TRAVEL_MASK_MS);
    assert.equal(travelMaskMs(NaN), TRAVEL_MASK_MS);
});

test('no answer can strand a player behind the mask', () => {
    assert.equal(travelMaskMs(183_000), TRAVEL_MASK_MAX_MS); // the clock-drift symptom
    assert.equal(travelMaskMs(Infinity), TRAVEL_MASK_MS);    // non-finite is garbage, not a long trip
    assert.equal(travelMaskMs(-5_000), 0);
});

// The whole point of the helper: the mask is derived from the DURATION, so a
// server clock running minutes away from the player's cannot reach the timer.
test('a skewed server clock cannot inflate the mask', () => {
    const skewMs = 180_000;
    const serverNow = Date.now() + skewMs;           // server three minutes ahead
    const arrivalAt = serverNow + WORLD_TRAVEL_MS;   // what the response carries
    assert.equal(arrivalAt - Date.now() > 180_000, true); // the old math: 183s
    assert.equal(travelMaskMs(WORLD_TRAVEL_MS), 3_000);   // the new math: 3s
});

// A refresh mid-trip mounts the mask in the loading fallback, then again in
// WorldMap once its chunk lands. The second mount must continue the bar.
test('a second mask for the same trip keeps the first one\'s start', () => {
    const arrivalAt = 1_000_000_000_000;
    assert.equal(travelMaskStartedAt(arrivalAt, 500), 500);
    assert.equal(travelMaskStartedAt(arrivalAt, 2_100), 500);
});

test('a new trip starts its own bar', () => {
    assert.equal(travelMaskStartedAt(2_000_000_000_000, 100), 100);
    assert.equal(travelMaskStartedAt(2_000_000_003_000, 3_200), 3_200);
    assert.equal(travelMaskStartedAt(2_000_000_003_000, 4_000), 3_200);
});
