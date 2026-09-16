import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { currentDateKey, mergeById } from './utils.js';
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

test('mergeById: replaces existing entries in place and appends new IDs in encounter order', () => {
    const first = { id: 'first', label: 'original' };
    const second = { id: 'second', label: 'unchanged' };
    const replacement = { id: 'first', label: 'updated' };
    const third = { id: 'third', label: 'new' };
    const fourth = { id: 'fourth', label: 'new' };
    const current = [first, second];
    const incoming = [third, replacement, fourth];

    const merged = mergeById(current, incoming);

    assert.deepEqual(merged, [replacement, second, third, fourth]);
    assert.equal(merged[0], replacement);
    assert.equal(merged[1], second);
    assert.equal(merged[2], third);
    assert.deepEqual(current, [first, second]);
    assert.deepEqual(incoming, [third, replacement, fourth]);
});

test('mergeById: the last duplicate wins without changing its first insertion position', () => {
    const first = { id: 'first', value: 1 };
    const second = { id: 'second', value: 2 };
    const updatedFirst = { id: 'first', value: 3 };
    const incomingFirst = { id: 'first', value: 4 };
    const third = { id: 'third', value: 5 };
    const updatedThird = { id: 'third', value: 6 };

    assert.deepEqual(mergeById([first, second, updatedFirst], []), [updatedFirst, second]);
    const merged = mergeById([first, second, updatedFirst], [third, incomingFirst, updatedThird]);
    assert.deepEqual(merged, [incomingFirst, second, updatedThird]);
    assert.equal(merged[0], incomingFirst);
    assert.equal(merged[2], updatedThird);
});

test('mergeById: empty inputs still return a fresh array and preserve item references', () => {
    const item = { id: 'only' };
    const items = [item];
    const currentOnly = mergeById(items, []);
    const incomingOnly = mergeById([], items);

    assert.deepEqual(mergeById([], []), []);
    assert.notEqual(currentOnly, items);
    assert.notEqual(incomingOnly, items);
    assert.equal(currentOnly[0], item);
    assert.equal(incomingOnly[0], item);
});
