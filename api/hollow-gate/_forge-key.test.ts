import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { forgeHollowGateKey } from './_forge-key.js';

describe('Hollow Gate key forge', () => {
    it('requires the attunement and atomically spends Hollow Shards', () => {
        assert.equal(forgeHollowGateKey({ hollowShards: 100 }, 'hollowShards').ok, false);
        const result = forgeHollowGateKey({ hollowShards: 100, hollowGateAttunement: { 'key-forge': 1 }, inventory: [] }, 'hollowShards');
        assert.equal(result.ok, true);
        // The key is STACKABLE, so it lands in itemStacks and never spends an
        // inventory[] slot — which is why the forge carries no capacity gate.
        if (result.ok) {
            assert.equal(result.character.hollowShards, 20);
            assert.deepEqual(result.character.inventory, []);
            assert.deepEqual(result.character.itemStacks, [{ itemId: 'hollow-gate-key', count: 1 }]);
        }
    });
    it('supports the two Crafter recipes without trusting client deltas', () => {
        const shards = forgeHollowGateKey({ fateShards: 12, inventory: [] }, 'fateShards');
        assert.equal(shards.ok && shards.character.fateShards, 2);
        const keys = forgeHollowGateKey({ inventory: ['dungeon-key', 'dungeon-key'], itemStacks: [{ itemId: 'dungeon-key', count: 3 }] }, 'dungeonKeys');
        assert.equal(keys.ok, true);
        // 5 dungeon keys are consumed stacks-first, so the 3-count stack empties
        // and 2 loose entries go; the forged key then replaces them in itemStacks.
        if (keys.ok) {
            assert.deepEqual(keys.character.itemStacks, [{ itemId: 'hollow-gate-key', count: 1 }]);
            assert.deepEqual(keys.character.inventory, []);
        }
    });
    it('fails closed when materials are insufficient', () => {
        assert.deepEqual(forgeHollowGateKey({ fateShards: 9 }, 'fateShards'), { ok: false, reason: 'insufficient-materials' });
    });
});
