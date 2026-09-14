import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePendingTravel } from './player-accounts.js';

test('restored server travel uses remaining duration on either side of clock drift', () => {
    for (const now of [10_000, 1_000_000]) {
        assert.deepEqual(normalizePendingTravel({ destinationSector: 13, arrivalAt: 200_000, remainingMs: 1_500 }, now),
            { destinationSector: 13, arrivalAt: now + 1_500 });
    }
});

test('local cached masks expire instead of restarting on every restore', () => {
    const pending = normalizePendingTravel({ destinationSector: 13, arrivalAt: 200_000, remainingMs: 1_500 }, 10_000);
    assert.deepEqual(normalizePendingTravel(pending, 11_000), pending);
    assert.equal(normalizePendingTravel(pending, 11_500), null);
    assert.equal(normalizePendingTravel({ destinationSector: 13, remainingMs: 0 }, 10_000), null);
});

test('a malformed duration cannot trap the player behind a long mask', () => {
    assert.equal(normalizePendingTravel({ destinationSector: 13, remainingMs: 1e9 }, 10_000)?.arrivalAt, 20_000);
    assert.equal(normalizePendingTravel({ destinationSector: 'invalid', remainingMs: 1000 }, 10_000), null);
});
