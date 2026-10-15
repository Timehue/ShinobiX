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
 * names like "Naruto" or "Pokemon Master". It is gone, and these tests keep it
 * from quietly coming back.
 */

test('franchise and trademark names are allowed as player names', () => {
    for (const name of ['Naruto', 'XxNarutoxX', 'Kira Uchiha', 'Pikachu', 'Pokemon', 'Sharingan', 'Akatsuki']) {
        assert.equal(isCleanPlayerName(name), true, `"${name}" must be a valid player name`);
    }
});

test('franchise names are allowed in custom titles', () => {
    assert.equal(isAllowedCustomTitle('Pokemon Master'), true);
    assert.equal(isAllowedCustomTitle('Sharingan Bearer'), true);
});

test('franchise names are not censored in conversation', () => {
    const line = 'this battle system reminds me of pokemon and naruto';
    assert.equal(sanitizeUserText(line, TEXT_LIMITS.chatMessage), line);
});
