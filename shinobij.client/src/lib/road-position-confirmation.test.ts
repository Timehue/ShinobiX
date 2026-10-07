import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoadPositionConfirmation } from './road-position-confirmation';

test('a road waits for the accepted sector and tile rather than an older heartbeat', async () => {
    let beats = 0;
    const confirmation = createRoadPositionConfirmation(() => { beats++; });
    let settled = false;
    const result = confirmation.request(9, 71).then(value => { settled = true; return value; });
    confirmation.observe(9, 102);
    confirmation.observe(15, 71);
    await Promise.resolve();
    assert.equal(beats, 1); assert.equal(settled, false);
    confirmation.observe(9, 71);
    assert.equal(await result, true);
    confirmation.dispose();
});

test('retiring the account releases a pending crossing without accepting it', async () => {
    const confirmation = createRoadPositionConfirmation(() => {});
    const result = confirmation.request(9, 71);
    confirmation.dispose();
    confirmation.observe(9, 71);
    assert.equal(await result, false);
});

test('unavailable confirmation times out without granting a crossing', async () => {
    const confirmation = createRoadPositionConfirmation(() => {}, 1);
    assert.equal(await confirmation.request(9, 71), false);
    confirmation.dispose();
});
