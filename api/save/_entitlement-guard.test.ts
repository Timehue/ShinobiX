import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    isHighRiskTileCardId,
    isServerOwnedItemId,
    preserveEntitledStacks,
    preserveEntitledStringArray,
} from './_entitlement-guard.js';

describe('_entitlement-guard', () => {
    it('identifies server-owned items and high-rarity built-in cards', () => {
        assert.equal(isServerOwnedItemId('weekly-boss-core'), true);
        assert.equal(isServerOwnedItemId('shinobi-vest'), false);
        assert.equal(isHighRiskTileCardId('tc-41'), true);
        assert.equal(isHighRiskTileCardId('tc-121'), true);
        assert.equal(isHighRiskTileCardId('tc-21'), false);
    });

    it('preserves existing guarded inventory but drops new additions', () => {
        assert.deepEqual(
            preserveEntitledStringArray(
                ['shinobi-vest', 'weekly-boss-core', 'weekly-boss-core', 'dungeon-key'],
                ['weekly-boss-core'],
                isServerOwnedItemId,
            ),
            ['shinobi-vest', 'weekly-boss-core'],
        );
    });

    it('caps guarded stack increases to the stored entitlement', () => {
        assert.deepEqual(
            preserveEntitledStacks(
                [{ itemId: 'dungeon-legendary-fragment', count: 9 }, { itemId: 'pet-treat', count: 3 }],
                [{ itemId: 'dungeon-legendary-fragment', count: 2 }],
                isServerOwnedItemId,
            ),
            [{ itemId: 'dungeon-legendary-fragment', count: 2 }, { itemId: 'pet-treat', count: 3 }],
        );
    });
});
