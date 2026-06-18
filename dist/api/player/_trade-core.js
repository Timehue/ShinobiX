"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRADE_MINS = exports.TRADE_CAPS = exports.TRADE_CURRENCIES = exports.TRADE_TAX_PCT = void 0;
exports.isTradeCurrency = isTradeCurrency;
exports.planTrade = planTrade;
exports.TRADE_TAX_PCT = 0.10; // 10% of every transfer is burned
exports.TRADE_CURRENCIES = ['ryo', 'fateShards', 'boneCharms', 'auraStones'];
// Per-transfer ceilings (mirror the clan/village treasury-transfer caps so no
// single call can move an unbounded amount) and floors (kill dust-spam trades).
exports.TRADE_CAPS = { ryo: 200_000, fateShards: 200, boneCharms: 200, auraStones: 200 };
exports.TRADE_MINS = { ryo: 1_000, fateShards: 1, boneCharms: 1, auraStones: 1 };
function isTradeCurrency(c) {
    return typeof c === 'string' && exports.TRADE_CURRENCIES.includes(c);
}
function n(v) {
    const x = Math.floor(Number(v));
    return Number.isFinite(x) && x > 0 ? x : 0;
}
/**
 * Validate a transfer and compute the debit / credit / burn split.
 * `senderBalance` is the sender's CURRENT balance of that currency (read fresh
 * under the lock). Amount is floored; tax is floored so the burn is at least the
 * rounding remainder and the recipient never gets more than the sender loses.
 */
function planTrade(currency, amountRaw, senderBalance) {
    if (!isTradeCurrency(currency))
        return { ok: false, reason: 'That currency cannot be traded.' };
    const amount = Math.floor(Number(amountRaw));
    if (!Number.isFinite(amount) || amount <= 0)
        return { ok: false, reason: 'Enter a valid amount.' };
    if (amount < exports.TRADE_MINS[currency])
        return { ok: false, reason: `Minimum transfer is ${exports.TRADE_MINS[currency].toLocaleString()} ${currency}.` };
    if (amount > exports.TRADE_CAPS[currency])
        return { ok: false, reason: `Maximum per transfer is ${exports.TRADE_CAPS[currency].toLocaleString()} ${currency}.` };
    if (n(senderBalance) < amount)
        return { ok: false, reason: `You don't have ${amount.toLocaleString()} ${currency}.` };
    const credit = Math.floor(amount * (1 - exports.TRADE_TAX_PCT));
    const burned = amount - credit;
    return { ok: true, currency, debit: amount, credit, burned };
}
