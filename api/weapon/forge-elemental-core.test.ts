import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ELEMENTAL_SHARDS_PER_CORE, forgeElementalCore } from './forge-elemental-core.js';

describe('Elemental Core forging', () => {
    it('atomically converts ten stacked shards into one counted core', () => {
        const result = forgeElementalCore({
            inventory: [],
            itemStacks: [{ itemId: 'elemental-shard', count: 12 }],
        });
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.deepEqual(result.character.itemStacks, [
            { itemId: 'elemental-shard', count: 2 },
            { itemId: 'elemental-core', count: 1 },
        ]);
        assert.equal(result.value.shardsSpent, ELEMENTAL_SHARDS_PER_CORE);
    });

    it('supports legacy inline shards and refuses an insufficient balance', () => {
        const forged = forgeElementalCore({
            inventory: Array.from({ length: 10 }, () => 'elemental-shard'),
            itemStacks: [{ itemId: 'elemental-core', count: 2 }],
        });
        assert.equal(forged.ok, true);
        if (forged.ok) {
            assert.deepEqual(forged.character.inventory, []);
            assert.deepEqual(forged.character.itemStacks, [{ itemId: 'elemental-core', count: 3 }]);
        }
        assert.equal(forgeElementalCore({ inventory: ['elemental-shard'], itemStacks: [] }).ok, false);
    });
});
