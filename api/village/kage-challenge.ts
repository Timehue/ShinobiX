import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { onlineStore } from '../_realtime/online-store.js';
import type { PvpSession } from '../pvp/session.js';
import {
    canDeclareChallenge, isChallengeExpired, newChallenge, applyPress,
    applySeatTransfer, applyDefense, applyExpiry,
    KAGE_DECLARE_SEAL_COST, type KageStateLike,
} from './_kage-challenge.js';

/*
 * /api/village/kage-challenge — POST only
 *
 * Server-authoritative Kage succession. Replaces the old client-side challenge
 * theater (votes + a 23:00–03:00 UTC window that could never resolve) with a
 * real, async, online-only contest. See _kage-challenge.ts for the model + rules.
 *
 * Actions (body.action):
 *   - declare : a gated villager stakes 500 Honor Seals to open a challenge.
 *   - press   : the challenger pings to burn the Kage's "accept obligation",
 *               but ONLY while BOTH are verifiably online (live presence). The
 *               Kage can't dodge by hiding; an AFK challenger can't steal the seat.
 *   - accept  : the seated Kage agrees to duel — halts the forfeit clock.
 *   - resolve : either fighter submits the duel's battleId; the seat transfers
 *               (challenger won) or is defended (Kage won), cross-checked against
 *               the real PvpSession — the client can't fake the outcome.
 *
 * All seat-bearing mutations run under withKvLock(village:kage:<slug>) with
 * { failClosed: true }. The 500-seal debit nests the challenger's save lock
 * inside (kage-outer / save-inner — no other path takes them the other way).
 */

const SESSION_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const AUDIT_PREFIX = 'audit:kage-challenge:';

function kageKey(village: string): string {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}
function villageStateKey(village: string): string {
    return `game:village-state:${village.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}
function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function isOnline(name: string | undefined): boolean {
    return !!name && !!onlineStore.get(name);
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

        // ── DECLARE ──────────────────────────────────────────────────────────
        if (action === 'declare') {
            const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const char = (save?.character ?? null) as Record<string, unknown> | null;
            if (!char) return res.status(404).json({ error: 'Your save was not found.' });
            const vState = await kv.get<Record<string, unknown>>(villageStateKey(village));
            const contribution = num(vState?.contributionPoints);
            const challengerName = String(char.name ?? playerName);

            const out = await withKvLock<{ status: number; body: unknown }>(key, async () => {
                let state = (await kv.get<KageStateLike>(key)) ?? { kageSystemUnlocked: false };
                if (state.challenge && isChallengeExpired(state.challenge, now)) state = applyExpiry(state, now);

                const elig = canDeclareChallenge({
                    now, state, challengerName,
                    challengerLevel: num(char.level),
                    challengerSeals: num(char.honorSeals),
                    challengerAccountCreatedAt: num(char.createdAt),
                    villageContribution: contribution,
                    isMember: identity.admin || String(char.village ?? '').trim() === village,
                });
                if (!elig.ok) return { status: 403, body: { error: elig.reason } };

                // Stake the 500 seals (debit the challenger's save) BEFORE opening
                // the challenge — committed first, like the treasury-donate pattern.
                const debit = await withKvLock<{ ok: boolean }>(`save:${playerName}`, async () => {
                    const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                    const c = (rec?.character ?? null) as Record<string, unknown> | null;
                    if (!rec || !c) return { ok: false };
                    if (num(c.honorSeals) < KAGE_DECLARE_SEAL_COST) return { ok: false };
                    const nextChar = { ...c, honorSeals: num(c.honorSeals) - KAGE_DECLARE_SEAL_COST };
                    await kv.set(`save:${playerName}`, mergePreservingImages({ ...rec, character: nextChar }, rec));
                    return { ok: true };
                }, { failClosed: true });
                if (!debit.ok) return { status: 400, body: { error: `Challenging costs ${KAGE_DECLARE_SEAL_COST} Honor Seals.` } };

                const next = { ...state, challenge: newChallenge(challengerName, now) };
                await kv.set(key, next);
                return { status: 200, body: { ok: true, challenge: next.challenge } };
            }, { failClosed: true });

            if (out.status === 200) await audit(village, { action: 'declare', challenger: challengerName });
            return res.status(out.status).json(out.body);
        }

        // ── PRESS (burn the accept obligation during verified overlap) ────────
        if (action === 'press') {
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
                const bothOnline = isOnline(state.seatedKage) && isOnline(challenge.challenger);
                const pressed = applyPress(challenge, now, bothOnline);
                if (pressed.forfeited) {
                    const next = applySeatTransfer(state, challenge.challenger);
                    await kv.set(key, next);
                    return { status: 200, body: { ok: true, forfeited: true, seatedKage: next.seatedKage }, forfeitTo: challenge.challenger };
                }
                await kv.set(key, { ...state, challenge: pressed.challenge });
                return { status: 200, body: { ok: true, obligationRemainingMs: pressed.challenge.obligationRemainingMs, bothOnline } };
            }, { failClosed: true });
            if (out.forfeitTo) await audit(village, { action: 'forfeit', newKage: out.forfeitTo });
            return res.status(out.status).json(out.body);
        }

        // ── ACCEPT (Kage agrees to duel — halts the forfeit clock) ────────────
        if (action === 'accept') {
            const out = await withKvLock<{ status: number; body: unknown }>(key, async () => {
                let state = (await kv.get<KageStateLike>(key)) ?? { kageSystemUnlocked: false };
                if (state.challenge && isChallengeExpired(state.challenge, now)) { state = applyExpiry(state, now); await kv.set(key, state); }
                const challenge = state.challenge;
                if (!challenge) return { status: 404, body: { error: 'There is no active challenge to accept.' } };
                if (safeName(state.seatedKage ?? '') !== playerName && !identity.admin) {
                    return { status: 403, body: { error: 'Only the seated Kage can accept a challenge.' } };
                }
                const next = { ...state, challenge: { ...challenge, status: 'accepted' as const, battleId: battleId || challenge.battleId } };
                await kv.set(key, next);
                return { status: 200, body: { ok: true, challenge: next.challenge } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        // ── RESOLVE (settle the duel against the real PvpSession) ─────────────
        if (action === 'resolve') {
            if (!battleId) return res.status(400).json({ error: 'Missing battleId.' });
            const session = await kv.get<PvpSession>(`pvp:${battleId}`);
            if (!session) return res.status(404).json({ error: 'Battle session not found or expired.' });
            if (session.status !== 'done' || !session.winner || session.winner === 'draw') {
                return res.status(409).json({ error: 'That duel is not decided yet.' });
            }
            if (now - num(session.createdAt) > SESSION_REPLAY_WINDOW_MS) {
                return res.status(409).json({ error: 'That duel is too old to settle the seat.' });
            }
            const winnerName = session.winner === 'p1' ? session.p1.name : session.p2.name;
            const loserName = session.winner === 'p1' ? session.p2.name : session.p1.name;

            const out = await withKvLock<{ status: number; body: unknown; transferTo?: string; defended?: boolean }>(key, async () => {
                let state = (await kv.get<KageStateLike>(key)) ?? { kageSystemUnlocked: false };
                if (state.challenge && isChallengeExpired(state.challenge, now)) { state = applyExpiry(state, now); await kv.set(key, state); }
                const challenge = state.challenge;
                if (!challenge) return { status: 409, body: { error: 'There is no active challenge to settle.' } };

                // The seat may only change hands through the OFFICIAL accepted
                // duel — not any unrelated win against the Kage. Without this, a
                // challenger could satisfy resolve with a casual / ranked / sector
                // duel they happened to win in the last 24h while the challenge
                // was never accepted, bypassing the "Kage must accept or forfeit"
                // obligation (audit #11). An un-accepted challenge is settled via
                // the press/forfeit clock, never via resolve.
                if (challenge.status !== 'accepted') {
                    return { status: 409, body: { error: 'The Kage has not accepted this challenge — it settles via the forfeit clock, not an unrelated duel.' } };
                }
                // Defence-in-depth: when accept sealed the official duel's id, the
                // submitted duel MUST be that exact session. Skipped only for
                // legacy challenges that recorded no battleId at accept time
                // (the status==='accepted' gate above still applies to those).
                if (challenge.battleId && battleId !== challenge.battleId) {
                    return { status: 409, body: { error: 'That duel is not the accepted Kage duel.' } };
                }

                const seat = safeName(state.seatedKage ?? '');
                const challenger = safeName(challenge.challenger);
                const fighters = new Set([safeName(session.p1.name), safeName(session.p2.name)]);
                if (!fighters.has(seat) || !fighters.has(challenger)) {
                    return { status: 400, body: { error: 'That duel was not this Kage challenge.' } };
                }
                // Caller must be one of the two fighters.
                if (!identity.admin && playerName !== seat && playerName !== challenger) {
                    return { status: 403, body: { error: 'Only a participant can settle this challenge.' } };
                }
                const winner = safeName(winnerName);
                const loser = safeName(loserName);
                if (winner === challenger && loser === seat) {
                    const next = applySeatTransfer(state, challenge.challenger);
                    await kv.set(key, next);
                    return { status: 200, body: { ok: true, seatedKage: next.seatedKage, result: 'transferred' }, transferTo: challenge.challenger };
                }
                if (winner === seat && loser === challenger) {
                    const next = applyDefense(state, challenge.challenger, now);
                    await kv.set(key, next);
                    return { status: 200, body: { ok: true, seatedKage: next.seatedKage, result: 'defended' }, defended: true };
                }
                return { status: 400, body: { error: 'That duel result does not match this challenge.' } };
            }, { failClosed: true });

            if (out.transferTo) await audit(village, { action: 'duel-transfer', newKage: out.transferTo, battleId });
            else if (out.defended) await audit(village, { action: 'duel-defended', battleId });
            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        console.error('[village/kage-challenge]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
