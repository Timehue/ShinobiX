/*
 * Shop price scale (2026-10-27 economy pass).
 *
 * Ryo came in much faster than the shelves drained it: a full Standard armor
 * set cost less than one A-rank mission. Every ryo-priced item the shop sells is
 * now multiplied by one of the factors below, applied once, at the end of
 * shinobij.client/src/data/starter-items.ts. The generated server catalog
 * (api/pvp/_item-catalog.ts) is built from that export, so the Shop, the
 * server's purchase settlement and the crafting fees all read the same number.
 *
 * Raising a price must never raise what an item SELLS for. NPC buy-back is
 * floor(cost / 2), and free copies of this gear arrive as chest drops, starter
 * kit and loot, so selling a 75x-priced Cloth Hood for half its new price would
 * print ryo. A scaled item therefore carries `saleBasis`, its pre-scale cost,
 * and every sale path prices from saleCostBasis() instead of `cost`.
 *
 * Fate Shard items (legendary and mythic) are priced in another currency and are
 * left alone, as are free items (cost 0) and creator-authored items, which never
 * pass through withShopPrice.
 */

/** One multiplier per kind of shelf item. Edit here, then regenerate the catalog. */
export const SHOP_PRICE_SCALE = {
    /** Armor pieces and the basic gathering tools. */
    gear: 75,
    /** Hand weapons (shop-sold and craft-only alike, so the ladder stays ordered). */
    weapon: 40,
    /** Wild-binding seals, spent one per bind attempt. */
    beastSeal: 15,
    /** Thrown tools, pills, potions, battle consumables and treats. They were
     *  already the dearest rows per use and are bought again and again. */
    consumable: 4,
    /** PvE pet gear, already priced in the thousands. */
    petGear: 3,
} as const;

export type ShopPricedItem = {
    id: string;
    slot: string;
    rarity: string;
    cost: number;
    armorQuality?: string;
    weaponEp?: number;
    weaponEffect?: string;
    apCost?: number;
    restoreChakra?: number;
    restoreStamina?: number;
    saleBasis?: number;
};

const RYO_RARITIES: ReadonlySet<string> = new Set(['common', 'uncommon', 'rare', 'epic']);
const ARMOR_SLOTS: ReadonlySet<string> = new Set(['head', 'body', 'waist', 'legs', 'feet', 'armor']);

/** The multiplier an item's authored (pre-scale) cost receives; 1 leaves it alone. */
export function shopPriceScale(item: ShopPricedItem): number {
    if (!(item.cost > 0) || !RYO_RARITIES.has(item.rarity)) return 1;
    const slot = item.slot;
    if (slot === 'fishingPole' || slot === 'pickaxe') return SHOP_PRICE_SCALE.gear;
    // By slot, not armorQuality: the Shinobi Vest is body armor without a quality tier.
    if (ARMOR_SLOTS.has(slot)) return SHOP_PRICE_SCALE.gear;
    if ((slot === 'hand' || slot === 'weapon') && item.weaponEp != null) return SHOP_PRICE_SCALE.weapon;
    if (item.id.startsWith('beast-seal-')) return SHOP_PRICE_SCALE.beastSeal;
    if (item.id.startsWith('pve-')) return SHOP_PRICE_SCALE.petGear;
    if (slot === 'thrown' || slot === 'potion' || slot === 'item') return SHOP_PRICE_SCALE.consumable;
    return 1;
}

/** The item at its current shelf price, remembering the old cost as `saleBasis`. */
export function withShopPrice<T extends ShopPricedItem>(item: T): T {
    if (item.saleBasis != null) return item;
    const scale = shopPriceScale(item);
    return scale === 1 ? item : { ...item, cost: item.cost * scale, saleBasis: item.cost };
}

/** What NPC buy-back is computed from. Never above the shelf price, so a bad
 *  `saleBasis` on a hand-authored item cannot make an item sell for more than it costs. */
export function saleCostBasis(item: { cost: number; saleBasis?: number }): number {
    const cost = Number(item.cost) || 0;
    const basis = Number(item.saleBasis);
    return Number.isFinite(basis) && basis >= 0 ? Math.min(cost, Math.floor(basis)) : cost;
}
