/*
 * Pure decision logic for the Kage succession / challenge system
 * (api/village/kage-challenge.ts). Split out so the eligibility gates, the
 * overlap "must-accept" obligation math, and the state-machine transitions can
 * be unit-tested without KV / auth / locks / presence — same pattern as
 * _kick-core.ts / _village-agenda.ts.
 *
 * Model: two separate 24-hour response budgets, measured only while both
 * participants are online. Pending: the Kage owes acceptance. Once the Kage
 * accepts, only the challenger owes a response to the official duel invitation.
 * The official duel seals both acceptances and uses normal PvP turn rules.
 * Calendar time never expires a challenge; the existing ten-day Kage inactivity
 * rule remains independent. The server advances clocks even outside Town Hall.
 *
 * Every seat change (first liberation, duel win, forfeit, defense, admin reset,
 * abdication) is recorded in a server-owned reign history so the Council Hall
 * can render a real permanent record instead of client-synthesized timestamps.
 */

import { setSafeRecordValue } from '../_utils.js';

export const KAGE_ACCEPT_OBLIGATION_MS = 24 * 60 * 60_000;   // each participant gets 24h of overlap
export const KAGE_POST_DEFENSE_GRACE_MS = 24 * 60 * 60_000;  // 24h wall-clock
export const KAGE_LOSS_COOLDOWN_MS = 3 * 24 * 60 * 60_000;   // 3 days wall-clock
export const KAGE_PRESS_MAX_STEP_MS = 60_000;                // longer sampling gaps charge nothing
export const KAGE_MIN_CHALLENGER_LEVEL = 90;
export const KAGE_MIN_MERIT = 250;                           // personal Village Merit gate
// Declaring costs RYO, not Honor Seals (owner ruling 2026-08-17). Seals are the
// Vanguard's PvP earnings and exist to fund VILLAGE upgrades; taxing a political
// act with them punished the profession for a civic ambition unrelated to it.
// Ryo is the universal currency, so every profession pays the same price, and
// the endgame ryo economy gains a real sink. Sized at roughly a strong
// level-90+ player's daily income: a genuine commitment, not a wall — the seat
// is already gated by level 90, account age, 250 Village Merit and a cooldown.
export const KAGE_DECLARE_RYO_COST = 250_000;
export const KAGE_MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60_000; // anti fresh-alt
export const KAGE_HISTORY_MAX = 50;                          // bounded permanent record

export type KageEndReason = 'defeated' | 'forfeit' | 'admin-reset' | 'abdicated' | 'inactive';

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
    /** Server-retained public invitation, recoverable after a normal popup expires. */
    duelInvitation?: Record<string, unknown>;
    clockVersion?: 2;
    challengerRemainingMs?: number;
    kageAcceptedAt?: number;       // switches responsibility to the challenger
    clockPauseReason?: 'offline' | 'kage-unavailable';
    clockRunning?: boolean;       // last server observation, never a client claim
    lastPressAt?: number;          // last server overlap sample
    battleId?: string;             // the official duel, set on accept
};

/**
 * Exact proof that one accepted PvP duel changed (or defended) the Kage seat.
 * This is embedded in the same Kage-row CAS as the seat mutation so a process
 * crash or lost acknowledgement can never leave a marker/body gap.
 */
export type KagePvpDuelSettlementReceipt = {
    version: 1;
    battleId: string;
    challengeId: string;
    outcome: 'transferred' | 'defended';
    winnerName: string;
    loserName: string;
    seatedKage: string;
    settledAt: number;
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
    pvpDuelSettlementReceipts?: Record<string, KagePvpDuelSettlementReceipt>;
};

function lower(s: string): string {
    return String(s ?? '').trim().toLowerCase();
}

export type DeclareInput = {
    now: number;
    state: KageStateLike;
    challengerName: string;     // display name
    challengerLevel: number;
    challengerRyo: number;
    challengerAccountCreatedAt: number;
    challengerMerit: number;    // personal, server-owned Village Merit
    isMember: boolean;
};
export type DeclareResult = { ok: true } | { ok: false; reason: string };

/**
 * Can `challengerName` declare a challenge right now? Pure — the endpoint feeds
 * it the authoritative save/village values and applies the 250,000-ryo debit
 * itself. An existing challenge blocks until a response clock or duel resolves it.
 */
export function canDeclareChallenge(input: DeclareInput): DeclareResult {
    const { now, state, challengerName, challengerRyo } = input;
    if (!state.kageSystemUnlocked || !state.seatedKage) return { ok: false, reason: 'The Kage system is not active for this village.' };
    if (!input.isMember) return { ok: false, reason: 'You are not a member of this village.' };
    if (lower(state.seatedKage) === lower(challengerName)) return { ok: false, reason: 'You are already the seated Kage.' };
    const personal = personalSeatGate(input);
    if (!personal.ok) return personal;
    if (challengerRyo < KAGE_DECLARE_RYO_COST) return { ok: false, reason: `Challenging costs ${KAGE_DECLARE_RYO_COST.toLocaleString()} ryo.` };
    if (state.challenge) return { ok: false, reason: 'There is already an active Kage challenge in this village.' };
    if (state.postDefenseGraceUntil && now < state.postDefenseGraceUntil) return { ok: false, reason: 'The Kage just took (or defended) the seat — challenges are on a brief cooldown.' };
    const cd = state.challengerCooldowns?.[lower(challengerName)] ?? 0;
    if (cd && now < cd) return { ok: false, reason: 'You are on cooldown from a recent Kage challenge.' };
    return { ok: true };
}

/** The personal gates (level / account age / Village Merit) shared by declare + claim. */
function personalSeatGate(input: Pick<DeclareInput, 'now' | 'challengerLevel' | 'challengerAccountCreatedAt' | 'challengerMerit'>): DeclareResult {
    if (input.challengerLevel < KAGE_MIN_CHALLENGER_LEVEL) return { ok: false, reason: `You must be level ${KAGE_MIN_CHALLENGER_LEVEL}+ to challenge for the Kage seat.` };
    if (input.now - input.challengerAccountCreatedAt < KAGE_MIN_ACCOUNT_AGE_MS) return { ok: false, reason: 'Your account is too new to challenge for the Kage seat.' };
    if (input.challengerMerit < KAGE_MIN_MERIT) return { ok: false, reason: `You need ${KAGE_MIN_MERIT}+ Village Merit to challenge for the Kage seat.` };
    return { ok: true };
}

export type ClaimInput = Omit<DeclareInput, 'challengerRyo'>;

/**
 * Can `challengerName` CLAIM a VACANT seat (unlocked village, nobody seated —
 * e.g. after an inactivity vacancy)? Same villager gates as canDeclareChallenge
 * minus the seated-Kage requirement. No ryo gate: nothing is staked on a claim.
 * First-come wins; the endpoint re-checks vacancy under the kage lock.
 */
export function canClaimVacantSeat(input: ClaimInput): DeclareResult {
    const { now, state, challengerName } = input;
    if (!state.kageSystemUnlocked) return { ok: false, reason: 'The Kage system is not active for this village.' };
    if (state.seatedKage) return { ok: false, reason: 'The Kage seat is not vacant.' };
    if (!input.isMember) return { ok: false, reason: 'You are not a member of this village.' };
    const personal = personalSeatGate(input);
    if (!personal.ok) return personal;
    const cd = state.challengerCooldowns?.[lower(challengerName)] ?? 0;
    if (cd && now < cd) return { ok: false, reason: 'You are on cooldown from a recent Kage challenge.' };
    return { ok: true };
}

/**
 * Build the fresh pending challenge record stamped at declare time. The endpoint
 * mints the challengeId (randomUUID) and passes it in so this stays pure.
 */
export function newChallenge(challengerName: string, now: number, challengeId: string): KageChallenge {
    return { challengeId, challenger: challengerName, status: 'pending', createdAt: now,
        clockVersion: 2, obligationRemainingMs: KAGE_ACCEPT_OBLIGATION_MS,
        challengerRemainingMs: KAGE_ACCEPT_OBLIGATION_MS, clockRunning: false };
}

/** Existing pending challenges receive the new full budgets once. Never carry
 * an old thirty-minute countdown or offline interval into this rules change. */
export function normalizeChallengeClock(challenge: KageChallenge): KageChallenge {
    if (challenge.clockVersion === 2 || challenge.status === 'accepted') return challenge;
    return { ...challenge, clockVersion: 2, obligationRemainingMs: KAGE_ACCEPT_OBLIGATION_MS,
        challengerRemainingMs: KAGE_ACCEPT_OBLIGATION_MS, kageAcceptedAt: undefined,
        lastPressAt: undefined, clockRunning: false };
}

export type PressResult = {
    challenge: KageChallenge;
    forfeited: boolean;
    forfeitedBy?: 'kage' | 'challenger';
    burnedMs: number;
};

/** Charge only continuously observed overlap. An offline observation clears
 * the baseline; a long sampling gap re-arms it instead of charging unseen time.
 * Repeated/concurrent samples cannot accelerate either participant's budget. */
export function applyPress(raw: KageChallenge, now: number, bothOnline: boolean): PressResult {
    const challenge = normalizeChallengeClock(raw);
    if (challenge.status === 'accepted') return { challenge, forfeited: false, burnedMs: 0 };
    if (!bothOnline) return { challenge: { ...challenge, lastPressAt: undefined, clockRunning: false }, forfeited: false, burnedMs: 0 };
    const elapsed = challenge.lastPressAt === undefined ? 0 : now - challenge.lastPressAt;
    const burnedMs = challenge.clockRunning && elapsed > 0 && elapsed <= KAGE_PRESS_MAX_STEP_MS ? elapsed : 0;
    const owing = challenge.kageAcceptedAt !== undefined ? 'challenger' : 'kage';
    const remaining = Math.max(0, (owing === 'kage' ? challenge.obligationRemainingMs
        : challenge.challengerRemainingMs ?? KAGE_ACCEPT_OBLIGATION_MS) - burnedMs);
    return {
        challenge: { ...challenge, ...(owing === 'kage' ? { obligationRemainingMs: remaining }
            : { challengerRemainingMs: remaining }), lastPressAt: Math.max(now, challenge.lastPressAt ?? now), clockRunning: true },
        forfeited: remaining === 0,
        ...(remaining === 0 ? { forfeitedBy: owing } : {}),
        burnedMs,
    };
}

/** Readiness is one-way and idempotent: resending an invitation never resets a clock. */
export function acceptKageChallenge(raw: KageChallenge, now: number): KageChallenge {
    const challenge = normalizeChallengeClock(raw);
    if (challenge.status === 'accepted' || challenge.kageAcceptedAt !== undefined) return challenge;
    return { ...challenge, kageAcceptedAt: now, lastPressAt: undefined, clockRunning: false };
}

/** A missed challenger response keeps the incumbent without inventing a duel win. */
export function applyChallengerForfeit(state: KageStateLike, now: number): KageStateLike {
    return { ...applyExpiry(state, now), postDefenseGraceUntil: now + KAGE_POST_DEFENSE_GRACE_MS };
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
    setSafeRecordValue(cooldowns, lower(challengerName), now + KAGE_LOSS_COOLDOWN_MS);
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
    if (challenge) setSafeRecordValue(cooldowns, lower(challenge.challenger), now + KAGE_LOSS_COOLDOWN_MS);
    return { ...state, challenge: null, challengerCooldowns: pruneCooldowns(cooldowns, now) };
}

/**
 * State after an admin reset: close the current reign as 'admin-reset', re-seal
 * the village back to the NPC/locked state, but PRESERVE the permanent history
 * so the record survives across eras.
 */
export function applyAdminReset(state: KageStateLike, village: string, now: number): KageStateLike {
    const closed = state.seatedKage ? closeCurrentReign(state, village, now, 'admin-reset') : state;
    return {
        kageSystemUnlocked: false,
        history: closed.history ?? [],
        ...(closed.pvpDuelSettlementReceipts
            ? { pvpDuelSettlementReceipts: closed.pvpDuelSettlementReceipts }
            : {}),
    };
}

// Keep the cooldown map from growing unbounded — drop entries already elapsed.
function pruneCooldowns(cooldowns: Record<string, number>, now: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(cooldowns)) if (v > now) setSafeRecordValue(out, k, v);
    return out;
}
