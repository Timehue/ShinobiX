import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import {
    CARD_CLASH_AI_MIN_WIN_DURATION_MS,
    CARD_CLASH_AI_TOKEN_TTL_SECONDS,
    cardClashAiReward,
    cardClashAiTokenKey,
    utcDateKey,
} from './_ai-reward.js';
import {
    endTurn,
    forfeit,
    isDone,
    playOne,
    projectAiMatch,
    type AiMatchResult,
    type AiMatchSession,
} from './_ai-engine.js';

/*
 * /api/card-clash/ai-move — POST only. Drives a SERVER-AUTHORITATIVE single-player
 * Shinobi Card Clash match started by ai-start.
 *
 *   { matchId, action:'play', handIndex, locationIndex }  → play one card (revealed)
 *   { matchId, action:'end-turn' }                        → AI responds, turn advances
 *   { matchId, action:'retreat' }                         → forfeit (opponent win)
 *   { matchId, action:'state' }                           → re-read the projection
 *
 * The winner is computed by the engine (determineWinner), NEVER supplied by the
 * client, so a fabricated win cannot be paid. On the terminal turn the reward is
 * settled from the SERVER-computed result (same amounts/daily-bonus as the old
 * ai-settle, via _ai-reward.ts) under the session lock, with a settledAt
 * idempotency guard so a replayed final move never double-pays. The pre-existing
 * min-win-duration guard (createdAt→now) is kept as anti-farming defence in depth.
 */

const MATCH_ID_RE = /^[0-9a-fA-F-]{20,80}$/;

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

type SettledReward = { result: AiMatchResult; ryo: number; dailyBonus: boolean };

// A session that has been (or is being) settled carries the paid reward so a
// replayed end-turn / state read returns it without re-paying.
type StoredSession = AiMatchSession & { settledReward?: SettledReward };

// Pay the Ryo reward from the SERVER-computed winner. Returns the credited
// character + reward, or an error status. Idempotent at the caller (settledAt).
async function settle(session: StoredSession, now: number): Promise<
    | { ok: true; reward: SettledReward; character: Record<string, unknown>; saveVersion: number }
    | { ok: false; status: number; error: string }
> {
    const winner = session.winner ?? 'draw';
    const quickWin = winner === 'player' && now - Number(session.createdAt ?? 0) < CARD_CLASH_AI_MIN_WIN_DURATION_MS;
    const today = utcDateKey(now);
    const settled = await mutatePlayerSave(session.playerName, ({ character }) => {
        const alreadyWonToday = String(character.cardClashDailyWinDate ?? '') === today;
        const reward = quickWin ? { ryo: 0, dailyBonus: false } : cardClashAiReward(winner, alreadyWonToday);
        const nextCharacter = {
            ...character,
            ryo: num(character.ryo) + reward.ryo,
            cardClashWins: num(character.cardClashWins) + (winner === 'player' ? 1 : 0),
            cardClashLosses: num(character.cardClashLosses) + (winner === 'opponent' ? 1 : 0),
            cardClashDraws: num(character.cardClashDraws) + (winner === 'draw' ? 1 : 0),
            cardClashDailyWinDate: reward.dailyBonus ? today : character.cardClashDailyWinDate,
        };
        return {
            ok: true as const,
            character: nextCharacter,
            value: { result: winner, ryo: reward.ryo, dailyBonus: reward.dailyBonus } as SettledReward,
        };
    });
    if (!settled.ok) return { ok: false, status: settled.status, error: settled.error };
    return { ok: true, reward: settled.value, character: settled.character, saveVersion: settled._saveVersion };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const matchId = String(body.matchId ?? '').trim();
        const action = String(body.action ?? '');
        if (!MATCH_ID_RE.test(matchId)) return res.status(400).json({ error: 'Invalid matchId.' });

        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'card-clash-ai-move', 120, 60_000, identity.name))) return;

        const key = cardClashAiTokenKey(matchId);
        const out = await withKvLock(key, async () => {
            const session = await kv.get<StoredSession>(key);
            if (!session) return { status: 404 as const, body: { error: 'Card match not found or expired.' } };
            if (!identity.admin && identity.name !== session.playerName) {
                return { status: 403 as const, body: { error: 'Card match belongs to another player.' } };
            }

            // state: just project (returns the paid reward too if already settled).
            if (action === 'state') {
                return { status: 200 as const, body: { ok: true, session: projectAiMatch(session), reward: session.settledReward } };
            }

            if (action === 'play') {
                const handIndex = Math.floor(Number(body.handIndex));
                const locationIndex = Math.floor(Number(body.locationIndex));
                const res2 = playOne(session, 'p1', handIndex, locationIndex);
                if (!res2.ok) return { status: 400 as const, body: { error: res2.error } };
                await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
                return { status: 200 as const, body: { ok: true, session: projectAiMatch(session) } };
            }

            if (action === 'end-turn' || action === 'retreat') {
                // Idempotent: a replayed terminal move returns the paid reward,
                // never a second payout.
                if (isDone(session)) {
                    return { status: 200 as const, body: { ok: true, session: projectAiMatch(session), reward: session.settledReward } };
                }

                if (action === 'retreat') forfeit(session);
                else endTurn(session);

                if (!isDone(session)) {
                    await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
                    return { status: 200 as const, body: { ok: true, session: projectAiMatch(session) } };
                }

                // Terminal turn → settle from the server-computed winner.
                const now = Date.now();
                const paid = await settle(session, now);
                if (!paid.ok) {
                    // Persist the finished match (unsettled) so a retry can pay; the
                    // status guard above keeps it single-pay once settledAt is set.
                    await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
                    return { status: paid.status as 404 | 503, body: { error: paid.error } };
                }
                session.settledAt = now;
                session.settledReward = paid.reward;
                await kv.set(key, session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
                return {
                    status: 200 as const,
                    body: {
                        ok: true,
                        session: projectAiMatch(session),
                        reward: paid.reward,
                        character: paid.character,
                        _saveVersion: paid.saveVersion,
                    },
                };
            }

            return { status: 400 as const, body: { error: `Unknown action: ${action}` } };
        }, { failClosed: true });

        return res.status(out.status).json(out.body);
    } catch (err) {
        console.error('[card-clash/ai-move]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
