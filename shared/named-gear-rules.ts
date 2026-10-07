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

/** Why a worn named piece cannot be donated to a clan or village treasury, which would let it reach the Exchange through another account. */
export const NAMED_GEAR_DONATE_BLOCK_MESSAGE =
    "Named gear that has been equipped cannot be donated. Sell it to the shop for ryo instead.";

/** Why a worn named piece cannot be listed. One sentence, shown on the Exchange. */
export const NAMED_GEAR_EXCHANGE_BLOCK_MESSAGE =
    "Named gear that has been equipped can no longer be sold at Sunscar Exchange. Sell it to the shop for ryo instead.";
