"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BANK_INTEREST_WINDOW_MS = void 0;
exports.bankInterestPercent = bankInterestPercent;
exports.computeBankInterest = computeBankInterest;
exports.BANK_INTEREST_WINDOW_MS = 24 * 60 * 60 * 1000;
// villageUpgradeDefinitions: { key:'bank', perLevel: 0.25 } and
// VILLAGE_UPGRADE_MAX_LEVEL = 50 (shinobij.client/src/lib/village-upgrades.ts).
const BANK_UPGRADE_PER_LEVEL = 0.25;
const VILLAGE_UPGRADE_MAX_LEVEL = 50;
/** villageUpgradeBonus(character,'bank') — clamp(floor(level),0,50) * 0.25. */
function bankInterestPercent(char) {
    const upgrades = (char.villageUpgrades && typeof char.villageUpgrades === 'object')
        ? char.villageUpgrades
        : {};
    const level = Math.min(VILLAGE_UPGRADE_MAX_LEVEL, Math.max(0, Math.floor(Number(upgrades.bank ?? 0)) || 0));
    return level * BANK_UPGRADE_PER_LEVEL;
}
/**
 * Compute the bank-interest claim for `char` at server time `now`. Returns
 * `eligible:false` (with a reason) for every non-claim path so the caller can
 * report it without crediting; `eligible:true` carries the exact `interest` to
 * add to `bankRyo`. Mirrors the client's claimInterest guards in order.
 */
function computeBankInterest(char, now) {
    const bankRyo = Number(char.bankRyo ?? 0) || 0;
    const lastAt = Number(char.lastBankInterestAt ?? 0);
    const interestPercent = bankInterestPercent(char);
    const nextClaimAt = (Number.isFinite(lastAt) ? lastAt : 0) + exports.BANK_INTEREST_WINDOW_MS;
    if (interestPercent <= 0)
        return { eligible: false, interest: 0, interestPercent, nextClaimAt, reason: 'no-upgrade' };
    if (bankRyo <= 0)
        return { eligible: false, interest: 0, interestPercent, nextClaimAt, reason: 'empty' };
    if (now < nextClaimAt)
        return { eligible: false, interest: 0, interestPercent, nextClaimAt, reason: 'cooldown' };
    const interest = Math.max(0, Math.floor(bankRyo * (interestPercent / 100)));
    if (interest <= 0)
        return { eligible: false, interest: 0, interestPercent, nextClaimAt, reason: 'too-small' };
    return { eligible: true, interest, interestPercent, nextClaimAt, reason: 'ok' };
}
