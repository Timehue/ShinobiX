import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankedMatchTokenKey } from './_ranked-match-token.js';

// The token's security rests on the KEY: it must identify the unordered pair of
// fighters on a specific ladder, so a token minted for (A,B) on the player
// ladder is found regardless of which fighter creates the session, and can NOT
// be confused with a different pair or the pet ladder. mint/consume are thin
// kv.set/kv.del wrappers (kv.del's row count gives the atomic single-use check),
// so the key derivation is the load-bearing logic to pin down here.

test('rankedMatchTokenKey is independent of fighter order', () => {
    assert.equal(
        rankedMatchTokenKey('Alice', 'Bob', 'player'),
        rankedMatchTokenKey('Bob', 'Alice', 'player'),
    );
});

test('rankedMatchTokenKey separates the player and pet ladders', () => {
    assert.notEqual(
        rankedMatchTokenKey('Alice', 'Bob', 'player'),
        rankedMatchTokenKey('Alice', 'Bob', 'pet'),
    );
});

test('rankedMatchTokenKey canonicalizes names via safeName', () => {
    // safeName lowercases and strips non [a-z0-9-_]; display casing / spaces /
    // punctuation must resolve to the same key as the stored slug.
    assert.equal(
        rankedMatchTokenKey('Alice', 'Bob', 'player'),
        rankedMatchTokenKey('  ALICE ', 'B!o!b', 'player'),
    );
});

test('rankedMatchTokenKey distinguishes different pairs', () => {
    assert.notEqual(
        rankedMatchTokenKey('alice', 'bob', 'player'),
        rankedMatchTokenKey('alice', 'carol', 'player'),
    );
});

test('rankedMatchTokenKey has the expected shape', () => {
    // Sorted slugs, ladder in the middle segment.
    assert.equal(
        rankedMatchTokenKey('Bob', 'Alice', 'player'),
        'pvp:ranked-match-token:player:alice:bob',
    );
});
