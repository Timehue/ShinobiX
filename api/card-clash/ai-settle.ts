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
    cleanCardClashAiResult,
    utcDateKey,
    type CardClashAiToken,
} from './_ai-reward.js';

const MATCH_ID_RE = /^[0-9a-fA-F-]{20,80}$/;

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const matchId = String(body.matchId ?? '').trim();
        const result = cleanCardClashAiResult(body.result);
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });
        if (!MATCH_ID_RE.test(matchId)) return res.status(400).json({ error: 'Invalid matchId.' });
        if (!result) return res.status(400).json({ error: 'Invalid match result.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'You can only settle your own AI card match.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'card-clash-ai-settle', 30, 60_000, identity.name))) return;

        const tokenKey = cardClashAiTokenKey(matchId);
        const out = await withKvLock(tokenKey, async () => {
            const token = await kv.get<CardClashAiToken>(tokenKey);
            if (!token) return { status: 404 as const, body: { error: 'Card match token not found or expired.' } };
            if (token.playerName !== playerName) return { status: 403 as const, body: { error: 'Card match token belongs to another player.' } };
            if (token.settledAt) return { status: 409 as const, body: { error: 'Card match already settled.' } };

            const now = Date.now();
            const quickWin = result === 'player' && now - Number(token.createdAt ?? 0) < CARD_CLASH_AI_MIN_WIN_DURATION_MS;
            const today = utcDateKey(now);
            const settled = await mutatePlayerSave(playerName, ({ character }) => {
                const alreadyWonToday = String(character.cardClashDailyWinDate ?? '') === today;
                const reward = quickWin ? { ryo: 0, dailyBonus: false } : cardClashAiReward(result, alreadyWonToday);
                const nextCharacter = {
                    ...character,
                    ryo: num(character.ryo) + reward.ryo,
                    cardClashWins: num(character.cardClashWins) + (result === 'player' ? 1 : 0),
                    cardClashLosses: num(character.cardClashLosses) + (result === 'opponent' ? 1 : 0),
                    cardClashDraws: num(character.cardClashDraws) + (result === 'draw' ? 1 : 0),
                    cardClashDailyWinDate: reward.dailyBonus ? today : character.cardClashDailyWinDate,
                };
                return {
                    ok: true,
                    character: nextCharacter,
                    value: { result, ryo: reward.ryo, dailyBonus: reward.dailyBonus, quickWin },
                };
            });
            if (!settled.ok) return { status: settled.status, body: { error: settled.error } };

            await kv.set(tokenKey, { ...token, settledAt: now }, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
            return {
                status: 200 as const,
                body: {
                    ok: true,
                    ...settled.value,
                    character: settled.character,
                    _saveVersion: settled._saveVersion,
                },
            };
        }, { failClosed: true });

        return res.status(out.status).json(out.body);
    } catch (err) {
        console.error('[card-clash/ai-settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
