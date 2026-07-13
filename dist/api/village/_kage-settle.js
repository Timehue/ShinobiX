"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kageKey = kageKey;
exports.kageDuelKey = kageDuelKey;
exports.kageSettleKey = kageSettleKey;
exports.settleKageDuel = settleKageDuel;
exports.recordPendingKageSettle = recordPendingKageSettle;
exports.reconcilePendingKageSettle = reconcilePendingKageSettle;
/*
 * Shared, server-authoritative settlement of an OFFICIAL Kage duel.
 *
 * Three ways in, ONE settlement core (settleFromOutcome), so behavior is identical:
 *   - the manual /api/village/kage-challenge `resolve` action (backup),
 *   - the automatic settle fired from api/pvp/move.ts when the duel completes
 *     (keyed off the server-written `kage-duel:<battleId>` pointer), and
 *   - reconcilePendingKageSettle, which finishes a settle that the immediate auto
 *     path failed to commit (transient KV throw) BEFORE the 15-min PvpSession TTL
 *     lapses — it reads a durable `kage-settle:<battleId>` record that move.ts
 *     writes from the finished session, so the seat still settles even after the
 *     live session is gone.
 *
 * The seat can only change through an ACCEPTED duel whose sealed battleId +
 * challengeId match and whose fighters are exactly {Kage, challenger}. The pure
 * gate lives in _kage-challenge.ts `resolveDuelDecision`; here we do just the KV
 * I/O under the village:kage lock. A random / casual / wrong-fighter / unaccepted
 * / superseded / stale duel is rejected — the winner is read from the real
 * finished session, never the client.
 */
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _lock_js_1 = require("../_lock.js");
const _kage_challenge_js_1 = require("./_kage-challenge.js");
const SESSION_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
function kageKey(village) {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}
function kageDuelKey(battleId) {
    return `kage-duel:${battleId}`;
}
function kageSettleKey(battleId) {
    return `kage-settle:${battleId}`;
}
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
/** Build the outcome from a finished PvpSession, or null if it isn't settle-ready. */
function outcomeFromSession(session, challengeId) {
    if (!session || session.status !== 'done' || !session.winner || session.winner === 'draw')
        return null;
    const winnerName = session.winner === 'p1' ? session.p1.name : session.p2.name;
    const loserName = session.winner === 'p1' ? session.p2.name : session.p1.name;
    return { battleId: session.battleId, createdAt: num(session.createdAt), winnerName, loserName, p1Name: session.p1.name, p2Name: session.p2.name, challengeId };
}
/** Settle the seat from an already-resolved outcome (session OR durable record). */
async function settleFromOutcome(village, o, now, opts) {
    if (now - o.createdAt > SESSION_REPLAY_WINDOW_MS)
        return { ok: false, status: 409, error: 'That duel is too old to settle the seat.' };
    const key = kageKey(village);
    return (0, _lock_js_1.withKvLock)(key, async () => {
        let state = (await _storage_js_1.kv.get(key)) ?? { kageSystemUnlocked: false };
        if (state.challenge && (0, _kage_challenge_js_1.isChallengeExpired)(state.challenge, now)) {
            state = (0, _kage_challenge_js_1.applyExpiry)(state, now);
            await _storage_js_1.kv.set(key, state);
        }
        const decision = (0, _kage_challenge_js_1.resolveDuelDecision)({
            challenge: state.challenge,
            battleId: o.battleId,
            seatNorm: (0, _utils_js_1.safeName)(state.seatedKage ?? ''),
            challengerNorm: (0, _utils_js_1.safeName)(state.challenge?.challenger ?? ''),
            fighterNorms: [(0, _utils_js_1.safeName)(o.p1Name), (0, _utils_js_1.safeName)(o.p2Name)],
            winnerNorm: (0, _utils_js_1.safeName)(o.winnerName),
            loserNorm: (0, _utils_js_1.safeName)(o.loserName),
            expectChallengeId: opts.expectChallengeId,
            callerNorm: opts.callerName ? (0, _utils_js_1.safeName)(opts.callerName) : undefined,
            isAdmin: opts.isAdmin,
        });
        if (decision.kind === 'reject')
            return { ok: false, status: decision.status, error: decision.error };
        const challengerName = state.challenge.challenger;
        const cleanup = async () => {
            await _storage_js_1.kv.del(kageDuelKey(o.battleId)).catch(() => undefined);
            await _storage_js_1.kv.del(kageSettleKey(o.battleId)).catch(() => undefined);
        };
        if (decision.kind === 'transfer') {
            const next = (0, _kage_challenge_js_1.applySeatTransfer)(state, challengerName, village, now, 'defeated');
            await _storage_js_1.kv.set(key, next);
            await cleanup();
            return { ok: true, result: 'transferred', seatedKage: next.seatedKage ?? challengerName, village, battleId: o.battleId, newKage: challengerName };
        }
        const next = (0, _kage_challenge_js_1.applyDefense)(state, challengerName, now);
        await _storage_js_1.kv.set(key, next);
        await cleanup();
        return { ok: true, result: 'defended', seatedKage: next.seatedKage ?? '', village, battleId: o.battleId };
    }, { failClosed: true });
}
/**
 * Settle from the LIVE PvpSession. Pass `callerName`/`isAdmin` on the manual path
 * (enforces the participant check); omit them on the auto path. Pass
 * `expectChallengeId` (from the duel pointer) so a stale pointer from a superseded
 * challenge can't settle a newer one.
 */
async function settleKageDuel(village, battleId, now, opts = {}) {
    const session = await _storage_js_1.kv.get(`pvp:${battleId}`);
    if (!session)
        return { ok: false, status: 404, error: 'Battle session not found or expired.' };
    if (session.status !== 'done' || !session.winner || session.winner === 'draw') {
        return { ok: false, status: 409, error: 'That duel is not decided yet.' };
    }
    const outcome = outcomeFromSession(session, opts.expectChallengeId);
    return settleFromOutcome(village, outcome, now, opts);
}
/**
 * Durable settle record written by api/pvp/move.ts the instant an official Kage
 * duel finishes — BEFORE the immediate auto-settle. If that immediate settle
 * throws (transient KV), reconcilePendingKageSettle can still finish the settle
 * from this record long after the 15-min PvpSession TTL lapses. Best-effort.
 */
async function recordPendingKageSettle(village, session, challengeId) {
    const outcome = outcomeFromSession(session, challengeId);
    if (!outcome)
        return;
    await _storage_js_1.kv.set(kageSettleKey(session.battleId), { village, ...outcome }, { ex: Math.floor(SESSION_REPLAY_WINDOW_MS / 1000) }).catch(() => undefined);
}
/**
 * Finish a stuck settle: if the village's current challenge is ACCEPTED and a
 * durable `kage-settle:<battleId>` record exists for its sealed duel, settle from
 * it. Cheap no-op otherwise (one state read; the record read only when there IS
 * an accepted challenge). Call opportunistically from the Kage read/act paths.
 */
async function reconcilePendingKageSettle(village, now) {
    const state = await _storage_js_1.kv.get(kageKey(village));
    const challenge = state?.challenge;
    if (!challenge || challenge.status !== 'accepted' || !challenge.battleId)
        return null;
    const rec = await _storage_js_1.kv.get(kageSettleKey(challenge.battleId));
    if (!rec)
        return null;
    return settleFromOutcome(village, rec, now, { expectChallengeId: rec.challengeId ?? challenge.challengeId });
}
