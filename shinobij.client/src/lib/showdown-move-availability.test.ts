import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ShowdownPetView } from '../../../shared/pet-showdown-contract';
import { showdownMoveAvailability } from './showdown-move-availability';

const move = { hold: 0, unlockLevel: 5, availableAtRound: 8 } as ShowdownPetView['moves'][number];
test('level and reuse gates are inclusive at their exact server boundary', () => {
    assert.equal(showdownMoveAvailability(move, { level: 4, readiness: 10 }, 8).label, 'Lv 5');
    assert.equal(showdownMoveAvailability(move, { level: 5, readiness: 10 }, 7).label, 'R8');
    assert.equal(showdownMoveAvailability(move, { level: 5, readiness: 10 }, 8).blocked, false);
});
test('field readiness stays distinct from absolute reuse round and supports legacy moves', () => {
    const legacy = { hold: 2 } as ShowdownPetView['moves'][number];
    assert.equal(showdownMoveAvailability(legacy, { level: 1, readiness: 1 }, 20).blocked, true);
    assert.equal(showdownMoveAvailability(legacy, { level: 1, readiness: 2 }, 20).blocked, false);
});

test('an unavailable legacy signature stays disabled despite level, meter or readiness', () => {
    const unavailable = { abilityId: 'unavailable:signature', hold: 0, unlockLevel: 20 } as ShowdownPetView['moves'][number];
    const availability = showdownMoveAvailability(unavailable, { level: 100, readiness: 25 }, 26);
    assert.equal(availability.blocked, true);
    assert.equal(availability.label, 'Unavailable');
});
