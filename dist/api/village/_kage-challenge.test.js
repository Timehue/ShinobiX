"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Decision-logic guard for the Kage succession system (api/village/kage-challenge.ts).
 * Tests the pure eligibility gates, the overlap "must-accept" obligation math,
 * and the state-machine transitions in _kage-challenge.ts.
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _kage_challenge_js_1 = require("./_kage-challenge.js");
const NOW = 1_000_000_000_000;
const OLD_ENOUGH = NOW - _kage_challenge_js_1.KAGE_MIN_ACCOUNT_AGE_MS - 1;
function baseState() {
    return { kageSystemUnlocked: true, seatedKage: 'Raiko', challenge: null };
}
function declareInput(over = {}) {
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
(0, node_test_1.describe)('canDeclareChallenge — eligibility gates', () => {
    (0, node_test_1.it)('passes when every gate is satisfied', () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput()).ok, true);
    });
    (0, node_test_1.it)('blocks a non-member', () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput({ isMember: false })).ok, false);
    });
    (0, node_test_1.it)('blocks the seated Kage from challenging themselves', () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput({ challengerName: 'Raiko' })).ok, false);
    });
    (0, node_test_1.it)(`blocks below level ${_kage_challenge_js_1.KAGE_MIN_CHALLENGER_LEVEL}`, () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput({ challengerLevel: _kage_challenge_js_1.KAGE_MIN_CHALLENGER_LEVEL - 1 })).ok, false);
    });
    (0, node_test_1.it)('blocks a too-new account', () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput({ challengerAccountCreatedAt: NOW - 1000 })).ok, false);
    });
    (0, node_test_1.it)(`blocks below ${_kage_challenge_js_1.KAGE_MIN_CONTRIBUTION} contribution`, () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput({ villageContribution: _kage_challenge_js_1.KAGE_MIN_CONTRIBUTION - 1 })).ok, false);
    });
    (0, node_test_1.it)(`blocks without the ${_kage_challenge_js_1.KAGE_DECLARE_SEAL_COST}-seal stake`, () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput({ challengerSeals: _kage_challenge_js_1.KAGE_DECLARE_SEAL_COST - 1 })).ok, false);
    });
    (0, node_test_1.it)('blocks when an active (non-expired) challenge already exists', () => {
        const state = { ...baseState(), challenge: (0, _kage_challenge_js_1.newChallenge)('Someone', NOW) };
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput({ state })).ok, false);
    });
    (0, node_test_1.it)('allows when the existing challenge is already expired', () => {
        const state = { ...baseState(), challenge: (0, _kage_challenge_js_1.newChallenge)('Someone', NOW - _kage_challenge_js_1.KAGE_CHALLENGE_EXPIRY_MS - 1) };
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput({ state })).ok, true);
    });
    (0, node_test_1.it)('blocks during the post-defense grace', () => {
        const state = { ...baseState(), postDefenseGraceUntil: NOW + 1000 };
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput({ state })).ok, false);
    });
    (0, node_test_1.it)('blocks a challenger on loss cooldown', () => {
        const state = { ...baseState(), challengerCooldowns: { rill: NOW + 1000 } };
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput({ state })).ok, false);
    });
});
(0, node_test_1.describe)('isChallengeExpired', () => {
    (0, node_test_1.it)('false within the window, true past 48h', () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.isChallengeExpired)((0, _kage_challenge_js_1.newChallenge)('Rill', NOW - 1000), NOW), false);
        node_assert_1.strict.equal((0, _kage_challenge_js_1.isChallengeExpired)((0, _kage_challenge_js_1.newChallenge)('Rill', NOW - _kage_challenge_js_1.KAGE_CHALLENGE_EXPIRY_MS - 1), NOW), true);
    });
});
(0, node_test_1.describe)('applyPress — overlap obligation', () => {
    (0, node_test_1.it)('first press just stamps lastPressAt (no burn — no interval yet)', () => {
        const c = (0, _kage_challenge_js_1.newChallenge)('Rill', NOW);
        const r = (0, _kage_challenge_js_1.applyPress)(c, NOW + 5000, /*bothOnline*/ true);
        node_assert_1.strict.equal(r.burnedMs, 0);
        node_assert_1.strict.equal(r.challenge.obligationRemainingMs, _kage_challenge_js_1.KAGE_ACCEPT_OBLIGATION_MS);
        node_assert_1.strict.equal(r.challenge.lastPressAt, NOW + 5000);
        node_assert_1.strict.equal(r.forfeited, false);
    });
    (0, node_test_1.it)('a subsequent press burns the elapsed overlap', () => {
        let c = (0, _kage_challenge_js_1.newChallenge)('Rill', NOW);
        c = (0, _kage_challenge_js_1.applyPress)(c, NOW, true).challenge; // stamp
        const r = (0, _kage_challenge_js_1.applyPress)(c, NOW + 40_000, true); // 40s later
        node_assert_1.strict.equal(r.burnedMs, 40_000);
        node_assert_1.strict.equal(r.challenge.obligationRemainingMs, _kage_challenge_js_1.KAGE_ACCEPT_OBLIGATION_MS - 40_000);
    });
    (0, node_test_1.it)('caps a single press at KAGE_PRESS_MAX_STEP_MS', () => {
        let c = (0, _kage_challenge_js_1.newChallenge)('Rill', NOW);
        c = (0, _kage_challenge_js_1.applyPress)(c, NOW, true).challenge;
        const r = (0, _kage_challenge_js_1.applyPress)(c, NOW + 10 * 60_000, true); // 10 min gap
        node_assert_1.strict.equal(r.burnedMs, _kage_challenge_js_1.KAGE_PRESS_MAX_STEP_MS);
    });
    (0, node_test_1.it)('does NOT burn when the parties are not both online (the AFK case)', () => {
        let c = (0, _kage_challenge_js_1.newChallenge)('Rill', NOW);
        c = (0, _kage_challenge_js_1.applyPress)(c, NOW, true).challenge;
        const r = (0, _kage_challenge_js_1.applyPress)(c, NOW + 40_000, /*bothOnline*/ false);
        node_assert_1.strict.equal(r.burnedMs, 0);
        node_assert_1.strict.equal(r.challenge.obligationRemainingMs, _kage_challenge_js_1.KAGE_ACCEPT_OBLIGATION_MS);
    });
    (0, node_test_1.it)('forfeits once the obligation is exhausted', () => {
        let c = { ...(0, _kage_challenge_js_1.newChallenge)('Rill', NOW), obligationRemainingMs: 30_000, lastPressAt: NOW };
        const r = (0, _kage_challenge_js_1.applyPress)(c, NOW + 60_000, true); // burns the capped 60s -> <= 0
        node_assert_1.strict.equal(r.forfeited, true);
        node_assert_1.strict.equal(r.challenge.obligationRemainingMs, 0);
    });
    (0, node_test_1.it)('never burns an already-accepted challenge', () => {
        const c = { ...(0, _kage_challenge_js_1.newChallenge)('Rill', NOW), status: 'accepted', lastPressAt: NOW };
        const r = (0, _kage_challenge_js_1.applyPress)(c, NOW + 60_000, true);
        node_assert_1.strict.equal(r.burnedMs, 0);
        node_assert_1.strict.equal(r.forfeited, false);
    });
});
(0, node_test_1.describe)('state transitions', () => {
    (0, node_test_1.it)('applySeatTransfer flips the seat and clears the challenge', () => {
        const state = { ...baseState(), challenge: (0, _kage_challenge_js_1.newChallenge)('Rill', NOW), postDefenseGraceUntil: NOW + 999 };
        const next = (0, _kage_challenge_js_1.applySeatTransfer)(state, 'Rill');
        node_assert_1.strict.equal(next.seatedKage, 'Rill');
        node_assert_1.strict.equal(next.challenge, null);
        node_assert_1.strict.equal(next.postDefenseGraceUntil, undefined);
    });
    (0, node_test_1.it)('applyDefense keeps the Kage, sets grace + challenger cooldown', () => {
        const state = { ...baseState(), challenge: (0, _kage_challenge_js_1.newChallenge)('Rill', NOW) };
        const next = (0, _kage_challenge_js_1.applyDefense)(state, 'Rill', NOW);
        node_assert_1.strict.equal(next.seatedKage, 'Raiko');
        node_assert_1.strict.equal(next.challenge, null);
        node_assert_1.strict.equal(next.postDefenseGraceUntil, NOW + _kage_challenge_js_1.KAGE_POST_DEFENSE_GRACE_MS);
        node_assert_1.strict.equal(next.challengerCooldowns?.rill, NOW + _kage_challenge_js_1.KAGE_LOSS_COOLDOWN_MS);
    });
    (0, node_test_1.it)('applyExpiry clears the challenge and cooldowns the abandoning challenger', () => {
        const state = { ...baseState(), challenge: (0, _kage_challenge_js_1.newChallenge)('Rill', NOW - _kage_challenge_js_1.KAGE_CHALLENGE_EXPIRY_MS - 1) };
        const next = (0, _kage_challenge_js_1.applyExpiry)(state, NOW);
        node_assert_1.strict.equal(next.challenge, null);
        node_assert_1.strict.equal(next.challengerCooldowns?.rill, NOW + _kage_challenge_js_1.KAGE_LOSS_COOLDOWN_MS);
    });
    (0, node_test_1.it)('applyDefense prunes elapsed cooldowns', () => {
        const state = { ...baseState(), challenge: (0, _kage_challenge_js_1.newChallenge)('Rill', NOW), challengerCooldowns: { old: NOW - 1 } };
        const next = (0, _kage_challenge_js_1.applyDefense)(state, 'Rill', NOW);
        node_assert_1.strict.equal(next.challengerCooldowns?.old, undefined, 'stale cooldown pruned');
    });
});
