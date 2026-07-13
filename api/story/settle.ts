import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { aiFightTokenKey, cleanAiFightToken, type AiFightToken } from '../missions/_ai-fight-token.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { applyAcademySparSettlement, applyStoryBossSettlement } from './_settle.js';

type StoryRedemption = { token: string; progress: number; xp: number; ryo: number; auraDust: number; finale: boolean };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const token = cleanAiFightToken(body.aiFightToken ?? body.token);
        if (!playerName || !token) return res.status(400).json({ error: 'Player name and battle token are required.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only settle your own story battle.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'story-settle', 12, 60_000, identity.name))) return;

        const result = await mutatePlayerSave(playerName, async ({ character }) => {
            const redeemed = Array.isArray(character.redeemedStoryBattles)
                ? (character.redeemedStoryBattles as unknown[]).filter((entry): entry is StoryRedemption => !!entry && typeof entry === 'object' && typeof (entry as StoryRedemption).token === 'string')
                : [];
            const prior = redeemed.find((entry) => entry.token === token);
            if (prior) return { ok: true as const, character, value: { ...prior, replayed: true } };
            const tokenData = await kv.get<AiFightToken>(aiFightTokenKey(playerName, token));
            if (!tokenData) return { ok: false as const, status: 409, error: 'Story battle token is invalid or already spent.' };
            if ((tokenData.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) return { ok: false as const, status: 403, error: 'Battle token belongs to another player.' };
            const settled = body.kind === 'academySparring'
                ? applyAcademySparSettlement(character, tokenData)
                : applyStoryBossSettlement(character, tokenData, body.survivingHp);
            if (!settled.ok) return settled;
            const redemption: StoryRedemption = { token, progress: settled.progress, xp: settled.xp, ryo: settled.ryo, auraDust: settled.auraDust, finale: settled.finale };
            return {
                ok: true as const,
                character: { ...settled.character, redeemedStoryBattles: [...redeemed.slice(-19), redemption] },
                value: { ...redemption, replayed: false, title: settled.title },
            };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        await kv.del(aiFightTokenKey(playerName, token)).catch(() => undefined);
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (err) {
        console.error('[story/settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
