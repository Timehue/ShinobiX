import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { territoryGuardsAfterSelfUpdate } from './_territory-guard.js';

describe('territory guard mutation authority', () => {
    it('allows a player to add and remove only themselves', () => {
        assert.deepEqual(
            territoryGuardsAfterSelfUpdate(['Alice'], ['Alice', 'Bob'], 'bob'),
            ['Alice', 'Bob'],
        );
        assert.deepEqual(
            territoryGuardsAfterSelfUpdate(['Alice', 'Bob'], ['Alice'], 'bob'),
            ['Alice'],
        );
    });

    it('rejects replacing or removing another guard', () => {
        assert.equal(territoryGuardsAfterSelfUpdate(['Alice'], ['Mallory'], 'bob'), null);
        assert.equal(territoryGuardsAfterSelfUpdate(['Alice', 'Bob'], ['Bob'], 'bob'), null);
    });

    it('preserves authoritative order and display names on a no-op', () => {
        assert.deepEqual(
            territoryGuardsAfterSelfUpdate(['Alice', 'BOB'], ['bob', 'Alice'], 'bob'),
            ['Alice', 'BOB'],
        );
    });
});
