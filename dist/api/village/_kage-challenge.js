"use strict";
/*
 * Pure decision logic for the Kage succession / challenge system
 * (api/village/kage-challenge.ts). Split out so the eligibility gates, the
 * overlap "must-accept" obligation math, and the state-machine transitions can
 * be unit-tested without KV / auth / locks / presence — same pattern as
 * _kick-core.ts / _village-agenda.ts.
 *
 * Model (online-only, async, no wall-clock window):
 *   - A villager DECLARES a challenge against the seated Kage (gated + 500-seal
 *     stake). One active challenge per village.
 *   - The Kage MUST ACCEPT or they lose the seat. Enforcement is an "obligation"
 *     timer that only burns down while BOTH the Kage and the challenger are
 *     online (overlap) — driven by the challenger's PRESS pings, each validated
 *     against live presence server-side. The Kage can't dodge by logging off
 *     (the clock just pauses, and they can't play); the challenger going offline
 *     also pauses it (so an AFK challenger can never steal the seat).
 *   - ACCEPT → a normal full-vitals PvP duel. Winner takes / keeps the seat
 *     (resolved server-side against the real PvpSession).
 *   - A challenge with no progress for 48h EXPIRES (slot freed, no seat change,
 *     declare stake forfeited, challenger put on cooldown).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.KAGE_MIN_ACCOUNT_AGE_MS = exports.KAGE_DECLARE_SEAL_COST = exports.KAGE_MIN_CONTRIBUTION = exports.KAGE_MIN_CHALLENGER_LEVEL = exports.KAGE_PRESS_MAX_STEP_MS = exports.KAGE_LOSS_COOLDOWN_MS = exports.KAGE_POST_DEFENSE_GRACE_MS = exports.KAGE_CHALLENGE_EXPIRY_MS = exports.KAGE_ACCEPT_OBLIGATION_MS = void 0;
exports.isChallengeExpired = isChallengeExpired;
exports.canDeclareChallenge = canDeclareChallenge;
exports.newChallenge = newChallenge;
exports.applyPress = applyPress;
exports.applySeatTransfer = applySeatTransfer;
exports.applyDefense = applyDefense;
exports.applyExpiry = applyExpiry;
exports.KAGE_ACCEPT_OBLIGATION_MS = 30 * 60_000; // 30 min of overlap
exports.KAGE_CHALLENGE_EXPIRY_MS = 48 * 60 * 60_000; // 48h wall-clock
exports.KAGE_POST_DEFENSE_GRACE_MS = 24 * 60 * 60_000; // 24h wall-clock
exports.KAGE_LOSS_COOLDOWN_MS = 3 * 24 * 60 * 60_000; // 3 days wall-clock
exports.KAGE_PRESS_MAX_STEP_MS = 60_000; // cap one press can burn
exports.KAGE_MIN_CHALLENGER_LEVEL = 90;
exports.KAGE_MIN_CONTRIBUTION = 250;
exports.KAGE_DECLARE_SEAL_COST = 500;
exports.KAGE_MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60_000; // anti fresh-alt
function lower(s) {
    return String(s ?? '').trim().toLowerCase();
}
/** A challenge that has made no progress for KAGE_CHALLENGE_EXPIRY_MS is dead. */
function isChallengeExpired(challenge, now) {
    return !!challenge && now - challenge.createdAt > exports.KAGE_CHALLENGE_EXPIRY_MS;
}
/**
 * Can `challengerName` declare a challenge right now? Pure — the endpoint feeds
 * it the authoritative save/village values and applies the 500-seal debit
 * itself. An expired existing challenge does NOT block (the endpoint clears it
 * first), so callers should pass already-expired challenges through unchanged.
 */
function canDeclareChallenge(input) {
    const { now, state, challengerName, challengerLevel, challengerSeals, challengerAccountCreatedAt, villageContribution, isMember } = input;
    if (!state.kageSystemUnlocked || !state.seatedKage)
        return { ok: false, reason: 'The Kage system is not active for this village.' };
    if (!isMember)
        return { ok: false, reason: 'You are not a member of this village.' };
    if (lower(state.seatedKage) === lower(challengerName))
        return { ok: false, reason: 'You are already the seated Kage.' };
    if (challengerLevel < exports.KAGE_MIN_CHALLENGER_LEVEL)
        return { ok: false, reason: `You must be level ${exports.KAGE_MIN_CHALLENGER_LEVEL}+ to challenge for the Kage seat.` };
    if (now - challengerAccountCreatedAt < exports.KAGE_MIN_ACCOUNT_AGE_MS)
        return { ok: false, reason: 'Your account is too new to challenge for the Kage seat.' };
    if (villageContribution < exports.KAGE_MIN_CONTRIBUTION)
        return { ok: false, reason: `You need ${exports.KAGE_MIN_CONTRIBUTION}+ village contribution to challenge.` };
    if (challengerSeals < exports.KAGE_DECLARE_SEAL_COST)
        return { ok: false, reason: `Challenging costs ${exports.KAGE_DECLARE_SEAL_COST} Honor Seals.` };
    if (state.challenge && !isChallengeExpired(state.challenge, now))
        return { ok: false, reason: 'There is already an active Kage challenge in this village.' };
    if (state.postDefenseGraceUntil && now < state.postDefenseGraceUntil)
        return { ok: false, reason: 'The Kage just defended the seat — challenges are on a brief cooldown.' };
    const cd = state.challengerCooldowns?.[lower(challengerName)] ?? 0;
    if (cd && now < cd)
        return { ok: false, reason: 'You are on cooldown from a recent Kage challenge.' };
    return { ok: true };
}
/** Build the fresh pending challenge record stamped at declare time. */
function newChallenge(challengerName, now) {
    return { challenger: challengerName, status: 'pending', createdAt: now, obligationRemainingMs: exports.KAGE_ACCEPT_OBLIGATION_MS };
}
/**
 * Apply one overlap "press". Only burns obligation when BOTH sides are online
 * (verified by the caller against live presence) and the challenge is still
 * pending (an accepted challenge is heading to a duel, not a forfeit). The first
 * press just stamps lastPressAt (no interval to measure yet); subsequent presses
 * burn the elapsed overlap, capped at KAGE_PRESS_MAX_STEP_MS so a long gap
 * between pings can't dump the whole obligation at once.
 */
function applyPress(challenge, now, bothOnline) {
    if (challenge.status !== 'pending' || !bothOnline) {
        return { challenge: { ...challenge, lastPressAt: bothOnline ? now : challenge.lastPressAt }, forfeited: false, burnedMs: 0 };
    }
    const burnedMs = challenge.lastPressAt ? Math.min(exports.KAGE_PRESS_MAX_STEP_MS, Math.max(0, now - challenge.lastPressAt)) : 0;
    const remaining = Math.max(0, challenge.obligationRemainingMs - burnedMs);
    return {
        challenge: { ...challenge, obligationRemainingMs: remaining, lastPressAt: now },
        forfeited: remaining <= 0,
        burnedMs,
    };
}
/** State after the challenger wins (duel win or obligation forfeit): seat flips. */
function applySeatTransfer(state, challengerName) {
    return {
        ...state,
        seatedKage: challengerName,
        challenge: null,
        // a brand-new Kage gets the same post-install grace so they aren't
        // instantly re-challenged the second they take the seat.
        postDefenseGraceUntil: undefined,
    };
}
/** State after the Kage successfully defends: clear challenge, grace + cooldown. */
function applyDefense(state, challengerName, now) {
    const cooldowns = { ...(state.challengerCooldowns ?? {}) };
    cooldowns[lower(challengerName)] = now + exports.KAGE_LOSS_COOLDOWN_MS;
    return {
        ...state,
        challenge: null,
        postDefenseGraceUntil: now + exports.KAGE_POST_DEFENSE_GRACE_MS,
        challengerCooldowns: pruneCooldowns(cooldowns, now),
    };
}
/** State after a challenge expires (challenger abandoned it): clear + cooldown. */
function applyExpiry(state, now) {
    const challenge = state.challenge;
    const cooldowns = { ...(state.challengerCooldowns ?? {}) };
    if (challenge)
        cooldowns[lower(challenge.challenger)] = now + exports.KAGE_LOSS_COOLDOWN_MS;
    return { ...state, challenge: null, challengerCooldowns: pruneCooldowns(cooldowns, now) };
}
// Keep the cooldown map from growing unbounded — drop entries already elapsed.
function pruneCooldowns(cooldowns, now) {
    const out = {};
    for (const [k, v] of Object.entries(cooldowns))
        if (v > now)
            out[k] = v;
    return out;
}
