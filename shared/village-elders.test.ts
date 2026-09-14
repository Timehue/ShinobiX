import assert from 'node:assert/strict';
import test from 'node:test';
import { elderFocusForSeats, normalizeElderAppointees } from './village-elders.js';

test('AI, malformed and duplicate seats do not unlock focuses', () => {
    for (const seats of [undefined, null, [], ['', '', ''], [true, {}, 3]]) {
        for (const focus of ['war', 'trade', 'training']) assert.equal(elderFocusForSeats(focus, seats), undefined);
    }
    assert.deepEqual(normalizeElderAppointees([' Rin ', 'rin', 'Mei', 'extra']), ['Rin', '', 'Mei']);
    assert.equal(elderFocusForSeats('trade', ['Rin', '', 'Mei']), undefined);
    assert.equal(elderFocusForSeats('training', ['Rin', '', 'Mei']), 'training');
    assert.equal(elderFocusForSeats('forged', ['Rin', 'Yura', 'Mei']), undefined);
});
