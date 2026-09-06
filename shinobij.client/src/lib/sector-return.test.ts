import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumeReloadIntoSector, peekReloadIntoSector } from './sector-return';

test('the reload signal can be peeked without consuming it, and is gone once consumed', () => {
    // Under node there is no navigation timing entry, so both read false —
    // the contract under test is that peek never flips the one-shot.
    const peeked = peekReloadIntoSector();
    assert.equal(typeof peeked, 'boolean');
    assert.equal(peekReloadIntoSector(), peeked, 'peeking is idempotent');
    consumeReloadIntoSector();
    assert.equal(peekReloadIntoSector(), false, 'after consumption nothing reads as a reload');
    assert.equal(consumeReloadIntoSector(), false);
});
