import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { purchaseCatalogItem } from './_purchase.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { effectiveItemLevelReq } from '../../shared/item-level-gate.js';

describe('catalog shop purchase', () => {
    it('rejects direct purchases of every forge-only weapon and armor without charging', () => {
        const forgeOnly = Object.values(ITEM_CATALOG).filter(item =>
            (item.slot === 'hand' && item.weaponEp != null && ['rare', 'epic', 'legendary'].includes(item.rarity)) ||
            (['body', 'head', 'waist', 'legs', 'feet'].includes(item.slot) && item.rarity === 'rare' && item.armorQuality));
        assert.ok(forgeOnly.length >= 20);
        for (const item of forgeOnly) {
            const character = { level: 100, ryo: 1_000_000, fateShards: 1_000_000, inventory: [], itemStacks: [] };
            const before = structuredClone(character);
            assert.deepEqual(purchaseCatalogItem(character, item.id, 1), { ok: false, reason: 'item-not-for-sale' }, item.id);
            assert.deepEqual(character, before, item.id);
        }
    });
    it('atomically debits ryo and grants an ordinary catalog item', () => {
        const result = purchaseCatalogItem({ level: 10, ryo: 1000, inventory: [] }, 'shinobi-vest', 99);
        assert.equal(result.ok, true);
        if (result.ok) { assert.equal(result.item.qty, 1); assert.equal(result.character.ryo, 940); assert.deepEqual(result.character.inventory, ['shinobi-vest']); }
    });
    it('derives premium currency and stored discounts', () => {
        const result = purchaseCatalogItem({ level: 100, fateShards: 1000, elderFocus: 'trade', inventory: [] }, 'golden-apple', 1);
        assert.equal(result.ok, true);
        if (result.ok) { assert.equal(result.item.currency, 'fateShards'); assert.equal(result.item.unitCost, 19); }
    });
    it('sells the profession scroll for 200 Fate Shards from level 20 after choosing a profession', () => {
        const result = purchaseCatalogItem({ level: 20, profession: 'vanguard', fateShards: 200, inventory: [] }, 'profession-change-approval', 1);
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.item.currency, 'fateShards');
            assert.equal(result.item.unitCost, 200);
            assert.equal(result.character.fateShards, 0);
            assert.deepEqual(result.character.inventory, ['profession-change-approval']);
        }
    });
    it('rejects profession scroll purchases below level 20 or without a valid profession without charging', () => {
        for (const overrides of [{ level: 19, profession: 'healer' }, { level: 20 }, { level: 100, profession: 'invalid' }]) {
            const character = { fateShards: 500, inventory: [], ...overrides };
            const before = structuredClone(character);
            assert.equal(purchaseCatalogItem(character, 'profession-change-approval', 1).ok, false);
            assert.deepEqual(character, before);
        }
        assert.equal(purchaseCatalogItem({ level: 20, profession: 'petTamer', fateShards: 199, inventory: [] }, 'profession-change-approval', 1).ok, false);
    });
    it('enforces consumable caps and rejects free reward items', () => {
        const capped = purchaseCatalogItem({ level: 100, ryo: 100000, inventory: Array(50).fill('item-attack-pill') }, 'item-attack-pill', 5);
        assert.equal(capped.ok, false);
        assert.equal(purchaseCatalogItem({ level: 100, ryo: 100000, inventory: [] }, 'dungeon-key', 1).ok, false);
    });
    it('routes a stackable buy into itemStacks so a bulk order costs no inventory slots', () => {
        // The whole point: combat consumables are what a player buys 50 of, and
        // they stack. Pushing 50 raw copies into `inventory[]` (as this used to)
        // made a bulk order read as +50 slots, so the capacity gate in
        // purchase.ts refused potions and shuriken to a full-bag veteran — the
        // one thing an inventory cap must never block.
        const result = purchaseCatalogItem({ level: 100, ryo: 100_000, inventory: ['keepsake'], itemStacks: [] }, 'thrown-shuriken', 50);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.item.qty, 50);
        assert.deepEqual(result.character.inventory, ['keepsake'], 'inventory[] is untouched by a stackable buy');
        assert.deepEqual(result.character.itemStacks, [{ itemId: 'thrown-shuriken', count: 50 }]);
    });

    it('adds to an existing stack rather than starting a second one', () => {
        const result = purchaseCatalogItem(
            { level: 100, ryo: 100_000, inventory: [], itemStacks: [{ itemId: 'other', count: 3 }, { itemId: 'thrown-shuriken', count: 10 }] },
            'thrown-shuriken', 5,
        );
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.deepEqual(result.character.itemStacks, [{ itemId: 'other', count: 3 }, { itemId: 'thrown-shuriken', count: 15 }]);
    });

    it('buys more Beast Seals after owning one and respects the 99-seal carry limit', () => {
        const owned = { level: 1, ryo: 30_000, inventory: [], itemStacks: [{ itemId: 'beast-seal-reinforced', count: 1 }] };
        const bought = purchaseCatalogItem(owned, 'beast-seal-reinforced', 9);
        assert.equal(bought.ok, true);
        if (!bought.ok) return;
        assert.equal(bought.item.qty, 9);
        assert.equal(bought.item.totalCost, 2160);
        assert.equal(bought.character.ryo, 27_840);
        assert.deepEqual(bought.character.itemStacks, [{ itemId: 'beast-seal-reinforced', count: 10 }]);

        const filled = purchaseCatalogItem(bought.character, 'beast-seal-reinforced', 99);
        assert.equal(filled.ok, true);
        if (!filled.ok) return;
        assert.equal(filled.item.qty, 89);
        assert.deepEqual(filled.character.itemStacks, [{ itemId: 'beast-seal-reinforced', count: 99 }]);
        const capped = purchaseCatalogItem(filled.character, 'beast-seal-reinforced', 1);
        assert.deepEqual(capped, { ok: false, reason: 'hold-cap' });
    });

    it('counts legacy inventory seals against the cap and sells Ancient Seals for Fate Shards', () => {
        const ancient = purchaseCatalogItem({ level: 1, fateShards: 60, inventory: ['beast-seal-ancient'], itemStacks: [] }, 'beast-seal-ancient', 3);
        assert.equal(ancient.ok, true);
        if (!ancient.ok) return;
        assert.equal(ancient.item.currency, 'fateShards');
        assert.equal(ancient.item.qty, 3);
        assert.equal(ancient.character.fateShards, 15);
        assert.deepEqual(ancient.character.itemStacks, [{ itemId: 'beast-seal-ancient', count: 3 }]);
    });

    it('still spends a real inventory slot for non-stackable gear', () => {
        const result = purchaseCatalogItem({ level: 10, ryo: 1000, inventory: [], itemStacks: [] }, 'shinobi-vest', 1);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.deepEqual(result.character.inventory, ['shinobi-vest'], 'gear is the only thing the capacity gate should ever see');
    });

    it('counts a stacked holding against the per-item hold cap', () => {
        // `itemCount` reads both halves, so routing to itemStacks must not turn
        // the 50-shuriken cap into an unlimited faucet.
        const capped = purchaseCatalogItem(
            { level: 100, ryo: 100_000, inventory: [], itemStacks: [{ itemId: 'thrown-shuriken', count: 50 }] },
            'thrown-shuriken', 5,
        );
        assert.equal(capped.ok, false);
    });

    it('fails closed on insufficient funds and duplicate gear', () => {
        assert.equal(purchaseCatalogItem({ level: 100, ryo: 0, inventory: [] }, 'shinobi-vest', 1).ok, false);
        assert.equal(purchaseCatalogItem({ level: 100, ryo: 1000, inventory: ['shinobi-vest'] }, 'shinobi-vest', 1).ok, false);
    });
});

describe('catalog shop purchase: the rarity level ladder (I-9)', () => {
    const buyer = (level: number) => ({ level, ryo: 1_000_000, fateShards: 1_000_000, inventory: [], itemStacks: [] });
    const refusedFree = (level: number, id: string) => {
        const character = buyer(level);
        const before = structuredClone(character);
        assert.deepEqual(purchaseCatalogItem(character, id, 1), { ok: false, reason: 'level-required' }, `${id} at L${level}`);
        assert.deepEqual(character, before, `${id} at L${level} charged on refusal`);
    };
    const bought = (level: number, id: string) => assert.equal(purchaseCatalogItem(buyer(level), id, 1).ok, true, `${id} at L${level}`);

    it('gates a mythic weapon at Level 80, not its authored 55', () => {
        refusedFree(55, 'worldsplitter-katana');
        refusedFree(79, 'worldsplitter-katana');
        bought(80, 'worldsplitter-katana');
    });

    it('gates legendary armour at Level 65, not its authored 40', () => {
        refusedFree(40, 'bulwark-chest');
        refusedFree(64, 'bulwark-chest');
        bought(65, 'bulwark-chest');
    });

    it('gates an ungated legendary pet item and an uncommon armour piece at their tier floors', () => {
        refusedFree(1, 'golden-apple');
        bought(65, 'golden-apple');
        refusedFree(5, 'reinforced-vest');
        bought(15, 'reinforced-vest');
    });

    it('keeps the authored gates of service items', () => {
        // A legendary-rarity document, priced in Fate Shards, still opens at its own Level 20.
        assert.equal(purchaseCatalogItem({ ...buyer(20), profession: 'vanguard' }, 'profession-change-approval', 1).ok, true);
        bought(1, 'tool-golden-pickaxe');
        bought(1, 'beast-seal-ancient');
    });

    it('every purchasable item is refused one level under its ladder level and never refused for level at it', () => {
        let checked = 0;
        for (const item of Object.values(ITEM_CATALOG)) {
            const level = effectiveItemLevelReq(item);
            const at = purchaseCatalogItem({ ...buyer(level), profession: 'vanguard', storyChapter: 99, storyProgress: { chapter: 99 } }, item.id, 1);
            if (!at.ok && at.reason === 'item-not-for-sale') continue;
            checked++;
            assert.notEqual(!at.ok && at.reason, 'level-required', `${item.id} refused for level at L${level}`);
            if (level > 1) {
                const under = purchaseCatalogItem(buyer(level - 1), item.id, 1);
                assert.equal(under.ok, false, `${item.id} bought at L${level - 1}`);
                // The two scrolls refuse earlier with their own unlock message.
                if (!['profession-change-approval', 'village-transfer-scroll'].includes(item.id)) {
                    assert.equal(!under.ok && under.reason, 'level-required', `${item.id} at L${level - 1}`);
                }
            }
        }
        assert.ok(checked >= 100, `only ${checked} purchasable items checked`);
    });
});

/*
 * 2026-10 item-use pass. Pet supplies had no hold cap, so the shop forced qty 1
 * and refused 'already-owned' once one was held: treats, PvE gear, battle
 * consumables and evolution stones sold one at a time, from an empty stack.
 */
describe('pet supplies buy in bulk; pet unlocks stay single', () => {
    const rich = (extra: Record<string, unknown> = {}) => ({ level: 100, ryo: 1_000_000, fateShards: 100_000, inventory: [] as string[], itemStacks: [] as unknown[], ...extra });

    it('tops up a held stack of treats, PvE gear and battle consumables', () => {
        for (const id of ['pet-treat', 'elemental-pet-treat', 'pve-frenzy-claw', 'consum-phantom-charm', 'golden-apple']) {
            const result = purchaseCatalogItem(rich({ itemStacks: [{ itemId: id, count: 3 }] }), id, 10);
            assert.equal(result.ok, true, id);
            if (result.ok) {
                assert.equal(result.item.qty, 10, id);
                assert.deepEqual(result.character.itemStacks, [{ itemId: id, count: 13 }], id);
            }
        }
    });

    it('clamps a pet supply to the 50 hold cap', () => {
        const near = purchaseCatalogItem(rich({ itemStacks: [{ itemId: 'pet-treat', count: 45 }] }), 'pet-treat', 20);
        assert.equal(near.ok && near.item.qty, 5);
        const full = purchaseCatalogItem(rich({ itemStacks: [{ itemId: 'pet-treat', count: 50 }] }), 'pet-treat', 1);
        assert.deepEqual(full, { ok: false, reason: 'hold-cap' });
    });

    it('buys several evolution stones as inventory entries, where the evolve route reads them', () => {
        const result = purchaseCatalogItem(rich({ inventory: ['evo-stone-awakening'] }), 'evo-stone-awakening', 2);
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.deepEqual(result.character.inventory, ['evo-stone-awakening', 'evo-stone-awakening', 'evo-stone-awakening']);
            assert.equal(result.item.totalCost, 2 * Number(ITEM_CATALOG['evo-stone-awakening'].cost));
        }
    });

    it('keeps collars and PvP gear one-off unlocks', () => {
        for (const id of ['collar-crimson', 'pvp-aegis-pendant']) {
            const first = purchaseCatalogItem(rich(), id, 5);
            assert.equal(first.ok && first.item.qty, 1, id);
            assert.deepEqual(purchaseCatalogItem(rich({ inventory: [id] }), id, 1), { ok: false, reason: 'already-owned' }, id);
        }
    });

    it('sells the Prismatic Collar at the top of the Fate Shard collar ladder', () => {
        const collars = Object.values(ITEM_CATALOG).filter((item) => item.id.startsWith('collar-'));
        const top = Math.max(...collars.map((item) => Number(item.cost)));
        assert.equal(Number(ITEM_CATALOG['collar-prismatic'].cost), top, 'the most expensive collar');
        assert.ok(collars.filter((item) => item.id !== 'collar-prismatic').every((item) => Number(item.cost) < top));
        const bought = purchaseCatalogItem(rich(), 'collar-prismatic', 1);
        assert.equal(bought.ok, true);
        if (bought.ok) assert.equal(bought.item.currency, 'fateShards');
        assert.equal(purchaseCatalogItem(rich({ level: 79 }), 'collar-prismatic', 1).ok, false, 'a mythic, so Lv80');
    });

    it('prices the re-priced budget picks under the item that used to beat them', () => {
        assert.ok(Number(ITEM_CATALOG['pve-avengers-pendant'].cost) < Number(ITEM_CATALOG['pve-frenzy-claw'].cost));
        assert.ok(Number(ITEM_CATALOG['consum-smoke-pellet'].cost) < Number(ITEM_CATALOG['consum-phantom-charm'].cost));
    });
});

describe('the shop discount is the one capped rule', () => {
    it('reads the village shop and blacksmith levels capped at 50, as /shop/settle does', () => {
        const capped = purchaseCatalogItem({ level: 10, ryo: 10_000, inventory: [], villageUpgrades: { shop: 50 }, clanUpgradeLevels: { blacksmith: 50 } }, 'cloth-robe', 1);
        const corrupt = purchaseCatalogItem({ level: 10, ryo: 10_000, inventory: [], villageUpgrades: { shop: 400 }, clanUpgradeLevels: { blacksmith: 999 } }, 'cloth-robe', 1);
        assert.equal(capped.ok, true);
        assert.equal(corrupt.ok, true);
        if (capped.ok && corrupt.ok) {
            assert.equal(corrupt.item.unitCost, capped.item.unitCost, 'a level past the cap buys nothing more');
            // 12.5% village + 10% blacksmith on the 150-ryo robe.
            assert.equal(capped.item.unitCost, Math.floor(150 * (1 - 22.5 / 100)));
        }
    });
});