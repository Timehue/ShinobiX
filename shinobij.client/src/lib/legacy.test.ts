import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyAvailabilityAllowed } from './legacy.js';

test('server availability is authoritative across the Legacy preference matrix', () => {
    assert.equal(legacyAvailabilityAllowed(true, true), true);
    assert.equal(legacyAvailabilityAllowed(false, true), false);
    assert.equal(legacyAvailabilityAllowed(true, false), false);
    assert.equal(legacyAvailabilityAllowed(false, false), false);
    assert.equal(legacyAvailabilityAllowed(true, null), false, 'unknown availability must not expose a dead action');
});
