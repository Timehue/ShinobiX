import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { currentDateKey } from './utils.js';
import { noteServerTime, resetServerClock } from './server-clock.js';

beforeEach(() => resetServerClock());

const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

test('currentDateKey: with no server sample it is the device UTC date', () => {
    assert.equal(currentDateKey(), dateOf(Date.now()));
});

test('currentDateKey: follows the server clock across midnight, not the device clock', () => {
    const local = Date.now();
    // Push the server two days ahead so the key must differ from the device's
    // date whatever the time of day the test runs.
    const server = local + 2 * 86_400_000;
    noteServerTime(server, local, local);
    assert.equal(currentDateKey(), dateOf(server));
    assert.notEqual(currentDateKey(), dateOf(local));
});
