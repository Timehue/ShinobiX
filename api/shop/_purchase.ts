import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { gatheringTool, gatheringToolOwned, initializeGatheringTool } from '../../shared/gathering-tools.js';
import { withGearTierUnlock } from '../_gear-drops.js';
import { wildBindingSeal } from '../../shared/wild-binding.js';
import { PROFESSION_CHANGE_APPROVAL_ID, professionChangeUnlockError } from '../../shared/profession-change.js';
import { VILLAGE_TRANSFER_SCROLL_ID, VILLAGE_TRANSFER_COST, villageTransferUnlockError } from '../../shared/village-transfer.js';
import { discountedShopCost, isPurchasableItem, shopDiscountPercent } from './_settlement.js';
import { meetsItemLevelReq } from '../../shared/item-level-gate.js';
import { petSupplyHoldCap } from '../_pet-sim/pet-config.js';
import { isPetFood } from '../../shared/pet-food.js';

type Character = Record<string, unknown>;

function whole(value: unknown): number { return Math.max(0, Math.floor(Number(value) || 0)); }
function itemCount(character: Character, id: string): number {
    const inline = Array.isArray(character.inventory) ? character.inventory.filter((x) => x === id).length : 0;
    const stacked = Array.isArray(character.itemStacks)
        ? (character.itemStacks as Array<Record<string, unknown>>).filter((s) => s?.itemId === id).reduce((n, s) => n + whole(s.count), 0) : 0;
    return inline + stacked;
}

export function purchaseCatalogItem(character: Character, itemId: unknown, qtyRaw: unknown) {
    const id = typeof itemId === 'string' ? itemId : '';
    const item = ITEM_CATALOG[id];
    const tool = gatheringTool(id);
    const baseCost = whole(item?.cost);
    if (!item || baseCost <= 0 || !isPurchasableItem({ ...item, cost: baseCost })) return { ok: false as const, reason: 'item-not-for-sale' as const };
    if (id === PROFESSION_CHANGE_APPROVAL_ID) {
        const error = professionChangeUnlockError(character);
        if (error) return { ok: false as const, reason: error };
    }
    if (id === VILLAGE_TRANSFER_SCROLL_ID && villageTransferUnlockError(character)) {
        return { ok: false as const, reason: villageTransferUnlockError(character)! };
    }
    // The rarity ladder (shared/item-level-gate.ts), the same gate the Shop screen,
    // /shop/settle and the equip path apply. Reading the raw levelReq let a modded
    // client buy 92 items below their tier floor (economy rebalance I-9).
    if (!meetsItemLevelReq(item, character.level)) return { ok: false as const, reason: 'level-required' as const };
    const premium = item.rarity === 'legendary' || item.rarity === 'mythic';
    const currency = premium ? 'fateShards' : 'ryo';
    const combatConsumable = item.slot === 'thrown' || item.slot === 'potion'
        || (item.slot === 'item' && (item.weaponEffect != null || item.apCost != null || item.weaponEp != null || item.restoreChakra != null || item.restoreStamina != null));
    const beastSeal = wildBindingSeal(id);
    // Pet food keeps its 9,999 counted stack (pet growth v2). Other pet supplies
    // (PvE gear, battle consumables, evolution stones) buy in bulk too; with no
    // cap they sold one at a time from an empty stack.
    const cap = isPetFood(id) ? 9999 : beastSeal ? 99 : item.slot === 'potion' ? 2 : combatConsumable ? 50 : petSupplyHoldCap(id);
    let qty = cap == null ? 1 : Math.max(1, Math.min(cap, whole(qtyRaw) || 1));
    if (cap != null) qty = Math.min(qty, Math.max(0, cap - itemCount(character, id)));
    else if (itemCount(character, id) > 0 || (tool && gatheringToolOwned(character, id))) return { ok: false as const, reason: 'already-owned' as const };
    if (qty <= 0) return { ok: false as const, reason: 'hold-cap' as const };
    // The one discount rule /shop/settle and the Shop screen use, with the village
    // shop and blacksmith levels capped at 50. This path read the shop level
    // unbounded, so a corrupt or hand-edited level priced below the arbitrage floor.
    const percent = shopDiscountPercent(character, currency);
    const unitCost = tool?.durability === null ? 50 : id === VILLAGE_TRANSFER_SCROLL_ID ? VILLAGE_TRANSFER_COST
        : discountedShopCost(baseCost, percent);
    const totalCost = unitCost * qty;
    const balance = whole(character[currency]);
    if (balance < totalCost) return { ok: false as const, reason: 'insufficient-funds' as const };
    // A stackable buy lands in `itemStacks`, never in `inventory[]` — the same
    // routing api/shop/_settlement.ts, api/clan/_exchange.ts and
    // api/craft/_forge.ts already do. This path used to push `qty` raw copies
    // into `inventory[]` whatever the item was, and the client's
    // normalizeInventory quietly compacted them on the next save.
    //
    // That was invisible until inventory gained a cap, and then it broke the
    // wrong player twice: a 50-shuriken buy read as +50 slots, so the capacity
    // gate refused every potion, pill and shuriken a full-bag veteran tried to
    // buy — the combat consumables, i.e. exactly what a cap should never block —
    // and any save landing before the client compacted ratcheted the
    // non-destructive ceiling in api/save/[name].ts up to 550. With the routing
    // fixed, `inventory[]` only grows for genuinely non-stackable gear, which is
    // always qty 1, so the gate in purchase.ts now fires only when it should.
    if (item.stackable) {
        const stacks = Array.isArray(character.itemStacks) ? character.itemStacks as Array<Record<string, unknown>> : [];
        const held = stacks.findIndex((s) => s?.itemId === id);
        return {
            ok: true as const,
            character: {
                ...character,
                [currency]: balance - totalCost,
                itemStacks: held >= 0
                    ? stacks.map((s, i) => (i === held ? { ...s, count: whole(s.count) + qty } : s))
                    : [...stacks, { itemId: id, count: qty }],
            },
            item: { id, qty, currency, unitCost, totalCost },
        };
    }
    const inventory = Array.isArray(character.inventory) ? character.inventory as string[] : [];
    return {
        ok: true as const,
        character: initializeGatheringTool(withGearTierUnlock({ ...character, [currency]: balance - totalCost, inventory: [...inventory, ...Array.from({ length: qty }, () => id)] }, item), id),
        item: { id, qty, currency, unitCost, totalCost },
    };
}
