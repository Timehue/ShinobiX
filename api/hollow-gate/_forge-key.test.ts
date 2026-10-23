import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { forgeHollowGateKey, KEY_FORGE_COSTS } from './_forge-key.js';

describe('Hollow Gate key forge', () => {
    it('prices a key at 120 Hollow Shards, 5 Dungeon Keys or 15 Fate Shards (rebalance #27)', () => {
        assert.deepEqual({ ...KEY_FORGE_COSTS }, { hollowShards: 120, dungeonKeys: 5, fateShards: 15 });
    });
    it('requires the attunement and atomically spends Hollow Shards', () => {
        assert.equal(forgeHollowGateKey({ hollowShards: 150 }, 'hollowShards').ok, false);
        assert.deepEqual(forgeHollowGateKey({ hollowShards: 119, hollowGateAttunement: { 'key-forge': 1 } }, 'hollowShards'),
            { ok: false, reason: 'insufficient-materials' });
        const result = forgeHollowGateKey({ hollowShards: 150, hollowGateAttunement: { 'key-forge': 1 }, inventory: [] }, 'hollowShards');
        assert.equal(result.ok, true);
        // The key is STACKABLE, so it lands in itemStacks and never spends an
        // inventory[] slot — which is why the forge carries no capacity gate.
        if (result.ok) {
            assert.equal(result.character.hollowShards, 30);
            assert.deepEqual(result.character.inventory, []);
            assert.deepEqual(result.character.itemStacks, [{ itemId: 'hollow-gate-key', count: 1 }]);
        }
    });
    it('supports the two Crafter recipes without trusting client deltas', () => {
        const shards = forgeHollowGateKey({ fateShards: 17, inventory: [] }, 'fateShards');
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
        assert.deepEqual(forgeHollowGateKey({ fateShards: 14 }, 'fateShards'), { ok: false, reason: 'insufficient-materials' });
    });
});
