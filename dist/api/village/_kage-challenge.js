"use strict";
/*
 * Pure decision logic for the Kage succession / challenge system
 * (api/village/kage-challenge.ts). Split out so the eligibility gates, the
 * overlap "must-accept" obligation math, and the state-machine transitions can
 * be unit-tested without KV / auth / locks / presence — same pattern as
 * _kick-core.ts / _village-agenda.ts.
 *
 * Model (online-only, async, no wall-clock window):
 *   - A villager DECLARES a challenge against the seated Kage (gated on personal
 *     Village Merit + a 500-seal stake). One active challenge per village. Every
 *     challenge carries a unique challengeId so a superseded challenge's old
 *     battleId can never settle a newer one.
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
 *
 * Every seat change (first liberation, duel win, forfeit, defense, admin reset,
 * abdication) is recorded in a server-owned reign history so the Council Hall
 * can render a real permanent record instead of client-synthesized timestamps.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.KAGE_HISTORY_MAX = exports.KAGE_MIN_ACCOUNT_AGE_MS = exports.KAGE_DECLARE_SEAL_COST = exports.KAGE_MIN_MERIT = exports.KAGE_MIN_CHALLENGER_LEVEL = exports.KAGE_PRESS_MAX_STEP_MS = exports.KAGE_LOSS_COOLDOWN_MS = exports.KAGE_POST_DEFENSE_GRACE_MS = exports.KAGE_CHALLENGE_EXPIRY_MS = exports.KAGE_ACCEPT_OBLIGATION_MS = void 0;
exports.isChallengeExpired = isChallengeExpired;
exports.canDeclareChallenge = canDeclareChallenge;
exports.newChallenge = newChallenge;
exports.applyPress = applyPress;
exports.resolveDuelDecision = resolveDuelDecision;
exports.resolveAcceptDecision = resolveAcceptDecision;
exports.openReign = openReign;
exports.closeCurrentReign = closeCurrentReign;
exports.incrementDefense = incrementDefense;
exports.applySeatTransfer = applySeatTransfer;
exports.applyDefense = applyDefense;
exports.applyExpiry = applyExpiry;
exports.applyAdminReset = applyAdminReset;
exports.KAGE_ACCEPT_OBLIGATION_MS = 30 * 60_000; // 30 min of overlap
exports.KAGE_CHALLENGE_EXPIRY_MS = 48 * 60 * 60_000; // 48h wall-clock
exports.KAGE_POST_DEFENSE_GRACE_MS = 24 * 60 * 60_000; // 24h wall-clock
exports.KAGE_LOSS_COOLDOWN_MS = 3 * 24 * 60 * 60_000; // 3 days wall-clock
exports.KAGE_PRESS_MAX_STEP_MS = 60_000; // cap one press can burn
exports.KAGE_MIN_CHALLENGER_LEVEL = 90;
exports.KAGE_MIN_MERIT = 250; // personal Village Merit gate
exports.KAGE_DECLARE_SEAL_COST = 500;
exports.KAGE_MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60_000; // anti fresh-alt
exports.KAGE_HISTORY_MAX = 50; // bounded permanent record
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
    const { now, state, challengerName, challengerLevel, challengerSeals, challengerAccountCreatedAt, challengerMerit, isMember } = input;
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
    if (challengerMerit < exports.KAGE_MIN_MERIT)
        return { ok: false, reason: `You need ${exports.KAGE_MIN_MERIT}+ Village Merit to challenge for the Kage seat.` };
    if (challengerSeals < exports.KAGE_DECLARE_SEAL_COST)
        return { ok: false, reason: `Challenging costs ${exports.KAGE_DECLARE_SEAL_COST} Honor Seals.` };
    if (state.challenge && !isChallengeExpired(state.challenge, now))
        return { ok: false, reason: 'There is already an active Kage challenge in this village.' };
    if (state.postDefenseGraceUntil && now < state.postDefenseGraceUntil)
        return { ok: false, reason: 'The Kage just took (or defended) the seat — challenges are on a brief cooldown.' };
    const cd = state.challengerCooldowns?.[lower(challengerName)] ?? 0;
    if (cd && now < cd)
        return { ok: false, reason: 'You are on cooldown from a recent Kage challenge.' };
    return { ok: true };
}
/**
 * Build the fresh pending challenge record stamped at declare time. The endpoint
 * mints the challengeId (randomUUID) and passes it in so this stays pure.
 */
function newChallenge(challengerName, now, challengeId) {
    return { challengeId, challenger: challengerName, status: 'pending', createdAt: now, obligationRemainingMs: exports.KAGE_ACCEPT_OBLIGATION_MS };
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
/**
 * Decide how an OFFICIAL Kage duel settles the seat. Pure so the anti-cheat
 * gates are unit-testable; the KV/session I/O (name normalization, PvpSession
 * read, state write) lives in _kage-settle.ts. All name inputs are already
 * normalized by the caller (safeName), matching how the endpoint compares
 * fighters. The seat only changes through an ACCEPTED duel whose sealed
 * battleId + challengeId match and whose fighters are exactly {Kage, challenger}
 * — a random / casual / wrong-fighter / unaccepted / superseded duel is rejected.
 */
function resolveDuelDecision(opts) {
    const { challenge } = opts;
    if (!challenge)
        return { kind: 'reject', status: 409, error: 'There is no active challenge to settle.' };
    if (challenge.status !== 'accepted') {
        return { kind: 'reject', status: 409, error: 'The Kage has not accepted this challenge — it settles via the forfeit clock, not an unrelated duel.' };
    }
    if (opts.expectChallengeId && challenge.challengeId !== opts.expectChallengeId) {
        return { kind: 'reject', status: 409, error: 'That duel belongs to a superseded challenge.' };
    }
    if (challenge.battleId && opts.battleId !== challenge.battleId) {
        return { kind: 'reject', status: 409, error: 'That duel is not the accepted Kage duel.' };
    }
    const fighters = new Set(opts.fighterNorms);
    if (!fighters.has(opts.seatNorm) || !fighters.has(opts.challengerNorm)) {
        return { kind: 'reject', status: 400, error: 'That duel was not this Kage challenge.' };
    }
    if (opts.callerNorm && !opts.isAdmin && opts.callerNorm !== opts.seatNorm && opts.callerNorm !== opts.challengerNorm) {
        return { kind: 'reject', status: 403, error: 'Only a participant can settle this challenge.' };
    }
    if (opts.winnerNorm === opts.challengerNorm && opts.loserNorm === opts.seatNorm)
        return { kind: 'transfer' };
    if (opts.winnerNorm === opts.seatNorm && opts.loserNorm === opts.challengerNorm)
        return { kind: 'defend' };
    return { kind: 'reject', status: 400, error: 'That duel result does not match this challenge.' };
}
/**
 * Decide whether the seated Kage may ACCEPT a challenge by sealing an official
 * duel's battleId. Pure so the anti-stall guard is unit-testable; the KV/session
 * I/O lives in the endpoint. Without this validation the incumbent could seal a
 * bogus battleId to freeze the forfeit clock forever (accepted → press no-ops)
 * while no real duel can ever match it, so the challenge would die at 48h with NO
 * seat change — defeating "accept or forfeit". The sealed duel MUST be a real
 * session whose two fighters are exactly the seated Kage and the challenger.
 * `sessionFighters` = the safeName'd [p1, p2] of pvp:<battleId>, or null if the
 * session was not found.
 */
function resolveAcceptDecision(opts) {
    const { challenge } = opts;
    if (!challenge)
        return { kind: 'reject', status: 404, error: 'There is no active challenge to accept.' };
    if (opts.callerNorm !== opts.seatNorm && !opts.isAdmin) {
        return { kind: 'reject', status: 403, error: 'Only the seated Kage can accept a challenge.' };
    }
    // Idempotent re-accept of the SAME sealed duel (client retry) is fine;
    // re-accepting a DIFFERENT duel once sealed is rejected.
    if (challenge.status === 'accepted') {
        if (challenge.battleId && challenge.battleId === opts.battleId)
            return { kind: 'idempotent' };
        return { kind: 'reject', status: 409, error: 'This challenge has already sealed its official duel.' };
    }
    if (!opts.sessionFighters)
        return { kind: 'reject', status: 404, error: 'That duel session was not found or has expired.' };
    const fighters = new Set(opts.sessionFighters);
    if (!fighters.has(opts.seatNorm) || !fighters.has(opts.challengerNorm)) {
        return { kind: 'reject', status: 400, error: 'That duel is not between you and the challenger.' };
    }
    return { kind: 'seal' };
}
// ── Reign history (server-owned permanent record) ───────────────────────────
function boundedHistory(history) {
    return history.length > exports.KAGE_HISTORY_MAX ? history.slice(history.length - exports.KAGE_HISTORY_MAX) : history;
}
/** Index of the current (open) reign entry — the last one with no endedAt. */
function openReignIndex(history) {
    for (let i = history.length - 1; i >= 0; i--)
        if (!history[i].endedAt)
            return i;
    return -1;
}
/** Seat a new Kage: reset defense count and append an OPEN reign entry. */
function openReign(state, name, village, now) {
    const history = boundedHistory([...(state.history ?? []), { name, village, seatedAt: now, defenseCount: 0 }]);
    return { ...state, seatedKage: name, seatedAt: now, defenseCount: 0, history };
}
/**
 * Close the current (open) reign entry, stamping how/when it ended. If no open
 * entry exists but a Kage is seated (pre-history state), synthesize a closed
 * entry from the live seat so older saves still gain a record.
 */
function closeCurrentReign(state, village, now, reason, wonBy) {
    const history = [...(state.history ?? [])];
    const close = (e) => ({
        ...e,
        endedAt: now,
        endedReason: reason,
        defenseCount: state.defenseCount ?? e.defenseCount ?? 0,
        ...(wonBy ? { wonBy } : {}),
    });
    const idx = openReignIndex(history);
    if (idx >= 0) {
        history[idx] = close(history[idx]);
    }
    else if (state.seatedKage) {
        history.push(close({ name: state.seatedKage, village, seatedAt: state.seatedAt ?? state.unlockedAt ?? now, defenseCount: state.defenseCount ?? 0 }));
    }
    return { ...state, history: boundedHistory(history) };
}
/** Register a successful defense on the live reign + its open history entry. */
function incrementDefense(state) {
    const nextCount = (state.defenseCount ?? 0) + 1;
    const history = [...(state.history ?? [])];
    const idx = openReignIndex(history);
    if (idx >= 0)
        history[idx] = { ...history[idx], defenseCount: nextCount };
    return { ...state, defenseCount: nextCount, history };
}
/**
 * State after the challenger wins (duel win → 'defeated', or obligation forfeit
 * → 'forfeit'): close the outgoing reign, open the challenger's, clear the
 * challenge, and give the NEW Kage the same post-install grace so they aren't
 * instantly re-challenged the second they take the seat.
 */
function applySeatTransfer(state, challengerName, village, now, reason = 'defeated') {
    const closed = closeCurrentReign(state, village, now, reason, challengerName);
    const opened = openReign(closed, challengerName, village, now);
    return {
        ...opened,
        challenge: null,
        postDefenseGraceUntil: now + exports.KAGE_POST_DEFENSE_GRACE_MS,
    };
}
/** State after the Kage successfully defends: +defense, clear challenge, grace + cooldown. */
function applyDefense(state, challengerName, now) {
    const cooldowns = { ...(state.challengerCooldowns ?? {}) };
    cooldowns[lower(challengerName)] = now + exports.KAGE_LOSS_COOLDOWN_MS;
    const defended = incrementDefense(state);
    return {
        ...defended,
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
/**
 * State after an admin reset: close the current reign as 'admin-reset', re-seal
 * the village back to the NPC/locked state, but PRESERVE the permanent history
 * so the record survives across eras.
 */
function applyAdminReset(state, village, now) {
    const closed = state.seatedKage ? closeCurrentReign(state, village, now, 'admin-reset') : state;
    return { kageSystemUnlocked: false, history: closed.history ?? [] };
}
// Keep the cooldown map from growing unbounded — drop entries already elapsed.
function pruneCooldowns(cooldowns, now) {
    const out = {};
    for (const [k, v] of Object.entries(cooldowns))
        if (v > now)
            out[k] = v;
    return out;
}
