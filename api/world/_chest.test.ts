import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyAncientChestLoot, rollAncientChestLoot, settleAncientChestLoot } from './_chest.js';
import { MAX_WILD_SECTOR } from '../../shared/sector-geo.js';

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

    it('opens in every sector the world map can find a chest in', () => {
        // Bounds track the shared world registry — a stale ceiling would make
        // the outermost sectors' chests unopenable, not merely unpaid.
        for (let sector = 1; sector <= MAX_WILD_SECTOR; sector++) {
            assert.ok(rollAncientChestLoot(sector, sequence(0.9, 0.3, 0, 0.9)), `sector ${sector}`);
        }
        assert.equal(rollAncientChestLoot(0, sequence(0.9, 0.3, 0, 0.9)), null);
        assert.equal(rollAncientChestLoot(MAX_WILD_SECTOR + 1, sequence(0.9, 0.3, 0, 0.9)), null);
    });

    it('allows repeated stackable treat drops', () => {
        const next = applyAncientChestLoot({ level: 1, xp: 0, inventory: ['pet-treat'], tileCards: [] }, { xp: 50, itemId: 'pet-treat' });
        assert.deepEqual(next.inventory, ['pet-treat', 'pet-treat']);
    });

    it('replaces an over-cap card with an explicit Fate Shard before writing the receipt', () => {
        const full = Array.from({ length: 1_200 }, (_, index) => `owned-${index}`);
        const settled = settleAncientChestLoot(
            { level: 1, xp: 0, fateShards: 2, tileCards: full },
            { xp: 0, ryo: 50, cardId: 'tc-01' },
        );
        assert.equal(settled.loot.cardId, undefined);
        assert.equal(settled.loot.fateShards, 1);
        assert.equal(settled.character.fateShards, 3);
        assert.deepEqual(settled.character.tileCards, full);

        const room = settleAncientChestLoot(
            { level: 1, xp: 0, tileCards: full.slice(0, 1_199) },
            { xp: 0, cardId: 'tc-01' },
        );
        assert.equal(room.loot.cardId, 'tc-01');
        assert.equal((room.character.tileCards as string[]).length, 1_200);
    });
});
