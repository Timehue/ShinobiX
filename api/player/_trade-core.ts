/*
 * Pure math + validation for direct player-to-player transfers
 * (api/player/trade.ts). Split out so the tax, caps and balance checks are
 * unit-testable and the magnitudes live in one reviewable place.
 *
 * One-way SEND model (not a two-way escrow): the sender is debited the full
 * `amount`; the recipient receives `amount` minus a flat tax that is BURNED
 * (removed from the economy). The burn is the economy sink — every trade
 * permanently shrinks the money supply, which is the whole point of routing
 * player wealth-shuffling through a taxed channel instead of a free one.
 *
 * Honor seals (Vanguard-locked) and mythic seals are deliberately NOT tradeable
 * — trading them would launder a profession-exclusive / top-rarity currency.
 */

export const TRADE_TAX_PCT = 0.10; // 10% of every transfer is burned

export type TradeCurrency = 'ryo' | 'fateShards' | 'boneCharms' | 'auraStones';
export const TRADE_CURRENCIES: TradeCurrency[] = ['ryo', 'fateShards', 'boneCharms', 'auraStones'];

// Per-transfer ceilings (mirror the clan/village treasury-transfer caps so no
// single call can move an unbounded amount) and floors (kill dust-spam trades).
// The rare currencies start at 2 (2026-10 economy rebalance, the trade half of
// I-16): a 1-unit trade burned nothing, so 1,000 one-shard sends moved a whole
// daily budget at 0%. From 2 units the floored tax always burns at least one,
// matching TREASURY_GIFT_MIN_AMOUNT so neither channel undercuts the other.
// MIRROR: shinobij.client/src/lib/player-trade.ts (parity-pinned).
export const TRADE_CAPS: Record<TradeCurrency, number> = { ryo: 200_000, fateShards: 200, boneCharms: 200, auraStones: 200 };
export const TRADE_MINS: Record<TradeCurrency, number> = { ryo: 1_000, fateShards: 2, boneCharms: 2, auraStones: 2 };

export function isTradeCurrency(c: unknown): c is TradeCurrency {
    return typeof c === 'string' && (TRADE_CURRENCIES as string[]).includes(c);
}

function n(v: unknown): number {
    const x = Math.floor(Number(v));
    return Number.isFinite(x) && x > 0 ? x : 0;
}

export type TradePlan =
    | { ok: true; currency: TradeCurrency; debit: number; credit: number; burned: number }
    | { ok: false; reason: string };

/**
 * Validate a transfer and compute the debit / credit / burn split.
 * `senderBalance` is the sender's CURRENT balance of that currency (read fresh
 * under the lock). Amount is floored; tax is floored so the burn is at least the
 * rounding remainder and the recipient never gets more than the sender loses.
 */
export function planTrade(currency: unknown, amountRaw: unknown, senderBalance: unknown): TradePlan {
    if (!isTradeCurrency(currency)) return { ok: false, reason: 'That currency cannot be traded.' };
    const amount = Math.floor(Number(amountRaw));
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'Enter a valid amount.' };
    if (amount < TRADE_MINS[currency]) return { ok: false, reason: `Minimum transfer is ${TRADE_MINS[currency].toLocaleString()} ${currency}.` };
    if (amount > TRADE_CAPS[currency]) return { ok: false, reason: `Maximum per transfer is ${TRADE_CAPS[currency].toLocaleString()} ${currency}.` };
    if (n(senderBalance) < amount) return { ok: false, reason: `You don't have ${amount.toLocaleString()} ${currency}.` };
    // Floored, so the burn absorbs the rounding remainder — except at a single
    // unit, where flooring would credit 0 and the trade would deliver nothing.
    // TRADE_MINS no longer admits a single unit, so this floor is now only a
    // guard that keeps a lowered minimum from ever crediting 0.
    const credit = Math.max(1, Math.floor(amount * (1 - TRADE_TAX_PCT)));
    const burned = amount - credit;
    return { ok: true, currency, debit: amount, credit, burned };
}
