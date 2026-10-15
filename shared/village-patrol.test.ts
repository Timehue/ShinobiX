import test from 'node:test';
import assert from 'node:assert/strict';
import { patrolGreeting, patrolNameFor, patrolStance } from './village-patrol.js';

test('a patrol answers to the village that holds its road', () => {
    assert.equal(patrolStance('', 'Leaf', []), null, 'an unclaimed road keeps the neutral patrol');
    assert.equal(patrolStance(undefined, 'Leaf', ['Mist']), null);
    assert.equal(patrolStance('Leaf', 'leaf', []), 'home', 'case-insensitive');
    assert.equal(patrolStance('Mist', 'Leaf', []), 'rival');
    assert.equal(patrolStance('Mist', 'Leaf', ['Sand']), 'rival', 'a war with someone else is not a war with the holder');
    assert.equal(patrolStance('Mist', 'Leaf', ['Mist']), 'rivalWar');
    assert.equal(patrolStance('Mist', '', ['Mist']), 'rivalWar', 'a villageless player is still an enemy of a warring holder');
});

test('a claimed road names its patrol for the holder, and every stance has a voice', () => {
    assert.equal(patrolNameFor('Mist', 'rival', 'Storm Road Patrol'), 'Mist Patrol');
    assert.equal(patrolNameFor('', null, 'Storm Road Patrol'), 'Storm Road Patrol');
    for (const stance of ['home', 'rival', 'rivalWar'] as const) {
        for (const seed of [0, 1, 2, 7, -3]) assert.ok(patrolGreeting(stance, seed).length > 10);
    }
});
