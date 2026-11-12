import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelRequestOutcome } from './model-request-receipt';

test('a December creation shows the local reset time until the January UTC boundary', () => {
    const job = { id: 'cancelled-request', month: '2026-12', state: 'cancelled', slot: 'used' } as const;
    const reset = new Date('2027-01-01T00:00:00Z');
    const local = reset.toLocaleString(undefined, {
        month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
    assert.ok(modelRequestOutcome(job, +reset - 1).includes(local));
    assert.doesNotMatch(modelRequestOutcome(job, +reset), /resets/);
    assert.match(modelRequestOutcome({ ...job, slot: 'replaced' }), /Another request holds/);
});
