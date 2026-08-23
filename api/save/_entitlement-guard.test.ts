import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    capStringArrayItemGain,
    isHighRiskTileCardId,
    isServerOwnedItemId,
    preserveEntitledStacks,
    preserveEntitledStringArray,
    preserveOwnedItems,
} from './_entitlement-guard.js';

describe('_entitlement-guard', () => {
    it('identifies server-owned items and high-rarity built-in cards', () => {
        assert.equal(isServerOwnedItemId('weekly-boss-core'), true);
        assert.equal(isServerOwnedItemId('territory-control-scroll'), true);
        assert.equal(isServerOwnedItemId('shinobi-vest'), false);
        assert.equal(isHighRiskTileCardId('tc-41'), true);
        assert.equal(isHighRiskTileCardId('tc-121'), true);
        assert.equal(isHighRiskTileCardId('tc-21'), false);
    });

    it('conserves all ordinary item ownership across array-to-stack migration', () => {
        assert.deepEqual(
            preserveOwnedItems(
                ['shinobi-vest', 'forged-item'],
                [{ itemId: 'pet-treat', count: 3 }, { itemId: 'forged-stack', count: 9 }],
                ['shinobi-vest', 'pet-treat', 'pet-treat', 'pet-treat'],
                [],
            ),
            { inventory: ['shinobi-vest'], itemStacks: [{ itemId: 'pet-treat', count: 3 }] },
        );
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

    it('allows one locally settled dungeon relic per save but clamps bulk minting', () => {
        assert.equal(isServerOwnedItemId('dungeon-legendary-relic'), false);
        assert.deepEqual(
            capStringArrayItemGain(
                ['sword', 'dungeon-legendary-relic', 'dungeon-legendary-relic', 'dungeon-legendary-relic'],
                ['dungeon-legendary-relic'],
                'dungeon-legendary-relic',
                1,
            ),
            ['sword', 'dungeon-legendary-relic', 'dungeon-legendary-relic'],
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
