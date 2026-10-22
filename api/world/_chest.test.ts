import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    applyAncientChestLoot, rollAncientChestLoot, settleAncientChestLoot, wildRelicForRoll,
    relicBandForSector, CHEST_RELIC_IDS, WILD_RELIC_IDS, DUPLICATE_RELIC_FATE_SHARDS, WILD_RELIC_DROP_CHANCE,
    DAILY_ANCIENT_CHEST_LIMIT, chestDuplicateGearValue, chestDuplicateCardPoints,
    isStackedChestGear, withChestStepDrop,
} from './_chest.js';
import { SECTOR_CHEST_POOL_PER_DAY, OWNER_VILLAGE_POOL_BONUS } from './_sector-pool.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { MAX_WILD_SECTOR } from '../../shared/sector-geo.js';
import * as saleModule from '../inventory/_sale.js';
import { CARD_DUPLICATE_CONVERSION } from '../card-clash/_pack.js';
import type { SettlementItem } from '../shop/_catalog.js';
import { craftedSaleCapRyo } from '../../shared/crafting-recipes.js';

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

    it('compensates worn relics, including the rare-band Chakra Ring', () => {
        for (const id of ['chakra-ring', 'relic-ashfall-reliquary']) {
            const settled = settleAncientChestLoot({ inventory: [], equipment: { relic: id }, fateShards: 2 }, { xp: 0, itemId: id });
            assert.equal(settled.loot.itemId, undefined);
            assert.equal(settled.character.fateShards, 17);
            assert.deepEqual(settled.character.inventory, []);
        }
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

    it('drops Tempered Beast Seals into a counted stack without changing the relic band', () => {
        const loot = rollAncientChestLoot(1, sequence(0.9, 0.18, 0.9));
        assert.equal(loot?.itemId, 'beast-seal-tempered');
        const first = applyAncientChestLoot({ inventory: [], itemStacks: [] }, loot!);
        const second = applyAncientChestLoot(first, loot!);
        assert.deepEqual(second.itemStacks, [{ itemId: 'beast-seal-tempered', count: 2 }]);
        assert.deepEqual(second.inventory, []);
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
 * A completed chest roll never pays nothing (economy rebalance 2026-10, #38):
 * gear the backpack already holds pays its NPC sale value, and a card already
 * owned pays Chronicle Points. Values follow the live item catalog, so these
 * tests read it rather than pinning prices another change may move.
 */
describe('ancient chest duplicates pay instead of vanishing', () => {
    const half = (id: string) => Math.floor(Number(ITEM_CATALOG[id]?.cost ?? 0) / 2);
    /** What /api/inventory/sell credits for one unit of `id` from the backpack. */
    const soldFor = (id: string) => {
        const item = { ...ITEM_CATALOG[id], cost: Math.max(0, Math.floor(Number(ITEM_CATALOG[id]?.cost) || 0)) } as SettlementItem;
        const sold = saleModule.applyInventorySale({ ryo: 0, inventory: [id] }, item, 'backpack', 1, undefined, `chest-parity-${id}`, 1_000);
        return sold.ok ? sold.value.ryo : 0;
    };

    it('a duplicate common gear roll pays its NPC sale value, and keeps one copy', () => {
        const settled = settleAncientChestLoot({ ryo: 10, inventory: ['cloth-hood'], tileCards: [] }, { xp: 0, ryo: 50, itemId: 'cloth-hood' });
        assert.ok(half('cloth-hood') > 0);
        assert.equal(settled.loot.duplicateSaleRyo, half('cloth-hood'));
        assert.equal(settled.loot.ryo, 50 + half('cloth-hood'), 'the sale value rides inside the loot ryo');
        assert.equal(settled.loot.itemId, 'cloth-hood', 'the reveal can still name the item');
        assert.equal(settled.character.ryo, 10 + 50 + half('cloth-hood'));
        assert.deepEqual(settled.character.inventory, ['cloth-hood'], 'no second copy');
    });

    it('a duplicate rare gear roll pays its NPC sale value', () => {
        const settled = settleAncientChestLoot({ inventory: ['iron-fang-knuckles'], tileCards: [] }, { xp: 0, itemId: 'iron-fang-knuckles' });
        assert.equal(settled.loot.duplicateSaleRyo, half('iron-fang-knuckles'));
        assert.equal(settled.character.ryo, half('iron-fang-knuckles'));
    });

    it('every chest gear id pays exactly what the sale route credits, or is exempt', () => {
        // Sweep both gear slots of the real roll so a pool edit cannot add an
        // unpriced id. Exempt: a relic (its own Fate Shard rule) and stacking
        // gear, which is granted one more unit instead (2026-10 item-use pass).
        const ids = new Set<string>();
        for (const slot of [0.3, 0.6]) {
            for (let i = 0; i < 400; i++) {
                const loot = rollAncientChestLoot(1, sequence(0.9, slot, i / 400, 0.9));
                if (loot?.itemId) ids.add(loot.itemId);
            }
        }
        assert.ok(ids.size >= 26, `${ids.size} gear ids swept`);
        for (const id of ids) {
            const value = chestDuplicateGearValue({ inventory: [id] }, id);
            if (id === 'chakra-ring') { assert.equal(value, 0, 'a relic keeps the relic rule'); continue; }
            if (isStackedChestGear(id)) { assert.equal(value, 0, `${id} stacks, so it is granted, never converted`); continue; }
            assert.equal(value, soldFor(id), `${id} pays its sale value`);
            // Exempt from "has a value": an item the shop will not buy, and a craft made
            // only of gathered materials (Shuriken, Senbon), which the crafted-goods cap
            // prices at 0 (shared/crafting-recipes.ts).
            if (id !== 'potion-rejuvenation' && craftedSaleCapRyo(id) !== 0) assert.ok(value > 0, `${id} has a sale value`);
        }
        assert.equal(chestDuplicateGearValue({ inventory: ['potion-rejuvenation'] }, 'potion-rejuvenation'), 0, 'the potion stacks, so it never converts');
    });

    it('a stacking gear roll (throwable, potion) always adds one more unit to its stack', () => {
        for (const id of ['thrown-shuriken', 'thrown-senbon', 'thrown-serpent-dust', 'potion-rejuvenation']) {
            assert.ok(isStackedChestGear(id), `${id} is stacking chest gear`);
            // Today a second copy paid nothing: a legacy inventory[] copy counted as owned.
            const legacy = settleAncientChestLoot({ ryo: 0, inventory: [id], itemStacks: [], tileCards: [] }, { xp: 0, ryo: 50, itemId: id });
            assert.equal(legacy.loot.duplicateSaleRyo, undefined, `${id} is not converted`);
            assert.equal(legacy.character.ryo, 50, 'only the chest floor ryo');
            assert.deepEqual(legacy.character.inventory, [id], 'the legacy copy stays where it was');
            assert.deepEqual(legacy.character.itemStacks, [{ itemId: id, count: 1 }]);
            const stacked = settleAncientChestLoot({ inventory: [], itemStacks: [{ itemId: id, count: 7 }], tileCards: [] }, { xp: 0, itemId: id });
            assert.deepEqual(stacked.character.itemStacks, [{ itemId: id, count: 8 }]);
            assert.deepEqual(stacked.character.inventory, []);
        }
        assert.equal(isStackedChestGear('cloth-hood'), false, 'unique gear keeps the sale-value rule');
        assert.equal(isStackedChestGear('pet-treat'), false, 'treats keep their own path');
    });

    it('a gear step drop never replaces a chase relic, but still replaces ordinary loot', () => {
        const relic: Parameters<typeof withChestStepDrop>[0] = { xp: 0, ryo: 60, itemId: CHEST_RELIC_IDS[0] };
        assert.deepEqual(withChestStepDrop(relic, 'cloth-hood-s1'), relic, 'the relic survives the 5% step');
        const card = withChestStepDrop({ xp: 0, ryo: 60, cardId: 'tc-01', fateShards: 1 }, 'cloth-hood-s1');
        assert.equal(card.itemId, 'cloth-hood-s1');
        assert.equal(card.cardId, undefined);
        assert.equal(card.fateShards, undefined);
        assert.equal(card.ryo, 60, 'the ryo floor is kept');
        // The Chakra Ring is ordinary rare gear, not a chase relic.
        assert.equal(withChestStepDrop({ xp: 0, itemId: 'chakra-ring' }, 'cloth-hood-s1').itemId, 'cloth-hood-s1');
        assert.deepEqual(withChestStepDrop({ xp: 0, itemId: 'cloth-hood' }, null), { xp: 0, itemId: 'cloth-hood' });
    });

    it('a first copy and a gear step are granted as before', () => {
        const fresh = settleAncientChestLoot({ inventory: [], tileCards: [] }, { xp: 0, ryo: 50, itemId: 'cloth-hood' });
        assert.equal(fresh.loot.duplicateSaleRyo, undefined);
        assert.deepEqual(fresh.character.inventory, ['cloth-hood']);
        assert.equal(fresh.character.ryo, 50);
        const step = settleAncientChestLoot({ inventory: ['cloth-hood-s1'], tileCards: [] }, { xp: 0, itemId: 'cloth-hood-s1' });
        assert.equal(step.loot.duplicateSaleRyo, undefined);
        assert.deepEqual(step.character.inventory, ['cloth-hood-s1', 'cloth-hood-s1']);
        assert.equal(chestDuplicateGearValue({ inventory: ['pet-treat'] }, 'pet-treat'), 0, 'treats stack, never a duplicate');
    });

    it('a duplicate card pays 5 Chronicle Points, common or rare', () => {
        assert.equal(chestDuplicateCardPoints('tc-01'), CARD_DUPLICATE_CONVERSION.common.chroniclePoints);
        assert.equal(chestDuplicateCardPoints('tc-71'), CARD_DUPLICATE_CONVERSION.rare.chroniclePoints);
        assert.equal(chestDuplicateCardPoints('tc-01'), 5);
        const settled = settleAncientChestLoot({ tileCards: ['tc-01'], chroniclePoints: 7 }, { xp: 0, cardId: 'tc-01' });
        assert.equal(settled.loot.chroniclePoints, 5);
        assert.equal(settled.character.chroniclePoints, 12);
        assert.deepEqual(settled.character.tileCards, ['tc-01']);
        const rare = settleAncientChestLoot({ tileCards: ['tc-71'] }, { xp: 0, cardId: 'tc-71' });
        assert.equal(rare.character.chroniclePoints, 5);
    });

    it('a duplicate at the collection cap pays CP, and a new card at the cap still pays 1 Fate Shard', () => {
        // 1,200 packable cards plus tc-01 (a Traveler's Codex card the cap does not count).
        const full = ['tc-01', ...Array.from({ length: 1_200 }, (_, index) => `owned-${index}`)];
        const dup = settleAncientChestLoot({ fateShards: 2, tileCards: full }, { xp: 0, cardId: 'tc-01' });
        assert.equal(dup.loot.chroniclePoints, 5);
        assert.equal(dup.loot.fateShards, undefined);
        assert.equal(dup.character.fateShards, 2);
        const fresh = settleAncientChestLoot({ fateShards: 2, tileCards: full }, { xp: 0, cardId: 'tc-02' });
        assert.equal(fresh.loot.chroniclePoints, undefined);
        assert.equal(fresh.loot.fateShards, 1);
    });

    it('adds no Chronicle Point key to a save when none is paid', () => {
        const settled = settleAncientChestLoot({ tileCards: [] }, { xp: 0, cardId: 'tc-01' });
        assert.equal('chroniclePoints' in settled.character, false);
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
            'the ring is in the ordinary rare-gear band, not the chase band');
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
