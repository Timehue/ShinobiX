import assert from 'node:assert/strict';
import test from 'node:test';
import { WARFRONT_KICKOFF_PACE_MS, warfrontKickoffWaitMs, warfrontNextStartKey } from './_warfront-pace.js';

test('the kickoff pace waits out only what is left of the minute', () => {
    const now = 1_700_000_000_000;
    assert.equal(warfrontKickoffWaitMs({ notBefore: now + 12_345 }, now), 12_345);
    assert.equal(warfrontKickoffWaitMs({ notBefore: now }, now), 0);
    assert.equal(warfrontKickoffWaitMs({ notBefore: now - 1 }, now), 0);
    assert.equal(warfrontKickoffWaitMs(null, now), 0);
    assert.equal(warfrontKickoffWaitMs({ notBefore: 'soon' }, now), 0);
});

test('a malformed far-future pace can never lock a player out for more than the minute', () => {
    const now = 1_700_000_000_000;
    assert.equal(warfrontKickoffWaitMs({ notBefore: now + 24 * 60 * 60 * 1_000 }, now), WARFRONT_KICKOFF_PACE_MS);
});

test('the pace key is per player and uncached pet authority', () => {
    assert.equal(warfrontNextStartKey('rill'), 'pet:warfront-next-start:rill');
});
