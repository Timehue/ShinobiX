import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SparCoach } from './SparCoach';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const opening = { attacked: false, casted: false, enemyHp: 50, enemyMaxHp: 50, enemyInMelee: false, myTurn: true, outOfActions: false, canAttack: false, canMove: true, canCastJutsu: true };
const hint = (overrides: Partial<typeof opening>) => renderToStaticMarkup(createElement(SparCoach, { ...opening, ...overrides }));

test('a distant novice learns movement before melee, then the actual Attack control', () => {
    assert.match(hint({}), /Move.*lit tile/);
    assert.match(hint({ enemyInMelee: true, canAttack: true }), /Tap Attack/);
});

test('unavailable actions never override turn or AP guidance', () => {
    assert.match(hint({ myTurn: false }), /Dummy&#x27;s turn/);
    assert.match(hint({ outOfActions: true }), /Tap Wait/);
    assert.match(hint({ canMove: false, canCastJutsu: false }), /Tap Wait/);
    assert.match(hint({ canMove: false, canCastJutsu: true }), /Choose a jutsu/);
});

test('the first attack leads to a usable jutsu, and victory removes the hint', () => {
    assert.match(hint({ attacked: true, enemyInMelee: true, canAttack: true }), /Choose a jutsu/);
    assert.match(hint({ attacked: true, canMove: false, canCastJutsu: false }), /Tap Wait/);
    assert.match(hint({ attacked: true, casted: true, enemyInMelee: true, canAttack: true, canCastJutsu: false, enemyHp: 10 }), /Finish the dummy with Attack\./);
    assert.equal(hint({ enemyHp: 0 }), '');
});
