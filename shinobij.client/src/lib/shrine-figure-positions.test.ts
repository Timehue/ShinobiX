import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shrineFigurePositions } from './shrine-figure-positions';

test('only shared tiles spread their occupants, including an optimistic local step', () => {
    const players = [{ tile: 0 }, { tile: 12 }, { tile: 12 }, { tile: 143 }];
    const spots = shrineFigurePositions(players, players[0], 12);
    assert.equal(spots[3].left, 11.5 * 100 / 12);
    assert.deepEqual(spots.slice(0, 3).map(spot => spot.top), [12.5, 12.5, 12.5]);
    assert.equal(new Set(spots.slice(0, 3).map(spot => spot.left)).size, 3);
    assert.ok(spots.slice(0, 3).every(spot => spot.left > 0 && spot.left < 100 / 12));
});
