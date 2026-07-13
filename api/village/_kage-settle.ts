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
import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import type { PvpSession } from '../pvp/session.js';
import { resolveDuelDecision, applySeatTransfer, applyDefense, applyExpiry, isChallengeExpired, type KageStateLike } from './_kage-challenge.js';

const SESSION_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function kageKey(village: string): string {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}
export function kageDuelKey(battleId: string): string {
    return `kage-duel:${battleId}`;
}
export function kageSettleKey(battleId: string): string {
    return `kage-settle:${battleId}`;
}
function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/** The resolved facts of a finished official duel — the only settlement input. */
export type KageDuelOutcome = {
    battleId: string;
    createdAt: number;      // session createdAt (drives the 24h replay window)
    winnerName: string;
    loserName: string;
    p1Name: string;
    p2Name: string;
    challengeId?: string;   // sealed challenge this duel belongs to (integrity)
};

export type SettleResult =
    | { ok: false; status: number; error: string }
    | { ok: true; result: 'transferred' | 'defended'; seatedKage: string; village: string; battleId: string; newKage?: string };

/** Build the outcome from a finished PvpSession, or null if it isn't settle-ready. */
function outcomeFromSession(session: PvpSession | null, challengeId?: string): KageDuelOutcome | null {
    if (!session || session.status !== 'done' || !session.winner || session.winner === 'draw') return null;
    const winnerName = session.winner === 'p1' ? session.p1.name : session.p2.name;
    const loserName = session.winner === 'p1' ? session.p2.name : session.p1.name;
    return { battleId: session.battleId, createdAt: num(session.createdAt), winnerName, loserName, p1Name: session.p1.name, p2Name: session.p2.name, challengeId };
}

/** Settle the seat from an already-resolved outcome (session OR durable record). */
async function settleFromOutcome(
    village: string,
    o: KageDuelOutcome,
    now: number,
    opts: { callerName?: string; isAdmin?: boolean; expectChallengeId?: string },
): Promise<SettleResult> {
    if (now - o.createdAt > SESSION_REPLAY_WINDOW_MS) return { ok: false, status: 409, error: 'That duel is too old to settle the seat.' };
    const key = kageKey(village);
    return withKvLock<SettleResult>(key, async () => {
        let state = (await kv.get<KageStateLike>(key)) ?? { kageSystemUnlocked: false };
        if (state.challenge && isChallengeExpired(state.challenge, now)) {
            state = applyExpiry(state, now);
            await kv.set(key, state);
        }
        const decision = resolveDuelDecision({
            challenge: state.challenge,
            battleId: o.battleId,
            seatNorm: safeName(state.seatedKage ?? ''),
            challengerNorm: safeName(state.challenge?.challenger ?? ''),
            fighterNorms: [safeName(o.p1Name), safeName(o.p2Name)],
            winnerNorm: safeName(o.winnerName),
            loserNorm: safeName(o.loserName),
            expectChallengeId: opts.expectChallengeId,
            callerNorm: opts.callerName ? safeName(opts.callerName) : undefined,
            isAdmin: opts.isAdmin,
        });
        if (decision.kind === 'reject') return { ok: false, status: decision.status, error: decision.error };

        const challengerName = state.challenge!.challenger;
        const cleanup = async () => {
            await kv.del(kageDuelKey(o.battleId)).catch(() => undefined);
            await kv.del(kageSettleKey(o.battleId)).catch(() => undefined);
        };
        if (decision.kind === 'transfer') {
            const next = applySeatTransfer(state, challengerName, village, now, 'defeated');
            await kv.set(key, next);
            await cleanup();
            return { ok: true, result: 'transferred', seatedKage: next.seatedKage ?? challengerName, village, battleId: o.battleId, newKage: challengerName };
        }
        const next = applyDefense(state, challengerName, now);
        await kv.set(key, next);
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
export async function settleKageDuel(
    village: string,
    battleId: string,
    now: number,
    opts: { callerName?: string; isAdmin?: boolean; expectChallengeId?: string } = {},
): Promise<SettleResult> {
    const session = await kv.get<PvpSession>(`pvp:${battleId}`);
    if (!session) return { ok: false, status: 404, error: 'Battle session not found or expired.' };
    if (session.status !== 'done' || !session.winner || session.winner === 'draw') {
        return { ok: false, status: 409, error: 'That duel is not decided yet.' };
    }
    const outcome = outcomeFromSession(session, opts.expectChallengeId)!;
    return settleFromOutcome(village, outcome, now, opts);
}

/**
 * Durable settle record written by api/pvp/move.ts the instant an official Kage
 * duel finishes — BEFORE the immediate auto-settle. If that immediate settle
 * throws (transient KV), reconcilePendingKageSettle can still finish the settle
 * from this record long after the 15-min PvpSession TTL lapses. Best-effort.
 */
export async function recordPendingKageSettle(village: string, session: PvpSession, challengeId?: string): Promise<void> {
    const outcome = outcomeFromSession(session, challengeId);
    if (!outcome) return;
    await kv.set(kageSettleKey(session.battleId), { village, ...outcome }, { ex: Math.floor(SESSION_REPLAY_WINDOW_MS / 1000) }).catch(() => undefined);
}

/**
 * Finish a stuck settle: if the village's current challenge is ACCEPTED and a
 * durable `kage-settle:<battleId>` record exists for its sealed duel, settle from
 * it. Cheap no-op otherwise (one state read; the record read only when there IS
 * an accepted challenge). Call opportunistically from the Kage read/act paths.
 */
export async function reconcilePendingKageSettle(village: string, now: number): Promise<SettleResult | null> {
    const state = await kv.get<KageStateLike>(kageKey(village));
    const challenge = state?.challenge;
    if (!challenge || challenge.status !== 'accepted' || !challenge.battleId) return null;
    const rec = await kv.get<KageDuelOutcome & { village?: string }>(kageSettleKey(challenge.battleId));
    if (!rec) return null;
    return settleFromOutcome(village, rec, now, { expectChallengeId: rec.challengeId ?? challenge.challengeId });
}
