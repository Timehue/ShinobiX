import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heldDirection } from './held-direction';

const unit = (p: { x: number; y: number }) => Math.abs(Math.hypot(p.x, p.y) - 1) < 1e-12;
/** Within a degree of the 45-degree heading (sx, sy): the walker and the figure's
 *  eight facings both read it as that diagonal. */
const diagonal = (p: { x: number; y: number }, sx: number, sy: number) =>
    unit(p) && Math.sign(p.x) === sx && Math.sign(p.y) === sy && Math.abs(Math.abs(p.x) - Math.abs(p.y)) < .02;

test('one movement key walks straight', () => {
    assert.deepEqual(heldDirection(['d']), { x: 1, y: 0 });
    assert.deepEqual(heldDirection(['arrowup']), { x: 0, y: -1 });
    assert.equal(heldDirection([]), null);
});

test('two keys at right angles walk diagonally, in either order', () => {
    assert(diagonal(heldDirection(['w', 'd'])!, 1, -1));
    assert(diagonal(heldDirection(['d', 'w'])!, 1, -1));
    assert(diagonal(heldDirection(['s', 'a'])!, -1, 1));
    assert(diagonal(heldDirection(['arrowdown', 'arrowright'])!, 1, 1));
});

test('a diagonal leans toward the newest key, so a shut corner slides along it', () => {
    const wThenD = heldDirection(['w', 'd'])!, dThenW = heldDirection(['d', 'w'])!;
    assert(Math.abs(wThenD.x) > Math.abs(wThenD.y), 'D pressed last leans east');
    assert(Math.abs(dThenW.y) > Math.abs(dThenW.x), 'W pressed last leans north');
});

test('releasing one key of a diagonal straightens it', () => {
    const keys = ['w', 'd'];
    keys.splice(keys.indexOf('w'), 1);
    assert.deepEqual(heldDirection(keys), { x: 1, y: 0 });
});

test('opposite keys do not cancel: the newest wins, with any key at right angles', () => {
    assert.deepEqual(heldDirection(['w', 's']), { x: 0, y: 1 });
    assert(diagonal(heldDirection(['d', 'w', 's'])!, 1, 1), 'S leads, D is the nearest key at right angles');
    assert.deepEqual(heldDirection(['w', 'arrowup']), { x: 0, y: -1 }, 'two keys for the same heading stay straight');
});
