import { loadChallengeRecord, saveChallengeRecord, isCurrentKageInvitation } from '../pvp/_challenge-authorization.js';
import { safeLogValue } from '../_safe-log.js';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { completeEconomyTx, failEconomyTx, makeEconomyTxId, markEconomyTx, reserveEconomyTx } from '../_economy-tx.js';
import {
    canDeclareChallenge, newChallenge, acceptKageChallenge, KAGE_DECLARE_RYO_COST, type KageStateLike,
} from './_kage-challenge.js';
import {
    ensureKageDuelPointer,
    settleKageDuel,
    reconcilePendingKageSettle,
    kageKey,
} from './_kage-settle.js';
import { advanceKageChallengeClock } from './_kage-clock.js';

/*
 * /api/village/kage-challenge — POST only
 *
 * Server-authoritative Kage succession. Replaces the old client-side challenge
 * theater (votes + a 23:00–03:00 UTC window that could never resolve) with a
 * real, async, online-only contest. See _kage-challenge.ts for the model + rules.
 *
 * Actions (body.action):
 *   - declare : a gated villager stakes 250,000 ryo to open a challenge.
 *               Eligibility now requires PERSONAL Village Merit (char.villageMerit),
 *               not the shared village contribution pool.
 *   - press   : compatibility refresh; server sampling advances the response clocks.
 *   - accept  : seated Kage accepts; the challenger now owes an official-duel response.
 *   - invitation : challenger reopens the accepted official invitation after a missed popup.
 *   - resolve : either fighter (or the auto path in api/pvp/move.ts) settles the
 *               duel against the real PvpSession — the client can't fake the outcome.
 *
 * All seat-bearing mutations run under withKvLock(village:kage:<slug>) with
 * { failClosed: true }. The ryo stake debit nests the challenger's save lock
 * inside (kage-outer / save-inner — no other path takes them the other way).
 */

const AUDIT_PREFIX = 'audit:kage-challenge:';

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
async function audit(village: string, entry: Record<string, unknown>): Promise<void> {
    await kv.set(`${AUDIT_PREFIX}${village.toLowerCase().replace(/[^a-z0-9]/g, '')}:${Date.now()}`, { ts: Date.now(), ...entry }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
}

async function commitExactKageState(
    key: string,
    expected: KageStateLike | null,
    candidate: KageStateLike,
): Promise<void> {
    try {
        if (await kv.compareSet(key, expected, candidate)) return;
    } catch (error) {
        const recovered = await kv.get<KageStateLike>(key).catch(() => null);
        if (isDeepStrictEqual(recovered, candidate)) return;
        throw error;
    }
    const recovered = await kv.get<KageStateLike>(key);
    if (isDeepStrictEqual(recovered, candidate)) return;
    throw new Error('kage-state-publication-conflict');
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
        await advanceKageChallengeClock(village, now);

        // ── DECLARE ──────────────────────────────────────────────────────────
        if (action === 'declare') {
            const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const char = (save?.character ?? null) as Record<string, unknown> | null;
            if (!char) return res.status(404).json({ error: 'Your save was not found.' });
            const challengerName = String(char.name ?? playerName);

            const out = await withKvLock<{ status: number; body: unknown }>(key, async () => {
                const state = (await kv.get<KageStateLike>(key)) ?? { kageSystemUnlocked: false };

                const elig = canDeclareChallenge({
                    now, state, challengerName,
                    challengerLevel: num(char.level),
                    challengerRyo: num(char.ryo),
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
                    resource: 'ryo',
                    amount: KAGE_DECLARE_RYO_COST,
                    meta: { playerName, village, challengerName },
                });

                // Stake the ryo (debit the challenger's save) BEFORE opening
                // the challenge — committed first, like the treasury-donate pattern.
                const debit = await withKvLock<{ ok: boolean; character?: Record<string, unknown>; _saveVersion?: number }>(`save:${playerName}`, async () => {
                    const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                    const c = (rec?.character ?? null) as Record<string, unknown> | null;
                    if (!rec || !c) return { ok: false };
                    if (num(c.ryo) < KAGE_DECLARE_RYO_COST) return { ok: false };
                    const nextChar = { ...c, ryo: num(c.ryo) - KAGE_DECLARE_RYO_COST };
                    const nextRec = bumpSaveVersion({ ...rec, character: nextChar });
                    await kv.set(`save:${playerName}`, mergePreservingImages(nextRec, rec));
                    return { ok: true, character: nextChar, _saveVersion: Number((nextRec as Record<string, unknown>)._saveVersion ?? 0) };
                }, { failClosed: true });
                if (!debit.ok) {
                    await completeEconomyTx(txId, { note: 'Declaration rejected before debit.' }).catch(() => undefined);
                    return { status: 400, body: { error: `Challenging costs ${KAGE_DECLARE_RYO_COST.toLocaleString()} ryo.` } };
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
                            const nextChar = { ...c, ryo: num(c.ryo) + KAGE_DECLARE_RYO_COST };
                            const nextRec = bumpSaveVersion({ ...rec, character: nextChar });
                            await kv.set(`save:${playerName}`, mergePreservingImages(nextRec, rec));
                            return nextChar;
                        }, { failClosed: true });
                        await completeEconomyTx(txId, { note: 'Challenge-state write failed; stake refunded.' }).catch(() => undefined);
                        return { status: 503, body: { error: 'The challenge could not be opened, so your ryo was refunded. Please retry.', character: refunded } };
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

        // Compatibility refresh for either participant; the scheduler also advances it.
        if (action === 'press') {
            const state = await kv.get<KageStateLike>(key);
            if (state?.challenge && !identity.admin && ![safeName(state.seatedKage ?? ''), safeName(state.challenge.challenger)].includes(playerName)) {
                return res.status(403).json({ error: 'Only the participants can press this challenge.' });
            }
            return res.status(200).json({ ok: true, ...state });
        }

        // The Kage accepts first. The challenger then accepts a fresh invitation
        // sent by the Kage; session admission seals their second acceptance.
        if (action === 'accept') {
            const out = await withKvLock<{ status: number; body: unknown; sealBattleId?: string; challengeId?: string }>(key, async () => {
                const raw = await kv.get<KageStateLike>(key);
                const challenge = raw?.challenge;
                if (!raw || !challenge) return { status: 404, body: { error: 'There is no active Kage challenge.' } };
                if (!identity.admin && safeName(raw.seatedKage ?? '') !== playerName) return { status: 403, body: { error: 'Only the seated Kage can accept this challenge.' } };
                const actor = await kv.get<{ character?: { village?: string } }>(`save:${playerName}`);
                if (!identity.admin && actor?.character?.village !== village) return { status: 403, body: { error: 'You must belong to this village.' } };
                if (battleId) {
                    // Legacy retry may repair an already sealed duel, never turn an
                    // unrelated casual fight into an official challenge retroactively.
                    if (challenge.status !== 'accepted' || challenge.battleId !== battleId) return { status: 409, body: { error: 'Accept the challenge first, then send its official duel invitation.' } };
                    return { status: 200, body: { ok: true, challenge }, sealBattleId: battleId, challengeId: challenge.challengeId };
                }
                if (challenge.status === 'accepted' || challenge.kageAcceptedAt !== undefined) {
                    return { status: 200, body: { ok: true, challenge } };
                }
                const invitation = await loadChallengeRecord(String(body.invitationId ?? ''));
                if (!invitation || !await isCurrentKageInvitation(invitation) || invitation.status !== 'pending' || invitation.mode !== 'standard'
                    || invitation.from !== safeName(raw.seatedKage ?? '') || invitation.to !== safeName(challenge.challenger)
                    || invitation.challenge.kageChallengeId !== challenge.challengeId || invitation.challenge.kageVillage !== village) {
                    return { status: 409, body: { error: 'Send the official duel invitation before accepting this challenge.' } };
                }
                const next = { ...raw, challenge: { ...acceptKageChallenge(challenge, now), duelInvitation: invitation.challenge } };
                await commitExactKageState(key, raw, JSON.parse(JSON.stringify(next)));
                return { status: 200, body: { ok: true, challenge: next.challenge } };
            }, { failClosed: true });
            if (out.sealBattleId) await ensureKageDuelPointer(village, out.sealBattleId, String(out.challengeId));
            if (out.status === 200) await audit(village, { action: 'accept', playerName });
            return res.status(out.status).json(out.body);
        }

        // A short-lived duel popup never removes the challenger's opportunity
        // to accept. Reissue the Kage's verified invitation with a fresh normal
        // challenge receipt, without resetting either political response clock.
        if (action === 'invitation') {
            const result = await withKvLock(key, async () => {
                const state = await kv.get<KageStateLike>(key);
                const challenge = state?.challenge;
                if (!state || !challenge || challenge.status !== 'pending' || challenge.kageAcceptedAt === undefined
                    || !challenge.duelInvitation) return { status: 409, body: { error: 'There is no accepted Kage invitation to reopen.' } };
                if (safeName(challenge.challenger) !== playerName) return { status: 403, body: { error: 'Only the challenger can reopen their invitation.' } };
                const actor = await kv.get<{ character?: { village?: string } }>(`save:${playerName}`);
                if (actor?.character?.village !== village) return { status: 403, body: { error: 'You must belong to this village.' } };
                const invitation = { ...challenge.duelInvitation, id: randomUUID(), createdAt: now };
                if (!await isCurrentKageInvitation({ from: safeName(state.seatedKage ?? ''), to: playerName,
                    mode: 'standard', challenge: invitation })) return { status: 409, body: { error: 'The official invitation no longer matches this Kage challenge.' } };
                const record = { id: invitation.id, from: safeName(state.seatedKage ?? ''), to: playerName,
                    mode: 'standard' as const, status: 'pending' as const, createdAt: now, challenge: invitation };
                if (!await saveChallengeRecord(record)) throw new Error('kage-invitation-publication-conflict');
                const { enqueueChallenge } = await import('../player/challenge.js');
                await enqueueChallenge(playerName, invitation);
                return { status: 200, body: { ok: true } };
            }, { failClosed: true });
            return res.status(result.status).json(result.body);
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
        console.error('[village/kage-challenge]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
