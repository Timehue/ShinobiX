/*
 * Shop price scale (2026-10-27 economy pass).
 *
 * Ryo came in much faster than the shelves drained it: a full Standard armor
 * set cost less than one A-rank mission. Every ryo-priced item the shop sells is
 * now multiplied by one of the factors in shopPriceScale, applied once, at the
 * end of shinobij.client/src/data/starter-items.ts. The generated server catalog
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
 *
 * This file ships in the client bundle, which has a tight size budget
 * (scripts/check-build-size.mjs), so it is kept small.
 */

export type ShopPricedItem = {
    id: string;
    slot: string;
    rarity: string;
    cost: number;
    weaponEp?: number;
    saleBasis?: number;
};

const ARMOR_SLOTS = ['head', 'body', 'waist', 'legs', 'feet', 'armor'];

/** The multiplier an item's authored (pre-scale) cost receives; 1 leaves it alone. Edit the numbers here. */
export function shopPriceScale({ id, slot, rarity, cost, weaponEp }: ShopPricedItem): number {
    if (!(cost > 0) || rarity === 'legendary' || rarity === 'mythic') return 1;
    // Armor by slot, not armorQuality: the Shinobi Vest is body armor without a quality tier.
    if (slot === 'fishingPole' || slot === 'pickaxe' || ARMOR_SLOTS.includes(slot)) return 75;
    if ((slot === 'hand' || slot === 'weapon') && weaponEp != null) return 40; // shop-sold and craft-only alike
    if (id.startsWith('beast-seal-')) return 15; // spent one per bind attempt
    if (id.startsWith('pve-')) return 3; // PvE pet gear, already priced in the thousands
    // Thrown tools, pills, potions, battle consumables and treats: the dearest rows per use, bought again and again.
    return slot === 'thrown' || slot === 'potion' || slot === 'item' ? 4 : 1;
}

/** The item at its current shelf price, remembering the old cost as `saleBasis`. */
export function withShopPrice<T extends ShopPricedItem>(item: T): T {
    const scale = item.saleBasis == null ? shopPriceScale(item) : 1;
    return scale === 1 ? item : { ...item, cost: item.cost * scale, saleBasis: item.cost };
}

/** What NPC buy-back is computed from. Never above the shelf price, so a bad
 *  `saleBasis` on a hand-authored item cannot make an item sell for more than it costs. */
export function saleCostBasis({ cost, saleBasis }: { cost: number; saleBasis?: number }): number {
    return saleBasis! >= 0 ? Math.min(cost, Math.floor(saleBasis!)) : cost;
}
