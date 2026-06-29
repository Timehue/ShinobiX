// Pure, IO-free core for the server-authoritative Bank-interest claim
// (api/bank/claim-interest.ts — audit #7 / Stage 3 Phase 4f). Split out so the
// payout + eligibility math is unit-testable without storage, same pattern as
// _map-control-reward.ts / _territory-supply.ts / _xp-engine.ts.
//
// VERBATIM port of the client (shinobij.client/src/screens/Bank.tsx +
// lib/village-upgrades.ts):
//   interestPercent   = getBankInterestPercent(character)
//                     = villageUpgradeBonus(character,'bank')
//                     = clamp(floor(villageUpgrades.bank), 0, 50) * 0.25
//   nextClaimAt       = (lastBankInterestAt ?? 0) + 24h
//   canClaimInterest  = bankRyo > 0 && interestPercent > 0 && now >= nextClaimAt
//   projectedInterest = max(0, floor(bankRyo * (interestPercent / 100)))
// The 24h gate is evaluated against the SERVER clock (not a client Date.now()),
// closing the clock-rollback claim-repeatedly vector that the sanitizer's
// lastBankInterestAt window check also guards.

export const BANK_INTEREST_WINDOW_MS = 24 * 60 * 60 * 1000;
// villageUpgradeDefinitions: { key:'bank', perLevel: 0.01 } and
// VILLAGE_UPGRADE_MAX_LEVEL = 50 (shinobij.client/src/lib/village-upgrades.ts).
// De-inflation (progression redesign Phase 3): cut from 0.25 (12.5%/day max) to
// 0.01 (0.5%/day max) so bank interest is a savings BONUS, not a passive salary
// that dwarfs active play. MIRROR: village-upgrades.ts 'bank' perLevel (parity-pinned
// by _cross-build-parity.test.ts). TUNABLE: 0.05 = a lighter 2.5%/day; 0.002 = 0.1%.
const BANK_UPGRADE_PER_LEVEL = 0.01;
const VILLAGE_UPGRADE_MAX_LEVEL = 50;

// Anti-inflation guardrail (gameplay-loop audit M-2). Interest is paid on at
// most this much principal, so a very large vault earns a FLAT (linear) amount
// rather than an unbounded COMPOUNDING one — past the cap, the balance grows by
// a fixed daily ryo figure, not a fixed percentage, so it can't double itself
// forever. Below the cap behaviour is identical to before (no rate change), and
// the cap is far above any normal balance (the top wealth achievement is 5M
// wallet+bank), so legitimate players are unaffected. TUNABLE: lower to tighten
// the faucet. MIRROR: shinobij.client/src/screens/Bank.tsx `projectedInterest`.
export const BANK_INTEREST_PRINCIPAL_CAP = 10_000_000;

type CharLike = Record<string, unknown>;

/** villageUpgradeBonus(character,'bank') — clamp(floor(level),0,50) * 0.25. */
export function bankInterestPercent(char: CharLike): number {
    const upgrades = (char.villageUpgrades && typeof char.villageUpgrades === 'object')
        ? (char.villageUpgrades as Record<string, unknown>)
        : {};
    const level = Math.min(VILLAGE_UPGRADE_MAX_LEVEL, Math.max(0, Math.floor(Number(upgrades.bank ?? 0)) || 0));
    return level * BANK_UPGRADE_PER_LEVEL;
}

export type BankInterestResult = {
    eligible: boolean;
    interest: number;
    interestPercent: number;
    nextClaimAt: number;
    reason: 'ok' | 'no-upgrade' | 'empty' | 'cooldown' | 'too-small';
};

/**
 * Compute the bank-interest claim for `char` at server time `now`. Returns
 * `eligible:false` (with a reason) for every non-claim path so the caller can
 * report it without crediting; `eligible:true` carries the exact `interest` to
 * add to `bankRyo`. Mirrors the client's claimInterest guards in order.
 */
export function computeBankInterest(char: CharLike, now: number): BankInterestResult {
    const bankRyo = Number(char.bankRyo ?? 0) || 0;
    const lastAt = Number(char.lastBankInterestAt ?? 0);
    const interestPercent = bankInterestPercent(char);
    const nextClaimAt = (Number.isFinite(lastAt) ? lastAt : 0) + BANK_INTEREST_WINDOW_MS;
    if (interestPercent <= 0) return { eligible: false, interest: 0, interestPercent, nextClaimAt, reason: 'no-upgrade' };
    if (bankRyo <= 0) return { eligible: false, interest: 0, interestPercent, nextClaimAt, reason: 'empty' };
    if (now < nextClaimAt) return { eligible: false, interest: 0, interestPercent, nextClaimAt, reason: 'cooldown' };
    // Pay interest only on the first BANK_INTEREST_PRINCIPAL_CAP ryo (M-2).
    const principal = Math.min(bankRyo, BANK_INTEREST_PRINCIPAL_CAP);
    const interest = Math.max(0, Math.floor(principal * (interestPercent / 100)));
    if (interest <= 0) return { eligible: false, interest: 0, interestPercent, nextClaimAt, reason: 'too-small' };
    return { eligible: true, interest, interestPercent, nextClaimAt, reason: 'ok' };
}
