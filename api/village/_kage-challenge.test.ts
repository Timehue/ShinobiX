/**
 * Decision-logic guard for the Kage succession system (api/village/kage-challenge.ts).
 * Tests the pure eligibility gates, the overlap "must-accept" obligation math,
 * and the state-machine transitions in _kage-challenge.ts.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    canDeclareChallenge, isChallengeExpired, newChallenge, applyPress,
    applySeatTransfer, applyDefense, applyExpiry,
    KAGE_ACCEPT_OBLIGATION_MS, KAGE_CHALLENGE_EXPIRY_MS, KAGE_POST_DEFENSE_GRACE_MS,
    KAGE_LOSS_COOLDOWN_MS, KAGE_PRESS_MAX_STEP_MS, KAGE_MIN_CHALLENGER_LEVEL,
    KAGE_MIN_CONTRIBUTION, KAGE_DECLARE_SEAL_COST, KAGE_MIN_ACCOUNT_AGE_MS,
    type DeclareInput, type KageStateLike,
} from './_kage-challenge.js';

const NOW = 1_000_000_000_000;
const OLD_ENOUGH = NOW - KAGE_MIN_ACCOUNT_AGE_MS - 1;

function baseState(): KageStateLike {
    return { kageSystemUnlocked: true, seatedKage: 'Raiko', challenge: null };
}
function declareInput(over: Partial<DeclareInput> = {}): DeclareInput {
    return {
        now: NOW,
        state: baseState(),
        challengerName: 'Rill',
        challengerLevel: 95,
        challengerSeals: 1000,
        challengerAccountCreatedAt: OLD_ENOUGH,
        villageContribution: 300,
        isMember: true,
        ...over,
    };
}

describe('canDeclareChallenge — eligibility gates', () => {
    it('passes when every gate is satisfied', () => {
        assert.equal(canDeclareChallenge(declareInput()).ok, true);
    });
    it('blocks a non-member', () => {
        assert.equal(canDeclareChallenge(declareInput({ isMember: false })).ok, false);
    });
    it('blocks the seated Kage from challenging themselves', () => {
        assert.equal(canDeclareChallenge(declareInput({ challengerName: 'Raiko' })).ok, false);
    });
    it(`blocks below level ${KAGE_MIN_CHALLENGER_LEVEL}`, () => {
        assert.equal(canDeclareChallenge(declareInput({ challengerLevel: KAGE_MIN_CHALLENGER_LEVEL - 1 })).ok, false);
    });
    it('blocks a too-new account', () => {
        assert.equal(canDeclareChallenge(declareInput({ challengerAccountCreatedAt: NOW - 1000 })).ok, false);
    });
    it(`blocks below ${KAGE_MIN_CONTRIBUTION} contribution`, () => {
        assert.equal(canDeclareChallenge(declareInput({ villageContribution: KAGE_MIN_CONTRIBUTION - 1 })).ok, false);
    });
    it(`blocks without the ${KAGE_DECLARE_SEAL_COST}-seal stake`, () => {
        assert.equal(canDeclareChallenge(declareInput({ challengerSeals: KAGE_DECLARE_SEAL_COST - 1 })).ok, false);
    });
    it('blocks when an active (non-expired) challenge already exists', () => {
        const state = { ...baseState(), challenge: newChallenge('Someone', NOW) };
        assert.equal(canDeclareChallenge(declareInput({ state })).ok, false);
    });
    it('allows when the existing challenge is already expired', () => {
        const state = { ...baseState(), challenge: newChallenge('Someone', NOW - KAGE_CHALLENGE_EXPIRY_MS - 1) };
        assert.equal(canDeclareChallenge(declareInput({ state })).ok, true);
    });
    it('blocks during the post-defense grace', () => {
        const state = { ...baseState(), postDefenseGraceUntil: NOW + 1000 };
        assert.equal(canDeclareChallenge(declareInput({ state })).ok, false);
    });
    it('blocks a challenger on loss cooldown', () => {
        const state = { ...baseState(), challengerCooldowns: { rill: NOW + 1000 } };
        assert.equal(canDeclareChallenge(declareInput({ state })).ok, false);
    });
});

describe('isChallengeExpired', () => {
    it('false within the window, true past 48h', () => {
        assert.equal(isChallengeExpired(newChallenge('Rill', NOW - 1000), NOW), false);
        assert.equal(isChallengeExpired(newChallenge('Rill', NOW - KAGE_CHALLENGE_EXPIRY_MS - 1), NOW), true);
    });
});

describe('applyPress — overlap obligation', () => {
    it('first press just stamps lastPressAt (no burn — no interval yet)', () => {
        const c = newChallenge('Rill', NOW);
        const r = applyPress(c, NOW + 5000, /*bothOnline*/ true);
        assert.equal(r.burnedMs, 0);
        assert.equal(r.challenge.obligationRemainingMs, KAGE_ACCEPT_OBLIGATION_MS);
        assert.equal(r.challenge.lastPressAt, NOW + 5000);
        assert.equal(r.forfeited, false);
    });
    it('a subsequent press burns the elapsed overlap', () => {
        let c = newChallenge('Rill', NOW);
        c = applyPress(c, NOW, true).challenge;            // stamp
        const r = applyPress(c, NOW + 40_000, true);       // 40s later
        assert.equal(r.burnedMs, 40_000);
        assert.equal(r.challenge.obligationRemainingMs, KAGE_ACCEPT_OBLIGATION_MS - 40_000);
    });
    it('caps a single press at KAGE_PRESS_MAX_STEP_MS', () => {
        let c = newChallenge('Rill', NOW);
        c = applyPress(c, NOW, true).challenge;
        const r = applyPress(c, NOW + 10 * 60_000, true);  // 10 min gap
        assert.equal(r.burnedMs, KAGE_PRESS_MAX_STEP_MS);
    });
    it('does NOT burn when the parties are not both online (the AFK case)', () => {
        let c = newChallenge('Rill', NOW);
        c = applyPress(c, NOW, true).challenge;
        const r = applyPress(c, NOW + 40_000, /*bothOnline*/ false);
        assert.equal(r.burnedMs, 0);
        assert.equal(r.challenge.obligationRemainingMs, KAGE_ACCEPT_OBLIGATION_MS);
    });
    it('forfeits once the obligation is exhausted', () => {
        let c: ReturnType<typeof newChallenge> = { ...newChallenge('Rill', NOW), obligationRemainingMs: 30_000, lastPressAt: NOW };
        const r = applyPress(c, NOW + 60_000, true);       // burns the capped 60s -> <= 0
        assert.equal(r.forfeited, true);
        assert.equal(r.challenge.obligationRemainingMs, 0);
    });
    it('never burns an already-accepted challenge', () => {
        const c = { ...newChallenge('Rill', NOW), status: 'accepted' as const, lastPressAt: NOW };
        const r = applyPress(c, NOW + 60_000, true);
        assert.equal(r.burnedMs, 0);
        assert.equal(r.forfeited, false);
    });
});

describe('state transitions', () => {
    it('applySeatTransfer flips the seat and clears the challenge', () => {
        const state = { ...baseState(), challenge: newChallenge('Rill', NOW), postDefenseGraceUntil: NOW + 999 };
        const next = applySeatTransfer(state, 'Rill');
        assert.equal(next.seatedKage, 'Rill');
        assert.equal(next.challenge, null);
        assert.equal(next.postDefenseGraceUntil, undefined);
    });
    it('applyDefense keeps the Kage, sets grace + challenger cooldown', () => {
        const state = { ...baseState(), challenge: newChallenge('Rill', NOW) };
        const next = applyDefense(state, 'Rill', NOW);
        assert.equal(next.seatedKage, 'Raiko');
        assert.equal(next.challenge, null);
        assert.equal(next.postDefenseGraceUntil, NOW + KAGE_POST_DEFENSE_GRACE_MS);
        assert.equal(next.challengerCooldowns?.rill, NOW + KAGE_LOSS_COOLDOWN_MS);
    });
    it('applyExpiry clears the challenge and cooldowns the abandoning challenger', () => {
        const state = { ...baseState(), challenge: newChallenge('Rill', NOW - KAGE_CHALLENGE_EXPIRY_MS - 1) };
        const next = applyExpiry(state, NOW);
        assert.equal(next.challenge, null);
        assert.equal(next.challengerCooldowns?.rill, NOW + KAGE_LOSS_COOLDOWN_MS);
    });
    it('applyDefense prunes elapsed cooldowns', () => {
        const state = { ...baseState(), challenge: newChallenge('Rill', NOW), challengerCooldowns: { old: NOW - 1 } };
        const next = applyDefense(state, 'Rill', NOW);
        assert.equal(next.challengerCooldowns?.old, undefined, 'stale cooldown pruned');
    });
});
