/*
 * PARKED / UNWIRED FUTURE LEVER — pure math with no production importer yet (only
 * its own _war-tax.test.ts imports it). Intentionally kept as the ready-to-wire
 * ryo-burn sink for the Village War economy; do NOT flag as dead code or delete.
 *
 * Village War Map — the lazy per-player tax (pure core, Phase 1). §6.4 / §8.2
 *
 * Applied lazily when a village member is active (the IO call-site — gated by
 * ENABLE_VILLAGE_TAX — lands with the sector-war engine, since in Phase 1 every
 * village still holds its 8 home sectors → the 0% tier → the tax is a no-op until
 * a village can be conquered below 8). This module is the pure math the wiring
 * will call: how many days are owed, and the wallet+bank debit + treasury split.
 *
 * Debits wallet ryo first, then banked ryo. Academy Students (level < 15) are a
 * total no-op (no stamp, no write). The 0% tier (full-control village), the
 * wealth exemption, and a same-day re-run all yield no debit. IO-free.
 */

import { computeTax, TAX_MIN_RANK_LEVEL, TAX_BURN_SHARE } from './_war-economy.js';

/** Whole UTC days between two YYYY-MM-DD strings. An empty `lastDate` (never
 *  taxed) counts as 1 day owed. Negative (clock skew) and same-day return ≤ 0. */
export function daysSince(lastDate: string, today: string): number {
    if (!lastDate) return 1;
    const a = Date.parse(`${lastDate}T00:00:00Z`);
    const b = Date.parse(`${today}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
    return Math.floor((b - a) / 86_400_000);
}

export interface PlayerTaxOutcome {
    /** true if any ryo was actually debited */
    taxed: boolean;
    /** what the tier+wealth math said was due (may exceed what could be paid) */
    owed: number;
    fromWallet: number;
    fromBank: number;
    toBurn: number;
    toTreasury: number;
    nextRyo: number;
    nextBankRyo: number;
    /** the lastTaxDate to persist. Equal to the input when this is a true no-op
     *  (Academy / unchanged) so the caller can skip the save write entirely. */
    nextLastTaxDate: string;
    /** true when nothing changed and the caller should NOT write the save */
    noWrite: boolean;
}

/** Pure: apply the daily village tax to a player's currency fields. The caller
 *  supplies the player's village sector count (drives the tier) and today's UTC
 *  date. Reads `ryo`, `bankRyo`, `level`, `lastTaxDate`. */
export function applyPlayerTax(
    char: { ryo?: number; bankRyo?: number; level?: number; lastTaxDate?: string },
    opts: { sectorsControlled: number; today: string },
): PlayerTaxOutcome {
    const ryo = Math.max(0, Math.floor(Number(char.ryo) || 0));
    const bankRyo = Math.max(0, Math.floor(Number(char.bankRyo) || 0));
    const last = typeof char.lastTaxDate === 'string' ? char.lastTaxDate : '';
    const level = Math.floor(Number(char.level) || 0);

    const unchanged: PlayerTaxOutcome = {
        taxed: false, owed: 0, fromWallet: 0, fromBank: 0, toBurn: 0, toTreasury: 0,
        nextRyo: ryo, nextBankRyo: bankRyo, nextLastTaxDate: last, noWrite: true,
    };
    // Academy Students: total no-op — no debit, no stamp, no save write. Keeps the
    // entire new-player population off the tax path with zero churn.
    if (level < TAX_MIN_RANK_LEVEL) return unchanged;

    // Past this point we stamp the date even on a zero-tax day so we don't recompute
    // every load (a cheap stamp, but it IS a write — flagged via noWrite=false).
    const stamped: PlayerTaxOutcome = { ...unchanged, nextLastTaxDate: opts.today, noWrite: last === opts.today };

    const daysOwed = daysSince(last, opts.today);
    if (daysOwed <= 0) return stamped; // same day / clock skew

    const tax = computeTax({ ryo, bankRyo, sectors: opts.sectorsControlled, level, daysOwed });
    if (tax.owed <= 0) return stamped; // 0% tier (full control) or under the exemption

    const fromWallet = Math.min(ryo, tax.owed);
    const fromBank = Math.min(bankRyo, tax.owed - fromWallet);
    const debited = fromWallet + fromBank;
    // Split burn/treasury on what was ACTUALLY collected (wallet+bank may be < owed).
    const toBurn = Math.round(debited * TAX_BURN_SHARE);
    return {
        taxed: debited > 0,
        owed: tax.owed,
        fromWallet,
        fromBank,
        toBurn,
        toTreasury: debited - toBurn,
        nextRyo: ryo - fromWallet,
        nextBankRyo: bankRyo - fromBank,
        nextLastTaxDate: opts.today,
        noWrite: debited === 0 && last === opts.today,
    };
}
