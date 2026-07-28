import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyAncientChestLoot, rollAncientChestLoot } from './_chest.js';

function sequence(...values: number[]) { let i = 0; return () => values[i++] ?? 0; }

describe('ancient chest settlement', () => {
    it('rolls rewards from canonical server pools', () => {
        // Character XP retired: the old xp line (50 + sector·2) folds into a
        // guaranteed ryo floor (40 + sector·2); the roll table is unchanged.
        assert.deepEqual(rollAncientChestLoot(10, sequence(0.1, 0.5, 0.3, 0.9)), { xp: 0, ryo: 60 + 300, itemId: 'shinobi-vest' });
        const card = rollAncientChestLoot(60, sequence(0.9, 0.84, 0.5, 0.9));
        assert.equal(card?.cardId, 'tc-71');
        assert.equal(card?.xp, 0);
        assert.equal(card?.ryo, 40 + 60 * 2); // guaranteed floor, no bonus ryo roll in this sequence
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
