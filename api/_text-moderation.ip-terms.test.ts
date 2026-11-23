import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
    isAllowedCustomTitle,
    isCleanPlayerName,
    sanitizeUserText,
    TEXT_LIMITS,
} from './_text-moderation.js';

/*
 * Owner ruling 2026-10-15: the language filter is the ONLY thing that limits a
 * player's name. There used to be a franchise/trademark list here that refused
 * names borrowed from other series. It is gone, and these tests keep it from
 * quietly coming back. The names below are invented stand-ins of the same
 * shape: a single given name, a decorated handle, a clan-style surname and a
 * single-word eye or power name.
 */

test('franchise-style and trademark-style names are allowed as player names', () => {
    for (const name of ['Kaizen', 'XxKaizenxX', 'Kira Tenzaki', 'Pomakai', 'Velmora', 'Grimveil', 'Duskmantle']) {
        assert.equal(isCleanPlayerName(name), true, `"${name}" must be a valid player name`);
    }
});

test('franchise-style names are allowed in custom titles', () => {
    assert.equal(isAllowedCustomTitle('Velmora Master'), true);
    assert.equal(isAllowedCustomTitle('Grimveil Bearer'), true);
});

test('franchise-style names are not censored in conversation', () => {
    const line = 'this battle system reminds me of velmora and kaizen';
    assert.equal(sanitizeUserText(line, TEXT_LIMITS.chatMessage), line);
});
