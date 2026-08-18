/*
 * Treasury gift tax (owner ruling 2026-08-17 — "your call").
 *
 * ── The hole this closes ────────────────────────────────────────────────────
 * /api/player/trade is the DESIGNED player-to-player channel: 200,000 ryo per
 * call, 10% burned, and refused outright when both sides share an IP or device
 * fingerprint. That burn is the economy's only sink for player wealth-shuffling.
 *
 * The treasury path did the same job with none of the controls — donate up to
 * 10,000,000 ryo in one call at 0%, then gift it back out at 0% with no
 * shared-connection check. Clan creation is free, so the bypass cost nothing to
 * set up: found a clan, invite the receiving account, and move unlimited wealth
 * untaxed. The burn would have looked like it was working in telemetry, because
 * the volume that mattered never touched it.
 *
 * ── Why the split ───────────────────────────────────────────────────────────
 * A flat burn on every gift would have taxed the Honor Seal redistribution that
 * the village economy DEPENDS on: seals are the Vanguard's PvP earnings, they
 * fund shared village upgrades, and moving them around is community supply
 * rather than wealth transfer. Taxing that would tax the design.
 *
 * So: Honor Seals are exempt. Everything else — the currencies a player would
 * actually launder — burns at the same rate as a direct trade.
 *
 * Donations stay untaxed in every currency: money sitting in a shared pool has
 * not been privatised yet. The tax lands on the GIFT leg, where it leaves the
 * pool and becomes one player's property.
 */

/** Mirrors TRADE_TAX_PCT in api/player/_trade-core.ts — the two must agree, or
 *  one channel becomes the cheap way to move wealth. */
export const TREASURY_GIFT_TAX_PCT = 0.10;

/**
 * Currencies that move through a treasury gift UNTAXED.
 *
 * `honorSeals` only. They are Vanguard PvP earnings whose whole purpose is to
 * fund shared village upgrades; a leader handing them to a member is the
 * village economy working, not someone dodging a trade tax.
 */
export const GIFT_TAX_EXEMPT_CURRENCIES: readonly string[] = ['honorSeals'];

export type TreasuryGiftSplit = {
    /** Debited from the treasury — always the full amount. */
    debit: number;
    /** Credited to the recipient. */
    credit: number;
    /** Removed from the economy entirely. */
    burned: number;
    exempt: boolean;
};

/**
 * Split one treasury gift into credit and burn. The treasury always loses the
 * full `amount`; the burn is the difference. Floored so the burn absorbs the
 * rounding remainder and a recipient can never receive more than the pool lost.
 *
 * One exception to the floor: a gift of a single unit delivers that unit. The
 * rare treasury currencies (mythic seals, aura stones, bone charms) are handed
 * out one at a time — floor(1 * 0.9) = 0 would have made the leader pay a unit
 * and the member receive nothing, which reads as a broken button rather than a
 * tax. Only the amount === 1 case is special-cased; every larger gift keeps the
 * exact floored split, so the burn stays intact where laundering is possible.
 */
export function planTreasuryGift(currency: unknown, amountRaw: unknown): TreasuryGiftSplit {
    const amount = Math.max(0, Math.floor(Number(amountRaw) || 0));
    const exempt = typeof currency === 'string' && GIFT_TAX_EXEMPT_CURRENCIES.includes(currency);
    if (exempt || amount <= 0) return { debit: amount, credit: amount, burned: 0, exempt: true };
    const credit = Math.max(1, Math.floor(amount * (1 - TREASURY_GIFT_TAX_PCT)));
    return { debit: amount, credit, burned: amount - credit, exempt: false };
}
