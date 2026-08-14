import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { blockListKey, sanitizeBlockList, updateBlockList } from './_blocks.js';

describe('player block lists', () => {
    it('canonicalizes, de-duplicates, and uses an owner-scoped key', () => {
        assert.deepEqual(sanitizeBlockList([' Bob ', 'BOB', '', null]), ['bob']);
        assert.equal(blockListKey(' Alice '), 'player-blocks:alice');
    });

    it('blocks and unblocks idempotently', () => {
        assert.deepEqual(updateBlockList(['bob'], 'BOB', true), ['bob']);
        assert.deepEqual(updateBlockList(['bob', 'cara'], 'Bob', false), ['cara']);
    });
});
