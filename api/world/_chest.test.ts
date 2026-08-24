import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    applyAncientChestLoot, rollAncientChestLoot, settleAncientChestLoot, wildRelicForRoll,
    relicBandForSector, CHEST_RELIC_IDS, WILD_RELIC_IDS, DUPLICATE_RELIC_FATE_SHARDS, WILD_RELIC_DROP_CHANCE,
    DAILY_ANCIENT_CHEST_LIMIT,
} from './_chest.js';
import { SECTOR_CHEST_POOL_PER_DAY, OWNER_VILLAGE_POOL_BONUS } from './_sector-pool.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
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

    /*
     * Relics are BIOME-LOCKED: each drops only where its lore says it came from,
     * so the world tells you where to hunt. The band sits at the very bottom of
     * the SAME slot roll and draws no extra random value, which is why adding it
     * changed no existing chest outcome.
     */
    const BIOME_SECTOR = { central: 1, forest: 9, shadow: 17, snow: 26, volcano: 33 } as const;

    it('drops each relic only in its own biome', () => {
        const lowRoll = (sector: number) => rollAncientChestLoot(sector, sequence(0.9, 0.0001, 0, 0.9))?.itemId;
        assert.equal(lowRoll(BIOME_SECTOR.volcano), 'relic-ashfall-reliquary');
        assert.equal(lowRoll(BIOME_SECTOR.forest), 'relic-rootbound-effigy');
        assert.equal(lowRoll(BIOME_SECTOR.snow), 'relic-rimeglass-lens');
        assert.equal(lowRoll(BIOME_SECTOR.shadow), 'relic-umbral-knot');
        // Central hosts three; the band is 3× as wide so each keeps the same odds.
        const central = relicBandForSector(BIOME_SECTOR.central);
        assert.equal(central.pool.length, 3);
        assert.equal(central.width, 3 * WILD_RELIC_DROP_CHANCE);
        for (const [i, expected] of central.pool.entries()) {
            const roll = (i + 0.5) * WILD_RELIC_DROP_CHANCE;
            assert.equal(wildRelicForRoll(roll, BIOME_SECTOR.central), expected);
        }
    });

    it('never drops the rift relic from the ground — that one is the Weekly Boss', () => {
        for (const sector of Object.values(BIOME_SECTOR)) {
            const { pool } = relicBandForSector(sector);
            assert.ok(!pool.includes('relic-hollow-gate-cinder'), `sector ${sector} must not host the Cinder`);
        }
    });

    it('leaves ordinary loot untouched immediately above the band', () => {
        const { width } = relicBandForSector(BIOME_SECTOR.volcano);
        const justAbove = rollAncientChestLoot(BIOME_SECTOR.volcano, sequence(0.9, width + 0.0001, 0, 0.9));
        assert.equal(justAbove?.itemId, 'pet-treat');
    });

    it('only ever yields real catalogued relic-slot items', () => {
        for (const id of CHEST_RELIC_IDS) {
            const item = ITEM_CATALOG[id] as { slot?: string } | undefined;
            assert.ok(item, `${id} is not in the item catalog`);
            assert.equal(item?.slot, 'relic', `${id} must be a relic-slot item`);
        }
    });

    it('converts a DUPLICATE relic into Fate Shards instead of swallowing it', () => {
        // applyAncientChestLoot drops a non-stackable id the player already owns,
        // so without this the rarest roll in the game would pay literally nothing.
        const owner = { level: 1, xp: 0, fateShards: 2, inventory: ['relic-ashfall-reliquary'], tileCards: [] };
        const settled = settleAncientChestLoot(owner, { xp: 0, itemId: 'relic-ashfall-reliquary' });
        assert.equal(settled.loot.itemId, undefined, 'the duplicate item is not granted');
        assert.equal(settled.loot.fateShards, DUPLICATE_RELIC_FATE_SHARDS);
        assert.equal(settled.character.fateShards, 2 + DUPLICATE_RELIC_FATE_SHARDS);
        assert.deepEqual(settled.character.inventory, ['relic-ashfall-reliquary'], 'no second copy');
    });

    it('grants a FIRST relic normally', () => {
        const fresh = { level: 1, xp: 0, fateShards: 0, inventory: [], tileCards: [] };
        const settled = settleAncientChestLoot(fresh, { xp: 0, itemId: 'relic-ashfall-reliquary' });
        assert.equal(settled.loot.itemId, 'relic-ashfall-reliquary');
        assert.equal(settled.loot.fateShards, undefined);
        assert.deepEqual(settled.character.inventory, ['relic-ashfall-reliquary']);
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

/*
 * The chase-relic list is the source of truth for duplicate compensation, so it
 * must stay in lock-step with the catalog and with the Weekly Boss faucet. An
 * id-prefix convention would drift silently; this pins it.
 */
describe('wild relic roster integrity', () => {
    it('covers all 8 chase relics and every one is a real relic-slot item', () => {
        assert.equal(WILD_RELIC_IDS.length, 8);
        assert.equal(new Set(WILD_RELIC_IDS).size, 8, 'no duplicates in the roster');
        for (const id of WILD_RELIC_IDS) {
            assert.equal((ITEM_CATALOG[id] as { slot?: string } | undefined)?.slot, 'relic', `${id}`);
        }
    });

    it('excludes chakra-ring, which is ordinary chest rare-gear', () => {
        assert.ok(!WILD_RELIC_IDS.includes('chakra-ring'),
            'a duplicate shop relic must not pay premium currency');
    });

    it('includes the Weekly Boss relic even though no chest yields it', () => {
        assert.ok(WILD_RELIC_IDS.includes('relic-hollow-gate-cinder'));
        assert.ok(!CHEST_RELIC_IDS.includes('relic-hollow-gate-cinder'));
    });
});

describe('shared sector chest pool sizing', () => {
    it('holds many maxed chest-openers before a sector runs dry', () => {
        // Chests are debited at DISCOVERY now (api/world/explore.ts), so this
        // pool bounds how many chests a sector can YIELD in a day, not how many
        // can be opened — an already-discovered chest is never refused.
        assert.equal(SECTOR_CHEST_POOL_PER_DAY, 225);
        assert.ok(SECTOR_CHEST_POOL_PER_DAY / DAILY_ANCIENT_CHEST_LIMIT >= 9,
            'at least ~9 players hitting their own 23/day chest ceiling in one sector');
        assert.equal(Math.floor(SECTOR_CHEST_POOL_PER_DAY * (1 + OWNER_VILLAGE_POOL_BONUS)), 337,
            'and half again for the owning village');
    });
});
