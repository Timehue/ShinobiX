/*
 * The ryo-value an ITEM donation to the village treasury earns Village Merit on
 * (meritForDonation in ./_village-merit.ts). Merit gates a Kage challenge, so
 * this basis is balance, not plumbing (economy rebalance 2026-10, I-7).
 *
 * Every item used to count a flat 500 ryo, so 500 junk items cleared the
 * 250-merit Kage gate in about ten clicks. Now:
 *   - Village Stores PROVISIONS (rations and supply bundles, consumed by wars,
 *     mercs and garrisons) keep their flat 500 per item. The 40-provision daily
 *     donor cap already bounds that route at 20 merit a day, and the stock is
 *     consumed, so it cannot be gifted back and donated again.
 *   - Village Stores MATERIALS (hunt materials and relics, consumed into
 *     material points) count at their NPC sale value: an item is worth exactly
 *     what selling it and donating the ryo would earn.
 *   - Any other item stays a loose treasury item the seated Kage can gift back
 *     untaxed, which made merit free to repeat. It earns none; selling it and
 *     donating the ryo earns the same merit honestly.
 */
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { npcSaleValue } from '../inventory/_sale.js';
import type { SettlementItem } from '../shop/_catalog.js';
import type { StoresRouted } from '../_treasury-stores-donate.js';

/** Ryo-value per item for a donation routed into Village Stores provisions. */
export const VILLAGE_PROVISIONS_MERIT_RYO_PER_ITEM = 500;

/**
 * What /api/inventory/sell credits for one unit of a built-in item, or 0 when
 * the shop will not buy it. It reads the sale route's own price (npcSaleValue),
 * so merit can never drift from the sale price (hunt material re-prices, gear
 * steps, crafted-goods caps) as those tables change.
 */
export function npcUnitSaleValue(itemId: string): number {
    const raw = ITEM_CATALOG[itemId];
    if (!raw) return 0;
    return npcSaleValue({ ...raw, cost: Math.max(0, Math.floor(Number((raw as { cost?: unknown }).cost) || 0)) } as SettlementItem);
}

/** Ryo-value of an item donation for Village Merit, given where Village Stores routed it. */
export function itemDonationMeritRyoValue(itemId: string, count: number, routed: Pick<StoresRouted, 'store'> | null): number {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (!routed) return 0;
    if (routed.store === 'provisions') return n * VILLAGE_PROVISIONS_MERIT_RYO_PER_ITEM;
    return n * npcUnitSaleValue(itemId);
}
