import { ITEM_CATALOG } from '../pvp/_item-catalog.js';

type Character = Record<string, unknown>;

function whole(value: unknown): number { return Math.max(0, Math.floor(Number(value) || 0)); }
function itemCount(character: Character, id: string): number {
    const inline = Array.isArray(character.inventory) ? character.inventory.filter((x) => x === id).length : 0;
    const stacked = Array.isArray(character.itemStacks)
        ? (character.itemStacks as Array<Record<string, unknown>>).filter((s) => s?.itemId === id).reduce((n, s) => n + whole(s.count), 0) : 0;
    return inline + stacked;
}

function purchaseDiscount(character: Character, premium: boolean): number {
    if (premium) return character.elderFocus === 'trade' ? 5 : 0;
    const upgrades = character.villageUpgrades as Record<string, unknown> | undefined;
    const clanUpgrades = character.clanUpgradeLevels as Record<string, unknown> | undefined;
    return whole(upgrades?.shop) * 0.25
        + (character.elderFocus === 'trade' ? 5 : 0)
        + Math.min(10, whole(clanUpgrades?.blacksmith) * 0.2)
        + (character.clanDoctrine === 'merchant' ? 5 : 0);
}

export function purchaseCatalogItem(character: Character, itemId: unknown, qtyRaw: unknown) {
    const id = typeof itemId === 'string' ? itemId : '';
    const item = ITEM_CATALOG[id];
    const baseCost = whole(item?.cost);
    if (!item || baseCost <= 0) return { ok: false as const, reason: 'item-not-for-sale' as const };
    if (whole(character.level) < whole(item.levelReq ?? 1)) return { ok: false as const, reason: 'level-required' as const };
    const premium = item.rarity === 'legendary' || item.rarity === 'mythic';
    const currency = premium ? 'fateShards' : 'ryo';
    const combatConsumable = item.slot === 'thrown' || item.slot === 'potion'
        || (item.slot === 'item' && (item.weaponEffect != null || item.apCost != null || item.weaponEp != null || item.restoreChakra != null || item.restoreStamina != null));
    const cap = item.slot === 'potion' ? 2 : combatConsumable ? 50 : null;
    let qty = cap == null ? 1 : Math.max(1, Math.min(50, whole(qtyRaw) || 1));
    if (cap != null) qty = Math.min(qty, Math.max(0, cap - itemCount(character, id)));
    else if (itemCount(character, id) > 0) return { ok: false as const, reason: 'already-owned' as const };
    if (qty <= 0) return { ok: false as const, reason: 'hold-cap' as const };
    const percent = purchaseDiscount(character, premium);
    const unitCost = Math.max(1, Math.floor(baseCost * Math.max(0, 1 - percent / 100)));
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
        character: { ...character, [currency]: balance - totalCost, inventory: [...inventory, ...Array.from({ length: qty }, () => id)] },
        item: { id, qty, currency, unitCost, totalCost },
    };
}
