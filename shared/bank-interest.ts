/** Public bank projection rules shared by the screen and authoritative claim.
 * Input normalization, eligibility, and server-clock checks stay with callers. */
export const BANK_INTEREST_WINDOW_MS = 24 * 60 * 60 * 1000;

// Anti-inflation guardrail: only the first 10M banked ryo earns interest. Above
// this cap a balance earns a flat daily amount rather than compounding forever.
// Below the cap the existing rate and rounding apply unchanged.
export const BANK_INTEREST_PRINCIPAL_CAP = 10_000_000;

export function projectedBankInterest(bankRyo: number, interestPercent: number): number {
    const principal = Math.min(bankRyo, BANK_INTEREST_PRINCIPAL_CAP);
    return Math.max(0, Math.floor(principal * (interestPercent / 100)));
}
