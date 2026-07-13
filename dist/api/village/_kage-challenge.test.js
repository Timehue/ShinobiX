"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Decision-logic guard for the Kage succession system (api/village/kage-challenge.ts).
 * Tests the pure eligibility gates, the overlap "must-accept" obligation math,
 * the official-duel settlement decision, and the reign-history transitions in
 * _kage-challenge.ts.
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _kage_challenge_js_1 = require("./_kage-challenge.js");
const NOW = 1_000_000_000_000;
const OLD_ENOUGH = NOW - _kage_challenge_js_1.KAGE_MIN_ACCOUNT_AGE_MS - 1;
const CID = 'ch-test-0001';
function chal(name, at, over = {}) {
    return { ...(0, _kage_challenge_js_1.newChallenge)(name, at, `${CID}-${name}`), ...over };
}
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
        challengerMerit: 300,
        isMember: true,
        ...over,
    };
}
(0, node_test_1.describe)('canDeclareChallenge — eligibility gates', () => {
    (0, node_test_1.it)('passes when every gate is satisfied', () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput()).ok, true);
    });
    (0, node_test_1.it)('blocks when the Kage system is not active', () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput({ state: { kageSystemUnlocked: false } })).ok, false);
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
    (0, node_test_1.it)(`blocks below ${_kage_challenge_js_1.KAGE_MIN_MERIT} personal Village Merit`, () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput({ challengerMerit: _kage_challenge_js_1.KAGE_MIN_MERIT - 1 })).ok, false);
    });
    (0, node_test_1.it)(`allows at exactly ${_kage_challenge_js_1.KAGE_MIN_MERIT} merit`, () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput({ challengerMerit: _kage_challenge_js_1.KAGE_MIN_MERIT })).ok, true);
    });
    (0, node_test_1.it)(`blocks without the ${_kage_challenge_js_1.KAGE_DECLARE_SEAL_COST}-seal stake`, () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput({ challengerSeals: _kage_challenge_js_1.KAGE_DECLARE_SEAL_COST - 1 })).ok, false);
    });
    (0, node_test_1.it)('blocks when an active (non-expired) challenge already exists', () => {
        const state = { ...baseState(), challenge: chal('Someone', NOW) };
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput({ state })).ok, false);
    });
    (0, node_test_1.it)('allows when the existing challenge is already expired', () => {
        const state = { ...baseState(), challenge: chal('Someone', NOW - _kage_challenge_js_1.KAGE_CHALLENGE_EXPIRY_MS - 1) };
        node_assert_1.strict.equal((0, _kage_challenge_js_1.canDeclareChallenge)(declareInput({ state })).ok, true);
    });
    (0, node_test_1.it)('blocks during the post-defense / post-transfer grace', () => {
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
        node_assert_1.strict.equal((0, _kage_challenge_js_1.isChallengeExpired)(chal('Rill', NOW - 1000), NOW), false);
        node_assert_1.strict.equal((0, _kage_challenge_js_1.isChallengeExpired)(chal('Rill', NOW - _kage_challenge_js_1.KAGE_CHALLENGE_EXPIRY_MS - 1), NOW), true);
    });
});
(0, node_test_1.describe)('newChallenge', () => {
    (0, node_test_1.it)('stamps the passed challengeId + a fresh full obligation', () => {
        const c = (0, _kage_challenge_js_1.newChallenge)('Rill', NOW, 'ch-abc');
        node_assert_1.strict.equal(c.challengeId, 'ch-abc');
        node_assert_1.strict.equal(c.status, 'pending');
        node_assert_1.strict.equal(c.createdAt, NOW);
        node_assert_1.strict.equal(c.obligationRemainingMs, _kage_challenge_js_1.KAGE_ACCEPT_OBLIGATION_MS);
    });
});
(0, node_test_1.describe)('applyPress — overlap obligation', () => {
    (0, node_test_1.it)('first press just stamps lastPressAt (no burn — no interval yet)', () => {
        const c = chal('Rill', NOW);
        const r = (0, _kage_challenge_js_1.applyPress)(c, NOW + 5000, /*bothOnline*/ true);
        node_assert_1.strict.equal(r.burnedMs, 0);
        node_assert_1.strict.equal(r.challenge.obligationRemainingMs, _kage_challenge_js_1.KAGE_ACCEPT_OBLIGATION_MS);
        node_assert_1.strict.equal(r.challenge.lastPressAt, NOW + 5000);
        node_assert_1.strict.equal(r.forfeited, false);
    });
    (0, node_test_1.it)('a subsequent press burns the elapsed overlap', () => {
        let c = chal('Rill', NOW);
        c = (0, _kage_challenge_js_1.applyPress)(c, NOW, true).challenge; // stamp
        const r = (0, _kage_challenge_js_1.applyPress)(c, NOW + 40_000, true); // 40s later
        node_assert_1.strict.equal(r.burnedMs, 40_000);
        node_assert_1.strict.equal(r.challenge.obligationRemainingMs, _kage_challenge_js_1.KAGE_ACCEPT_OBLIGATION_MS - 40_000);
    });
    (0, node_test_1.it)('caps a single press at KAGE_PRESS_MAX_STEP_MS', () => {
        let c = chal('Rill', NOW);
        c = (0, _kage_challenge_js_1.applyPress)(c, NOW, true).challenge;
        const r = (0, _kage_challenge_js_1.applyPress)(c, NOW + 10 * 60_000, true); // 10 min gap
        node_assert_1.strict.equal(r.burnedMs, _kage_challenge_js_1.KAGE_PRESS_MAX_STEP_MS);
    });
    (0, node_test_1.it)('does NOT burn when the parties are not both online (the AFK case)', () => {
        let c = chal('Rill', NOW);
        c = (0, _kage_challenge_js_1.applyPress)(c, NOW, true).challenge;
        const r = (0, _kage_challenge_js_1.applyPress)(c, NOW + 40_000, /*bothOnline*/ false);
        node_assert_1.strict.equal(r.burnedMs, 0);
        node_assert_1.strict.equal(r.challenge.obligationRemainingMs, _kage_challenge_js_1.KAGE_ACCEPT_OBLIGATION_MS);
    });
    (0, node_test_1.it)('forfeits once the obligation is exhausted', () => {
        const c = chal('Rill', NOW, { obligationRemainingMs: 30_000, lastPressAt: NOW });
        const r = (0, _kage_challenge_js_1.applyPress)(c, NOW + 60_000, true); // burns the capped 60s -> <= 0
        node_assert_1.strict.equal(r.forfeited, true);
        node_assert_1.strict.equal(r.challenge.obligationRemainingMs, 0);
    });
    (0, node_test_1.it)('never burns an already-accepted challenge', () => {
        const c = chal('Rill', NOW, { status: 'accepted', lastPressAt: NOW });
        const r = (0, _kage_challenge_js_1.applyPress)(c, NOW + 60_000, true);
        node_assert_1.strict.equal(r.burnedMs, 0);
        node_assert_1.strict.equal(r.forfeited, false);
    });
});
(0, node_test_1.describe)('seat transitions — grace, defense, expiry', () => {
    (0, node_test_1.it)('applySeatTransfer flips the seat, clears the challenge, and grants the NEW Kage 24h grace', () => {
        const state = { ...baseState(), challenge: chal('Rill', NOW), postDefenseGraceUntil: NOW + 999 };
        const next = (0, _kage_challenge_js_1.applySeatTransfer)(state, 'Rill', 'Stormveil', NOW, 'defeated');
        node_assert_1.strict.equal(next.seatedKage, 'Rill');
        node_assert_1.strict.equal(next.challenge, null);
        node_assert_1.strict.equal(next.postDefenseGraceUntil, NOW + _kage_challenge_js_1.KAGE_POST_DEFENSE_GRACE_MS, 'new Kage gets post-install grace');
        node_assert_1.strict.equal(next.seatedAt, NOW);
        node_assert_1.strict.equal(next.defenseCount, 0);
    });
    (0, node_test_1.it)('applyDefense keeps the Kage, +defense, sets grace + challenger cooldown', () => {
        const state = { ...baseState(), challenge: chal('Rill', NOW), defenseCount: 1, seatedAt: NOW - 5,
            history: [{ name: 'Raiko', village: 'Stormveil', seatedAt: NOW - 5, defenseCount: 1 }] };
        const next = (0, _kage_challenge_js_1.applyDefense)(state, 'Rill', NOW);
        node_assert_1.strict.equal(next.seatedKage, 'Raiko');
        node_assert_1.strict.equal(next.challenge, null);
        node_assert_1.strict.equal(next.defenseCount, 2, 'defense count incremented');
        node_assert_1.strict.equal(next.postDefenseGraceUntil, NOW + _kage_challenge_js_1.KAGE_POST_DEFENSE_GRACE_MS);
        node_assert_1.strict.equal(next.challengerCooldowns?.rill, NOW + _kage_challenge_js_1.KAGE_LOSS_COOLDOWN_MS);
        node_assert_1.strict.equal(next.history?.[0].defenseCount, 2, 'open reign entry tracks defenses');
    });
    (0, node_test_1.it)('applyExpiry clears the challenge and cooldowns the abandoning challenger', () => {
        const state = { ...baseState(), challenge: chal('Rill', NOW - _kage_challenge_js_1.KAGE_CHALLENGE_EXPIRY_MS - 1) };
        const next = (0, _kage_challenge_js_1.applyExpiry)(state, NOW);
        node_assert_1.strict.equal(next.challenge, null);
        node_assert_1.strict.equal(next.challengerCooldowns?.rill, NOW + _kage_challenge_js_1.KAGE_LOSS_COOLDOWN_MS);
    });
    (0, node_test_1.it)('applyDefense prunes elapsed cooldowns', () => {
        const state = { ...baseState(), challenge: chal('Rill', NOW), challengerCooldowns: { old: NOW - 1 } };
        const next = (0, _kage_challenge_js_1.applyDefense)(state, 'Rill', NOW);
        node_assert_1.strict.equal(next.challengerCooldowns?.old, undefined, 'stale cooldown pruned');
    });
});
(0, node_test_1.describe)('reign history (server-owned record)', () => {
    (0, node_test_1.it)('openReign appends an open entry and seats the reign', () => {
        const s = (0, _kage_challenge_js_1.openReign)({ kageSystemUnlocked: true }, 'Raiko', 'Stormveil', NOW);
        node_assert_1.strict.equal(s.seatedKage, 'Raiko');
        node_assert_1.strict.equal(s.seatedAt, NOW);
        node_assert_1.strict.equal(s.defenseCount, 0);
        node_assert_1.strict.equal(s.history?.length, 1);
        node_assert_1.strict.equal(s.history?.[0].endedAt, undefined, 'entry is open');
    });
    (0, node_test_1.it)('closeCurrentReign stamps endedAt/reason/wonBy on the open entry', () => {
        const opened = (0, _kage_challenge_js_1.openReign)({ kageSystemUnlocked: true }, 'Raiko', 'Stormveil', NOW);
        const closed = (0, _kage_challenge_js_1.closeCurrentReign)(opened, 'Stormveil', NOW + 100, 'defeated', 'Rill');
        node_assert_1.strict.equal(closed.history?.[0].endedAt, NOW + 100);
        node_assert_1.strict.equal(closed.history?.[0].endedReason, 'defeated');
        node_assert_1.strict.equal(closed.history?.[0].wonBy, 'Rill');
    });
    (0, node_test_1.it)('closeCurrentReign synthesizes a record for a pre-history seated Kage', () => {
        const legacy = { kageSystemUnlocked: true, seatedKage: 'Old', seatedAt: NOW - 10 };
        const closed = (0, _kage_challenge_js_1.closeCurrentReign)(legacy, 'Stormveil', NOW, 'admin-reset');
        node_assert_1.strict.equal(closed.history?.length, 1);
        node_assert_1.strict.equal(closed.history?.[0].name, 'Old');
        node_assert_1.strict.equal(closed.history?.[0].endedReason, 'admin-reset');
    });
    (0, node_test_1.it)('a duel transfer closes the old reign (defeated) and opens the new one', () => {
        const seated = (0, _kage_challenge_js_1.openReign)({ kageSystemUnlocked: true }, 'Raiko', 'Stormveil', NOW);
        const transferred = (0, _kage_challenge_js_1.applySeatTransfer)({ ...seated, challenge: chal('Rill', NOW + 1) }, 'Rill', 'Stormveil', NOW + 200, 'defeated');
        node_assert_1.strict.equal(transferred.history?.length, 2);
        node_assert_1.strict.equal(transferred.history?.[0].name, 'Raiko');
        node_assert_1.strict.equal(transferred.history?.[0].endedReason, 'defeated');
        node_assert_1.strict.equal(transferred.history?.[0].wonBy, 'Rill');
        node_assert_1.strict.equal(transferred.history?.[1].name, 'Rill');
        node_assert_1.strict.equal(transferred.history?.[1].endedAt, undefined, 'new reign is open');
    });
    (0, node_test_1.it)('a forfeit transfer records endedReason "forfeit"', () => {
        const seated = (0, _kage_challenge_js_1.openReign)({ kageSystemUnlocked: true }, 'Raiko', 'Stormveil', NOW);
        const transferred = (0, _kage_challenge_js_1.applySeatTransfer)(seated, 'Rill', 'Stormveil', NOW + 5, 'forfeit');
        node_assert_1.strict.equal(transferred.history?.[0].endedReason, 'forfeit');
    });
    (0, node_test_1.it)('incrementDefense bumps live count + open entry', () => {
        const seated = (0, _kage_challenge_js_1.openReign)({ kageSystemUnlocked: true }, 'Raiko', 'Stormveil', NOW);
        const d = (0, _kage_challenge_js_1.incrementDefense)((0, _kage_challenge_js_1.incrementDefense)(seated));
        node_assert_1.strict.equal(d.defenseCount, 2);
        node_assert_1.strict.equal(d.history?.[0].defenseCount, 2);
    });
    (0, node_test_1.it)('applyAdminReset closes the reign, re-seals, and preserves history', () => {
        const seated = (0, _kage_challenge_js_1.openReign)({ kageSystemUnlocked: true, firstLiberator: 'Raiko' }, 'Raiko', 'Stormveil', NOW);
        const reset = (0, _kage_challenge_js_1.applyAdminReset)(seated, 'Stormveil', NOW + 50);
        node_assert_1.strict.equal(reset.kageSystemUnlocked, false);
        node_assert_1.strict.equal(reset.seatedKage, undefined, 'seat cleared');
        node_assert_1.strict.equal(reset.firstLiberator, undefined, 'liberator cleared for a fresh era');
        node_assert_1.strict.equal(reset.history?.length, 1);
        node_assert_1.strict.equal(reset.history?.[0].endedReason, 'admin-reset');
    });
    (0, node_test_1.it)('bounds history to KAGE_HISTORY_MAX entries', () => {
        let s = { kageSystemUnlocked: true };
        for (let i = 0; i < 60; i++) {
            s = (0, _kage_challenge_js_1.closeCurrentReign)((0, _kage_challenge_js_1.openReign)(s, `K${i}`, 'Stormveil', NOW + i), 'Stormveil', NOW + i + 1, 'abdicated');
        }
        node_assert_1.strict.ok((s.history?.length ?? 0) <= 50, 'history bounded');
    });
});
(0, node_test_1.describe)('resolveDuelDecision — official-duel settlement (pure)', () => {
    const accepted = chal('Rill', NOW, { status: 'accepted', battleId: 'pvp-1' });
    const base = {
        challenge: accepted,
        battleId: 'pvp-1',
        seatNorm: 'raiko',
        challengerNorm: 'rill',
        fighterNorms: ['raiko', 'rill'],
    };
    (0, node_test_1.it)('transfers when the challenger beats the Kage', () => {
        node_assert_1.strict.deepEqual((0, _kage_challenge_js_1.resolveDuelDecision)({ ...base, winnerNorm: 'rill', loserNorm: 'raiko' }), { kind: 'transfer' });
    });
    (0, node_test_1.it)('defends when the Kage beats the challenger', () => {
        node_assert_1.strict.deepEqual((0, _kage_challenge_js_1.resolveDuelDecision)({ ...base, winnerNorm: 'raiko', loserNorm: 'rill' }), { kind: 'defend' });
    });
    (0, node_test_1.it)('rejects an un-accepted challenge (must settle via the forfeit clock)', () => {
        const r = (0, _kage_challenge_js_1.resolveDuelDecision)({ ...base, challenge: chal('Rill', NOW), winnerNorm: 'rill', loserNorm: 'raiko' });
        node_assert_1.strict.equal(r.kind, 'reject');
    });
    (0, node_test_1.it)('rejects a superseded challengeId', () => {
        const r = (0, _kage_challenge_js_1.resolveDuelDecision)({ ...base, expectChallengeId: 'stale-id', winnerNorm: 'rill', loserNorm: 'raiko' });
        node_assert_1.strict.equal(r.kind, 'reject');
    });
    (0, node_test_1.it)('rejects a battleId that is not the accepted duel', () => {
        const r = (0, _kage_challenge_js_1.resolveDuelDecision)({ ...base, battleId: 'pvp-other', winnerNorm: 'rill', loserNorm: 'raiko' });
        node_assert_1.strict.equal(r.kind, 'reject');
    });
    (0, node_test_1.it)('rejects a duel between the wrong fighters', () => {
        const r = (0, _kage_challenge_js_1.resolveDuelDecision)({ ...base, fighterNorms: ['raiko', 'stranger'], winnerNorm: 'raiko', loserNorm: 'stranger' });
        node_assert_1.strict.equal(r.kind, 'reject');
    });
    (0, node_test_1.it)('rejects a non-participant caller on manual resolve', () => {
        const r = (0, _kage_challenge_js_1.resolveDuelDecision)({ ...base, callerNorm: 'stranger', winnerNorm: 'rill', loserNorm: 'raiko' });
        node_assert_1.strict.equal(r.kind, 'reject');
    });
    (0, node_test_1.it)('allows a participant caller on manual resolve', () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.resolveDuelDecision)({ ...base, callerNorm: 'rill', winnerNorm: 'rill', loserNorm: 'raiko' }).kind, 'transfer');
    });
    (0, node_test_1.it)('allows the auto path (no caller) to settle', () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.resolveDuelDecision)({ ...base, expectChallengeId: accepted.challengeId, winnerNorm: 'rill', loserNorm: 'raiko' }).kind, 'transfer');
    });
});
(0, node_test_1.describe)('resolveAcceptDecision — anti-stall accept guard (pure)', () => {
    const pending = chal('Rill', NOW); // status pending
    const base = {
        challenge: pending,
        seatNorm: 'raiko',
        challengerNorm: 'rill',
        callerNorm: 'raiko', // the seated Kage
        isAdmin: false,
        battleId: 'pvp-1',
        sessionFighters: ['raiko', 'rill'],
    };
    (0, node_test_1.it)('seals a real duel between the Kage and challenger', () => {
        node_assert_1.strict.deepEqual((0, _kage_challenge_js_1.resolveAcceptDecision)(base), { kind: 'seal' });
    });
    (0, node_test_1.it)('rejects when there is no active challenge', () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.resolveAcceptDecision)({ ...base, challenge: null }).kind, 'reject');
    });
    (0, node_test_1.it)('rejects a caller who is not the seated Kage', () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.resolveAcceptDecision)({ ...base, callerNorm: 'rill' }).kind, 'reject');
    });
    (0, node_test_1.it)('allows an admin caller', () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.resolveAcceptDecision)({ ...base, callerNorm: 'someadmin', isAdmin: true }).kind, 'seal');
    });
    (0, node_test_1.it)('rejects a bogus battleId with no live session (the freeze exploit)', () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.resolveAcceptDecision)({ ...base, sessionFighters: null }).kind, 'reject');
    });
    (0, node_test_1.it)('rejects a real session that is not between the two parties', () => {
        node_assert_1.strict.equal((0, _kage_challenge_js_1.resolveAcceptDecision)({ ...base, sessionFighters: ['raiko', 'stranger'] }).kind, 'reject');
    });
    (0, node_test_1.it)('idempotently re-accepts the SAME sealed duel', () => {
        const accepted = chal('Rill', NOW, { status: 'accepted', battleId: 'pvp-1' });
        node_assert_1.strict.equal((0, _kage_challenge_js_1.resolveAcceptDecision)({ ...base, challenge: accepted }).kind, 'idempotent');
    });
    (0, node_test_1.it)('rejects re-accepting a DIFFERENT duel once sealed', () => {
        const accepted = chal('Rill', NOW, { status: 'accepted', battleId: 'pvp-1' });
        node_assert_1.strict.equal((0, _kage_challenge_js_1.resolveAcceptDecision)({ ...base, challenge: accepted, battleId: 'pvp-2' }).kind, 'reject');
    });
});
