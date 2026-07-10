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

export const KAGE_ACCEPT_OBLIGATION_MS = 30 * 60_000;        // 30 min of overlap
export const KAGE_CHALLENGE_EXPIRY_MS = 48 * 60 * 60_000;    // 48h wall-clock
export const KAGE_POST_DEFENSE_GRACE_MS = 24 * 60 * 60_000;  // 24h wall-clock
export const KAGE_LOSS_COOLDOWN_MS = 3 * 24 * 60 * 60_000;   // 3 days wall-clock
export const KAGE_PRESS_MAX_STEP_MS = 60_000;                // cap one press can burn
export const KAGE_MIN_CHALLENGER_LEVEL = 90;
export const KAGE_MIN_MERIT = 250;                           // personal Village Merit gate
export const KAGE_DECLARE_SEAL_COST = 500;
export const KAGE_MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60_000; // anti fresh-alt
export const KAGE_HISTORY_MAX = 50;                          // bounded permanent record

export type KageEndReason = 'defeated' | 'forfeit' | 'admin-reset' | 'abdicated';

/** One reign in the server-owned permanent record. Open while `endedAt` is unset. */
export type KageHistoryEntry = {
    name: string;
    village: string;
    seatedAt: number;
    endedAt?: number;
    endedReason?: KageEndReason;
    wonBy?: string;         // who took the seat from them (defeated / forfeit)
    defenseCount?: number;  // successful defenses during this reign
};

export type KageChallenge = {
    challengeId: string;           // unique per challenge — sealed into the official duel
    challenger: string;            // display name of the challenger
    status: 'pending' | 'accepted';
    createdAt: number;
    obligationRemainingMs: number; // burns down only during verified overlap
    lastPressAt?: number;          // last overlap sample (challenger press)
    battleId?: string;             // the official duel, set on accept
};

export type KageStateLike = {
    kageSystemUnlocked?: boolean;
    seatedKage?: string;
    firstLiberator?: string;
    unlockedAt?: number;
    seatedAt?: number;             // when the current reign began
    defenseCount?: number;         // successful defenses of the current reign
    history?: KageHistoryEntry[];  // server-owned permanent record
    challenge?: KageChallenge | null;
    postDefenseGraceUntil?: number;
    challengerCooldowns?: Record<string, number>; // lower-name -> cooldown-until ts
};

function lower(s: string): string {
    return String(s ?? '').trim().toLowerCase();
}

/** A challenge that has made no progress for KAGE_CHALLENGE_EXPIRY_MS is dead. */
export function isChallengeExpired(challenge: KageChallenge | null | undefined, now: number): boolean {
    return !!challenge && now - challenge.createdAt > KAGE_CHALLENGE_EXPIRY_MS;
}

export type DeclareInput = {
    now: number;
    state: KageStateLike;
    challengerName: string;     // display name
    challengerLevel: number;
    challengerSeals: number;
    challengerAccountCreatedAt: number;
    challengerMerit: number;    // personal, server-owned Village Merit
    isMember: boolean;
};
export type DeclareResult = { ok: true } | { ok: false; reason: string };

/**
 * Can `challengerName` declare a challenge right now? Pure — the endpoint feeds
 * it the authoritative save/village values and applies the 500-seal debit
 * itself. An expired existing challenge does NOT block (the endpoint clears it
 * first), so callers should pass already-expired challenges through unchanged.
 */
export function canDeclareChallenge(input: DeclareInput): DeclareResult {
    const { now, state, challengerName, challengerLevel, challengerSeals, challengerAccountCreatedAt, challengerMerit, isMember } = input;
    if (!state.kageSystemUnlocked || !state.seatedKage) return { ok: false, reason: 'The Kage system is not active for this village.' };
    if (!isMember) return { ok: false, reason: 'You are not a member of this village.' };
    if (lower(state.seatedKage) === lower(challengerName)) return { ok: false, reason: 'You are already the seated Kage.' };
    if (challengerLevel < KAGE_MIN_CHALLENGER_LEVEL) return { ok: false, reason: `You must be level ${KAGE_MIN_CHALLENGER_LEVEL}+ to challenge for the Kage seat.` };
    if (now - challengerAccountCreatedAt < KAGE_MIN_ACCOUNT_AGE_MS) return { ok: false, reason: 'Your account is too new to challenge for the Kage seat.' };
    if (challengerMerit < KAGE_MIN_MERIT) return { ok: false, reason: `You need ${KAGE_MIN_MERIT}+ Village Merit to challenge for the Kage seat.` };
    if (challengerSeals < KAGE_DECLARE_SEAL_COST) return { ok: false, reason: `Challenging costs ${KAGE_DECLARE_SEAL_COST} Honor Seals.` };
    if (state.challenge && !isChallengeExpired(state.challenge, now)) return { ok: false, reason: 'There is already an active Kage challenge in this village.' };
    if (state.postDefenseGraceUntil && now < state.postDefenseGraceUntil) return { ok: false, reason: 'The Kage just took (or defended) the seat — challenges are on a brief cooldown.' };
    const cd = state.challengerCooldowns?.[lower(challengerName)] ?? 0;
    if (cd && now < cd) return { ok: false, reason: 'You are on cooldown from a recent Kage challenge.' };
    return { ok: true };
}

/**
 * Build the fresh pending challenge record stamped at declare time. The endpoint
 * mints the challengeId (randomUUID) and passes it in so this stays pure.
 */
export function newChallenge(challengerName: string, now: number, challengeId: string): KageChallenge {
    return { challengeId, challenger: challengerName, status: 'pending', createdAt: now, obligationRemainingMs: KAGE_ACCEPT_OBLIGATION_MS };
}

export type PressResult = {
    challenge: KageChallenge;
    forfeited: boolean; // obligation exhausted -> challenger should take the seat
    burnedMs: number;
};

/**
 * Apply one overlap "press". Only burns obligation when BOTH sides are online
 * (verified by the caller against live presence) and the challenge is still
 * pending (an accepted challenge is heading to a duel, not a forfeit). The first
 * press just stamps lastPressAt (no interval to measure yet); subsequent presses
 * burn the elapsed overlap, capped at KAGE_PRESS_MAX_STEP_MS so a long gap
 * between pings can't dump the whole obligation at once.
 */
export function applyPress(challenge: KageChallenge, now: number, bothOnline: boolean): PressResult {
    if (challenge.status !== 'pending' || !bothOnline) {
        return { challenge: { ...challenge, lastPressAt: bothOnline ? now : challenge.lastPressAt }, forfeited: false, burnedMs: 0 };
    }
    const burnedMs = challenge.lastPressAt ? Math.min(KAGE_PRESS_MAX_STEP_MS, Math.max(0, now - challenge.lastPressAt)) : 0;
    const remaining = Math.max(0, challenge.obligationRemainingMs - burnedMs);
    return {
        challenge: { ...challenge, obligationRemainingMs: remaining, lastPressAt: now },
        forfeited: remaining <= 0,
        burnedMs,
    };
}

// ── Official-duel settlement decision (pure) ────────────────────────────────

export type DuelDecision =
    | { kind: 'transfer' }
    | { kind: 'defend' }
    | { kind: 'reject'; status: number; error: string };

/**
 * Decide how an OFFICIAL Kage duel settles the seat. Pure so the anti-cheat
 * gates are unit-testable; the KV/session I/O (name normalization, PvpSession
 * read, state write) lives in _kage-settle.ts. All name inputs are already
 * normalized by the caller (safeName), matching how the endpoint compares
 * fighters. The seat only changes through an ACCEPTED duel whose sealed
 * battleId + challengeId match and whose fighters are exactly {Kage, challenger}
 * — a random / casual / wrong-fighter / unaccepted / superseded duel is rejected.
 */
export function resolveDuelDecision(opts: {
    challenge: KageChallenge | null | undefined;
    battleId: string;
    seatNorm: string;
    challengerNorm: string;
    fighterNorms: string[];
    winnerNorm: string;
    loserNorm: string;
    expectChallengeId?: string;
    callerNorm?: string;  // when set (manual resolve), caller must be a participant
    isAdmin?: boolean;
}): DuelDecision {
    const { challenge } = opts;
    if (!challenge) return { kind: 'reject', status: 409, error: 'There is no active challenge to settle.' };
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
    if (opts.winnerNorm === opts.challengerNorm && opts.loserNorm === opts.seatNorm) return { kind: 'transfer' };
    if (opts.winnerNorm === opts.seatNorm && opts.loserNorm === opts.challengerNorm) return { kind: 'defend' };
    return { kind: 'reject', status: 400, error: 'That duel result does not match this challenge.' };
}

// ── Accept decision (pure) ──────────────────────────────────────────────────

export type AcceptDecision =
    | { kind: 'seal' }        // seal battleId + flip to accepted
    | { kind: 'idempotent' }  // already sealed to THIS battleId (client retry)
    | { kind: 'reject'; status: number; error: string };

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
export function resolveAcceptDecision(opts: {
    challenge: KageChallenge | null | undefined;
    seatNorm: string;
    challengerNorm: string;
    callerNorm: string;
    isAdmin: boolean;
    battleId: string;
    sessionFighters: string[] | null;
}): AcceptDecision {
    const { challenge } = opts;
    if (!challenge) return { kind: 'reject', status: 404, error: 'There is no active challenge to accept.' };
    if (opts.callerNorm !== opts.seatNorm && !opts.isAdmin) {
        return { kind: 'reject', status: 403, error: 'Only the seated Kage can accept a challenge.' };
    }
    // Idempotent re-accept of the SAME sealed duel (client retry) is fine;
    // re-accepting a DIFFERENT duel once sealed is rejected.
    if (challenge.status === 'accepted') {
        if (challenge.battleId && challenge.battleId === opts.battleId) return { kind: 'idempotent' };
        return { kind: 'reject', status: 409, error: 'This challenge has already sealed its official duel.' };
    }
    if (!opts.sessionFighters) return { kind: 'reject', status: 404, error: 'That duel session was not found or has expired.' };
    const fighters = new Set(opts.sessionFighters);
    if (!fighters.has(opts.seatNorm) || !fighters.has(opts.challengerNorm)) {
        return { kind: 'reject', status: 400, error: 'That duel is not between you and the challenger.' };
    }
    return { kind: 'seal' };
}

// ── Reign history (server-owned permanent record) ───────────────────────────

function boundedHistory(history: KageHistoryEntry[]): KageHistoryEntry[] {
    return history.length > KAGE_HISTORY_MAX ? history.slice(history.length - KAGE_HISTORY_MAX) : history;
}

/** Index of the current (open) reign entry — the last one with no endedAt. */
function openReignIndex(history: KageHistoryEntry[]): number {
    for (let i = history.length - 1; i >= 0; i--) if (!history[i].endedAt) return i;
    return -1;
}

/** Seat a new Kage: reset defense count and append an OPEN reign entry. */
export function openReign(state: KageStateLike, name: string, village: string, now: number): KageStateLike {
    const history = boundedHistory([...(state.history ?? []), { name, village, seatedAt: now, defenseCount: 0 }]);
    return { ...state, seatedKage: name, seatedAt: now, defenseCount: 0, history };
}

/**
 * Close the current (open) reign entry, stamping how/when it ended. If no open
 * entry exists but a Kage is seated (pre-history state), synthesize a closed
 * entry from the live seat so older saves still gain a record.
 */
export function closeCurrentReign(state: KageStateLike, village: string, now: number, reason: KageEndReason, wonBy?: string): KageStateLike {
    const history = [...(state.history ?? [])];
    const close = (e: KageHistoryEntry): KageHistoryEntry => ({
        ...e,
        endedAt: now,
        endedReason: reason,
        defenseCount: state.defenseCount ?? e.defenseCount ?? 0,
        ...(wonBy ? { wonBy } : {}),
    });
    const idx = openReignIndex(history);
    if (idx >= 0) {
        history[idx] = close(history[idx]);
    } else if (state.seatedKage) {
        history.push(close({ name: state.seatedKage, village, seatedAt: state.seatedAt ?? state.unlockedAt ?? now, defenseCount: state.defenseCount ?? 0 }));
    }
    return { ...state, history: boundedHistory(history) };
}

/** Register a successful defense on the live reign + its open history entry. */
export function incrementDefense(state: KageStateLike): KageStateLike {
    const nextCount = (state.defenseCount ?? 0) + 1;
    const history = [...(state.history ?? [])];
    const idx = openReignIndex(history);
    if (idx >= 0) history[idx] = { ...history[idx], defenseCount: nextCount };
    return { ...state, defenseCount: nextCount, history };
}

/**
 * State after the challenger wins (duel win → 'defeated', or obligation forfeit
 * → 'forfeit'): close the outgoing reign, open the challenger's, clear the
 * challenge, and give the NEW Kage the same post-install grace so they aren't
 * instantly re-challenged the second they take the seat.
 */
export function applySeatTransfer(
    state: KageStateLike,
    challengerName: string,
    village: string,
    now: number,
    reason: 'defeated' | 'forfeit' = 'defeated',
): KageStateLike {
    const closed = closeCurrentReign(state, village, now, reason, challengerName);
    const opened = openReign(closed, challengerName, village, now);
    return {
        ...opened,
        challenge: null,
        postDefenseGraceUntil: now + KAGE_POST_DEFENSE_GRACE_MS,
    };
}

/** State after the Kage successfully defends: +defense, clear challenge, grace + cooldown. */
export function applyDefense(state: KageStateLike, challengerName: string, now: number): KageStateLike {
    const cooldowns = { ...(state.challengerCooldowns ?? {}) };
    cooldowns[lower(challengerName)] = now + KAGE_LOSS_COOLDOWN_MS;
    const defended = incrementDefense(state);
    return {
        ...defended,
        challenge: null,
        postDefenseGraceUntil: now + KAGE_POST_DEFENSE_GRACE_MS,
        challengerCooldowns: pruneCooldowns(cooldowns, now),
    };
}

/** State after a challenge expires (challenger abandoned it): clear + cooldown. */
export function applyExpiry(state: KageStateLike, now: number): KageStateLike {
    const challenge = state.challenge;
    const cooldowns = { ...(state.challengerCooldowns ?? {}) };
    if (challenge) cooldowns[lower(challenge.challenger)] = now + KAGE_LOSS_COOLDOWN_MS;
    return { ...state, challenge: null, challengerCooldowns: pruneCooldowns(cooldowns, now) };
}

/**
 * State after an admin reset: close the current reign as 'admin-reset', re-seal
 * the village back to the NPC/locked state, but PRESERVE the permanent history
 * so the record survives across eras.
 */
export function applyAdminReset(state: KageStateLike, village: string, now: number): KageStateLike {
    const closed = state.seatedKage ? closeCurrentReign(state, village, now, 'admin-reset') : state;
    return { kageSystemUnlocked: false, history: closed.history ?? [] };
}

// Keep the cooldown map from growing unbounded — drop entries already elapsed.
function pruneCooldowns(cooldowns: Record<string, number>, now: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(cooldowns)) if (v > now) out[k] = v;
    return out;
}
