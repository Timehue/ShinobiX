/** Public bank projection rules shared by the screen and authoritative claim.
 * Input normalization, eligibility, and server-clock checks stay with callers. */
export const BANK_INTEREST_WINDOW_MS = 24 * 60 * 60 * 1000;

// Passive-income ceiling (2026-10 economy rebalance, #14): only the first 1M
// banked ryo earns interest, so a max-level Bank pays at most 5,000 a day, about
// 11% of a regular L90 day instead of more than all of it. The vault still holds
// any amount; above the cap a balance earns the flat capped amount. Below the
// cap the existing rate and rounding apply unchanged.
//
// This is the code default of the server dial BANK_INTEREST_PRINCIPAL_CAP
// (api/_bank-interest.ts, kill value 10,000,000). The screen's preview and copy
// read this constant, so a lasting change edits it here, not only the env.
export const BANK_INTEREST_PRINCIPAL_CAP = 1_000_000;

export function projectedBankInterest(
    bankRyo: number,
    interestPercent: number,
    principalCap: number = BANK_INTEREST_PRINCIPAL_CAP,
): number {
    const principal = Math.min(bankRyo, principalCap);
    return Math.max(0, Math.floor(principal * (interestPercent / 100)));
}
