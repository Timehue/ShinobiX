/*
 * Rules for player forged named weapons and armor (`named-weapon-*` and
 * `named-armor-*`, minted by api/craft/named.ts).
 *
 * Once a named piece has been equipped even once, it can no longer be listed at
 * the Sunscar Exchange. It can still be sold to the shop for a flat price. The
 * server records the first equip in the server owned character field
 * `equippedNamedGear` (api/save/_named-gear-equipped.ts).
 */
import { FORGED_ITEM_ID } from "./named-forge-roll.js";

/** What the shop pays for any named weapon or armor piece, in ryo. Named gear costs 0, so the half cost rule gives nothing. */
export const NAMED_GEAR_SELL_RYO = 500;

export function isNamedGearId(id: unknown): boolean {
    return typeof id === "string" && FORGED_ITEM_ID.test(id);
}

/**
 * The equipment-map keys a named piece may occupy: the weapon hand, the gloves
 * hand and the five armor slots, plus their legacy aliases. A forged piece has
 * no built-in definition, so the save sanitizer's slot-kind check used to skip
 * it, and every equipment value is summed into combat. A tampered save could
 * then park spare named armor in relic, item1-3, thrown or potion and stack
 * its Absorb/Reflect/Life Steal/damage/shield on top of the six real pieces.
 */
const NAMED_GEAR_EQUIP_SLOTS: ReadonlySet<string> = new Set([
    "hand", "weapon", "gloves", "head", "body", "armor", "waist", "legs", "feet",
]);

/** False only for a named piece in a slot no named piece can be worn in. */
export function namedGearFitsEquipSlot(slot: string, id: unknown): boolean {
    return !isNamedGearId(id) || NAMED_GEAR_EQUIP_SLOTS.has(slot);
}

/** Why a worn named piece cannot be donated to a clan or village treasury, which would let it reach the Exchange through another account. */
export const NAMED_GEAR_DONATE_BLOCK_MESSAGE =
    "Named gear that has been equipped cannot be donated. Sell it to the shop for ryo instead.";

/** Why a worn named piece cannot be listed. One sentence, shown on the Exchange. */
export const NAMED_GEAR_EXCHANGE_BLOCK_MESSAGE =
    "Named gear that has been equipped can no longer be sold at Sunscar Exchange. Sell it to the shop for ryo instead.";
