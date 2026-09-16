// Pure, IO-free core for the server-authoritative Bank-interest claim
// (api/bank/claim-interest.ts — audit #7 / Stage 3 Phase 4f). Split out so the
// payout + eligibility math is unit-testable without storage, same pattern as
// _map-control-reward.ts / _territory-supply.ts / _xp-engine.ts.
//
// The public amount projection is shared with Bank.tsx. The rate still matches
// lib/village-upgrades.ts (pinned by _cross-build-parity.test.ts):
//   interestPercent   = getBankInterestPercent(character)
//                     = villageUpgradeBonus(character,'bank')
//                     = clamp(floor(villageUpgrades.bank), 0, 50) * 0.01
//   nextClaimAt       = (lastBankInterestAt ?? 0) + 24h
//   canClaimInterest  = bankRyo > 0 && interestPercent > 0 && now >= nextClaimAt
//   projectedInterest = shared projectedBankInterest(bankRyo, interestPercent)
// The 24h gate is evaluated against the SERVER clock (not a client Date.now()),
// closing the clock-rollback claim-repeatedly vector that the sanitizer's
// lastBankInterestAt window check also guards.

import { BANK_INTEREST_WINDOW_MS, projectedBankInterest } from '../shared/bank-interest.js';
export { BANK_INTEREST_WINDOW_MS, BANK_INTEREST_PRINCIPAL_CAP } from '../shared/bank-interest.js';
// villageUpgradeDefinitions: { key:'bank', perLevel: 0.01 } and
// VILLAGE_UPGRADE_MAX_LEVEL = 50 (shinobij.client/src/lib/village-upgrades.ts).
// De-inflation (progression redesign Phase 3): cut from 0.25 (12.5%/day max) to
// 0.01 (0.5%/day max) so bank interest is a savings BONUS, not a passive salary
// that dwarfs active play. MIRROR: village-upgrades.ts 'bank' perLevel (parity-pinned
// by _cross-build-parity.test.ts). TUNABLE: 0.05 = a lighter 2.5%/day; 0.002 = 0.1%.
const BANK_UPGRADE_PER_LEVEL = 0.01;
const VILLAGE_UPGRADE_MAX_LEVEL = 50;

type CharLike = Record<string, unknown>;

/** villageUpgradeBonus(character,'bank') — clamp(floor(level),0,50) * 0.01. */
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
    const interest = projectedBankInterest(bankRyo, interestPercent);
    if (interest <= 0) return { eligible: false, interest: 0, interestPercent, nextClaimAt, reason: 'too-small' };
    return { eligible: true, interest, interestPercent, nextClaimAt, reason: 'ok' };
}
