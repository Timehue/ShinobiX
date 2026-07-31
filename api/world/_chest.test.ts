import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyAncientChestLoot, rollAncientChestLoot } from './_chest.js';

function sequence(...values: number[]) { let i = 0; return () => values[i++] ?? 0; }

describe('ancient chest settlement', () => {
    it('rolls rewards from canonical server pools', () => {
        // Character XP retired: the old xp line (50 + sector·2) folds into a
        // guaranteed ryo floor (40 + sector·2); the roll table is unchanged.
        // Rolls: bonus-ryo gate, bonus-ryo size, slot, gear pick, aura-dust gate.
        assert.deepEqual(
            rollAncientChestLoot(10, sequence(0.1, 0.5, 0.3, 0, 0.9)),
            { xp: 0, ryo: 60 + 300, itemId: 'shinobi-vest' },
        );
        // Rolls here: 0.9 skips the bonus-ryo gate (so it consumes one value,
        // not two), 0.84 lands the rare-card slot, 0.45 picks within it.
        const card = rollAncientChestLoot(60, sequence(0.9, 0.84, 0.45, 0.9));
        assert.equal(card?.cardId, 'tc-71');
        assert.equal(card?.xp, 0);
        assert.equal(card?.ryo, 40 + 60 * 2); // guaranteed floor, no bonus ryo roll in this sequence
    });

    it('draws gear from the whole tier, not a single fixed item', () => {
        // The common slot (0.2 <= roll < 0.55) and the rare slot (< 0.65) each
        // pick from their full pool. A fixed pick here silently deleted almost
        // all of the chest's gear variety.
        const first = rollAncientChestLoot(1, sequence(0.9, 0.3, 0, 0.9));
        const last = rollAncientChestLoot(1, sequence(0.9, 0.3, 0.999, 0.9));
        assert.equal(first?.itemId, 'shinobi-vest');
        assert.equal(last?.itemId, 'cracked-bone-dagger');

        const rareFirst = rollAncientChestLoot(1, sequence(0.9, 0.6, 0, 0.9));
        const rareLast = rollAncientChestLoot(1, sequence(0.9, 0.6, 0.999, 0.9));
        assert.equal(rareFirst?.itemId, 'chakra-ring');
        assert.equal(rareLast?.itemId, 'blue-thread-dagger');
    });

    it('commits balances and ownership without duplicating unique drops', () => {
        const next = applyAncientChestLoot({ level: 1, xp: 0, ryo: 10, inventory: ['shinobi-vest'], tileCards: [] }, { xp: 50, ryo: 100, itemId: 'shinobi-vest', fateShards: 1 });
        assert.equal(next.ryo, 110);
        assert.equal(next.fateShards, 1);
        assert.deepEqual(next.inventory, ['shinobi-vest']);
    });

    it('allows repeated stackable treat drops', () => {
        const next = applyAncientChestLoot({ level: 1, xp: 0, inventory: ['pet-treat'], tileCards: [] }, { xp: 50, itemId: 'pet-treat' });
        assert.deepEqual(next.inventory, ['pet-treat', 'pet-treat']);
    });
});
