import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { isPlayerOnline, stampPresenceBeat } from '../_realtime/_presence-beat.js';
import type { PvpSession } from '../pvp/session.js';
import { completeEconomyTx, failEconomyTx, makeEconomyTxId, markEconomyTx, reserveEconomyTx } from '../_economy-tx.js';
import {
    canDeclareChallenge, isChallengeExpired, newChallenge, applyPress, applySeatTransfer,
    applyExpiry, resolveAcceptDecision, KAGE_DECLARE_SEAL_COST, type KageStateLike,
} from './_kage-challenge.js';
import { settleKageDuel, reconcilePendingKageSettle, kageKey, kageDuelKey } from './_kage-settle.js';

/*
 * /api/village/kage-challenge — POST only
 *
 * Server-authoritative Kage succession. Replaces the old client-side challenge
 * theater (votes + a 23:00–03:00 UTC window that could never resolve) with a
 * real, async, online-only contest. See _kage-challenge.ts for the model + rules.
 *
 * Actions (body.action):
 *   - declare : a gated villager stakes 500 Honor Seals to open a challenge.
 *               Eligibility now requires PERSONAL Village Merit (char.villageMerit),
 *               not the shared village contribution pool.
 *   - press   : the challenger pings to burn the Kage's "accept obligation",
 *               but ONLY while BOTH are verifiably online (live presence). The
 *               Kage can't dodge by hiding; an AFK challenger can't steal the seat.
 *   - accept  : the seated Kage agrees to duel — halts the forfeit clock, seals
 *               the official duel's battleId, and writes the `kage-duel:<battleId>`
 *               pointer so PvP completion can auto-settle the seat.
 *   - resolve : either fighter (or the auto path in api/pvp/move.ts) settles the
 *               duel against the real PvpSession — the client can't fake the outcome.
 *
 * All seat-bearing mutations run under withKvLock(village:kage:<slug>) with
 * { failClosed: true }. The 500-seal debit nests the challenger's save lock
 * inside (kage-outer / save-inner — no other path takes them the other way).
 */

const SESSION_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const AUDIT_PREFIX = 'audit:kage-challenge:';

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
async function audit(village: string, entry: Record<string, unknown>): Promise<void> {
    await kv.set(`${AUDIT_PREFIX}${village.toLowerCase().replace(/[^a-z0-9]/g, '')}:${Date.now()}`, { ts: Date.now(), ...entry }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        const playerName = safeName(String(body.playerName ?? ''));
        const battleId = typeof body.battleId === 'string' ? body.battleId.trim() : '';
        if (!village || !playerName) return res.status(400).json({ error: 'Missing village or playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `kage-challenge-${action}`, action === 'press' ? 12 : 6, 60_000, identity.name))) return;

        const key = kageKey(village);
        const now = Date.now();

        // Self-heal: finish any stuck auto-settle (immediate settle threw at
        // duel-finish) from the durable record before acting. Idempotent + cheap.
        await reconcilePendingKageSettle(village, now).catch(() => undefined);

        // ── DECLARE ──────────────────────────────────────────────────────────
        if (action === 'declare') {
            const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const char = (save?.character ?? null) as Record<string, unknown> | null;
            if (!char) return res.status(404).json({ error: 'Your save was not found.' });
            const challengerName = String(char.name ?? playerName);

            const out = await withKvLock<{ status: number; body: unknown }>(key, async () => {
                let state = (await kv.get<KageStateLike>(key)) ?? { kageSystemUnlocked: false };
                if (state.challenge && isChallengeExpired(state.challenge, now)) state = applyExpiry(state, now);

                const elig = canDeclareChallenge({
                    now, state, challengerName,
                    challengerLevel: num(char.level),
                    challengerSeals: num(char.honorSeals),
                    challengerAccountCreatedAt: num(char.createdAt),
                    challengerMerit: num(char.villageMerit),
                    isMember: identity.admin || String(char.village ?? '').trim() === village,
                });
                if (!elig.ok) return { status: 403, body: { error: elig.reason } };

                const txId = makeEconomyTxId('kage-challenge-declare');
                await reserveEconomyTx({
                    id: txId,
                    kind: 'kage-challenge-declare',
                    debitKey: `save:${playerName}`,
                    creditKey: key,
                    resource: 'honorSeals',
                    amount: KAGE_DECLARE_SEAL_COST,
                    meta: { playerName, village, challengerName },
                });

                // Stake the 500 seals (debit the challenger's save) BEFORE opening
                // the challenge — committed first, like the treasury-donate pattern.
                const debit = await withKvLock<{ ok: boolean; character?: Record<string, unknown>; _saveVersion?: number }>(`save:${playerName}`, async () => {
                    const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                    const c = (rec?.character ?? null) as Record<string, unknown> | null;
                    if (!rec || !c) return { ok: false };
                    if (num(c.honorSeals) < KAGE_DECLARE_SEAL_COST) return { ok: false };
                    const nextChar = { ...c, honorSeals: num(c.honorSeals) - KAGE_DECLARE_SEAL_COST };
                    const nextRec = bumpSaveVersion({ ...rec, character: nextChar });
                    await kv.set(`save:${playerName}`, mergePreservingImages(nextRec, rec));
                    return { ok: true, character: nextChar, _saveVersion: Number((nextRec as Record<string, unknown>)._saveVersion ?? 0) };
                }, { failClosed: true });
                if (!debit.ok) {
                    await completeEconomyTx(txId, { note: 'Declaration rejected before debit.' }).catch(() => undefined);
                    return { status: 400, body: { error: `Challenging costs ${KAGE_DECLARE_SEAL_COST} Honor Seals.` } };
                }
                await markEconomyTx(txId, 'debit-applied').catch(() => undefined);

                const next = { ...state, challenge: newChallenge(challengerName, now, randomUUID()) };
                try {
                    await kv.set(key, next);
                } catch (challengeError) {
                    try {
                        const refunded = await withKvLock(`save:${playerName}`, async () => {
                            const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                            const c = (rec?.character ?? null) as Record<string, unknown> | null;
                            if (!rec || !c) throw new Error('Player save missing during Kage stake refund.');
                            const nextChar = { ...c, honorSeals: num(c.honorSeals) + KAGE_DECLARE_SEAL_COST };
                            const nextRec = bumpSaveVersion({ ...rec, character: nextChar });
                            await kv.set(`save:${playerName}`, mergePreservingImages(nextRec, rec));
                            return nextChar;
                        }, { failClosed: true });
                        await completeEconomyTx(txId, { note: 'Challenge-state write failed; stake refunded.' }).catch(() => undefined);
                        return { status: 503, body: { error: 'The challenge could not be opened, so your Honor Seals were refunded. Please retry.', character: refunded } };
                    } catch (refundError) {
                        await failEconomyTx(txId, refundError, { note: 'Challenge-state write and automatic stake refund both failed.', meta: { playerName, village, challengerName, challengeError: String(challengeError) } }).catch(() => undefined);
                        return { status: 503, body: { error: 'The challenge could not be opened and the stake refund needs administrator reconciliation. Please do not retry.' } };
                    }
                }
                await completeEconomyTx(txId).catch(() => undefined);
                return { status: 200, body: { ok: true, challenge: next.challenge, character: debit.character, _saveVersion: debit._saveVersion } };
            }, { failClosed: true });

            if (out.status === 200) await audit(village, { action: 'declare', challenger: challengerName });
            return res.status(out.status).json(out.body);
        }

        // ── PRESS (burn the accept obligation during verified overlap) ────────
        if (action === 'press') {
            // The presser proves their own liveness by making this authenticated
            // request (the client only presses on a visible tab); stamp their beat.
            stampPresenceBeat(playerName);
            const out = await withKvLock<{ status: number; body: unknown; forfeitTo?: string }>(key, async () => {
                let state = (await kv.get<KageStateLike>(key)) ?? { kageSystemUnlocked: false };
                if (state.challenge && isChallengeExpired(state.challenge, now)) {
                    state = applyExpiry(state, now);
                    await kv.set(key, state);
                    return { status: 200, body: { ok: true, expired: true, challenge: null } };
                }
                const challenge = state.challenge;
                if (!challenge || challenge.status !== 'pending') return { status: 200, body: { ok: true, challenge: challenge ?? null } };
                // Only the challenger drives their own clock.
                if (safeName(challenge.challenger) !== playerName && !identity.admin) {
                    return { status: 403, body: { error: 'Only the challenger can press a Kage challenge.' } };
                }
                // "Both online" is verified cross-worker (in-memory store + durable
                // presence beat). The challenger who is pressing is provably online
                // by virtue of this request; the seated Kage is checked for real.
                const challengerOnline = playerName === safeName(challenge.challenger) || await isPlayerOnline(challenge.challenger);
                const bothOnline = (await isPlayerOnline(state.seatedKage)) && challengerOnline;
                const pressed = applyPress(challenge, now, bothOnline);
                if (pressed.forfeited) {
                    const nextState = applySeatTransfer(state, challenge.challenger, village, now, 'forfeit');
                    await kv.set(key, nextState);
                    return { status: 200, body: { ok: true, forfeited: true, seatedKage: nextState.seatedKage }, forfeitTo: challenge.challenger };
                }
                await kv.set(key, { ...state, challenge: pressed.challenge });
                return { status: 200, body: { ok: true, obligationRemainingMs: pressed.challenge.obligationRemainingMs, bothOnline } };
            }, { failClosed: true });
            if (out.forfeitTo) await audit(village, { action: 'forfeit', newKage: out.forfeitTo });
            return res.status(out.status).json(out.body);
        }

        // ── ACCEPT (Kage agrees to duel — halts the forfeit clock) ────────────
        if (action === 'accept') {
            if (!battleId) return res.status(400).json({ error: 'Missing battleId — accept the official duel to defend, not the challenge directly.' });
            // Load the claimed duel BEFORE sealing (see resolveAcceptDecision): a
            // bogus battleId would otherwise freeze the forfeit clock forever. The
            // duel must be a live session fought by exactly {seated Kage, challenger}
            // (an abandoned real duel is handled by PvP's own AFK-claim, which
            // completes the session and auto-settles the seat).
            const session = await kv.get<PvpSession>(`pvp:${battleId}`);
            const sessionFighters = session ? [safeName(session.p1.name), safeName(session.p2.name)] : null;
            const out = await withKvLock<{ status: number; body: unknown; sealBattleId?: string; challengeId?: string }>(key, async () => {
                let state = (await kv.get<KageStateLike>(key)) ?? { kageSystemUnlocked: false };
                if (state.challenge && isChallengeExpired(state.challenge, now)) { state = applyExpiry(state, now); await kv.set(key, state); }
                const challenge = state.challenge;
                const decision = resolveAcceptDecision({
                    challenge,
                    seatNorm: safeName(state.seatedKage ?? ''),
                    challengerNorm: safeName(challenge?.challenger ?? ''),
                    callerNorm: playerName,
                    isAdmin: identity.admin,
                    battleId,
                    sessionFighters,
                });
                if (decision.kind === 'reject') return { status: decision.status, body: { error: decision.error } };
                if (decision.kind === 'idempotent') {
                    return { status: 200, body: { ok: true, challenge }, sealBattleId: battleId, challengeId: challenge!.challengeId };
                }
                const next = { ...state, challenge: { ...challenge!, status: 'accepted' as const, battleId } };
                await kv.set(key, next);
                return { status: 200, body: { ok: true, challenge: next.challenge }, sealBattleId: battleId, challengeId: challenge!.challengeId };
            }, { failClosed: true });
            // Point the official duel back at this village/challenge so PvP
            // completion (api/pvp/move.ts) can auto-settle the seat. Written
            // SERVER-side (not client-trusted); TTL matches the replay window.
            if (out.status === 200 && out.sealBattleId) {
                await kv.set(kageDuelKey(out.sealBattleId), { village, challengeId: out.challengeId }, { ex: Math.floor(SESSION_REPLAY_WINDOW_MS / 1000) }).catch(() => undefined);
                await audit(village, { action: 'accept', battleId: out.sealBattleId });
            }
            return res.status(out.status).json(out.body);
        }

        // ── RESOLVE (settle the duel against the real PvpSession) ─────────────
        // Manual backup for the auto-settle in api/pvp/move.ts. Same shared
        // helper, so behavior is identical; the caller must be a participant.
        if (action === 'resolve') {
            if (!battleId) return res.status(400).json({ error: 'Missing battleId.' });
            const outcome = await settleKageDuel(village, battleId, now, { callerName: playerName, isAdmin: identity.admin });
            if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
            if (outcome.result === 'transferred') await audit(village, { action: 'duel-transfer', newKage: outcome.newKage, battleId });
            else await audit(village, { action: 'duel-defended', battleId });
            return res.status(200).json({ ok: true, seatedKage: outcome.seatedKage, result: outcome.result });
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        console.error('[village/kage-challenge]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
