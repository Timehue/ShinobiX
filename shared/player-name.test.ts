import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayPlayerName } from './player-name.js';

test('capitalizes the first letter of each word', () => {
    assert.equal(displayPlayerName('rill'), 'Rill');
    assert.equal(displayPlayerName('storm walker'), 'Storm Walker');
    assert.equal(displayPlayerName('  kenji '), 'Kenji');
});

test('leaves the rest of the name as typed', () => {
    assert.equal(displayPlayerName('McKay'), 'McKay');
    assert.equal(displayPlayerName('xX_shadow_Xx'), 'XX_shadow_Xx');
    assert.equal(displayPlayerName('dark-wolf99'), 'Dark-wolf99');
    assert.equal(displayPlayerName('99lives'), '99lives');
});

test('never changes what the name lowercases to', () => {
    assert.equal(displayPlayerName('ßora'), 'ßora');
    assert.equal(displayPlayerName('ıris'), 'ıris');
    assert.equal(displayPlayerName('élan'), 'Élan');
    for (const name of ['rill', 'storm walker', 'ßora', 'ſam', 'ıris', 'élan', 'ǆemal']) {
        assert.equal(displayPlayerName(name).toLowerCase(), name.toLowerCase(), name);
    }
});

test('handles non-strings and empty input', () => {
    assert.equal(displayPlayerName(''), '');
    assert.equal(displayPlayerName(undefined), '');
    assert.equal(displayPlayerName(42), '');
});
