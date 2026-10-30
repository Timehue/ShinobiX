import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { rankUpHunter } from './_rank-up.js';

/** What the Hunter Board shows: the client puts `error` straight into an alert. */
const RANK_UP_REFUSALS: Record<string, string> = {
    'hunter-rank-materials-required': 'You no longer have the materials this rank needs. Refresh your inventory and try again.',
    'hunter-rank-max': 'You already hold the highest Hunter Rank.',
    'invalid-action-id': 'Hunter Rank advancement failed. Try again.',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your Hunter Rank.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hunter-rank-up', 10, 60_000, identity.name))) return;
        const result = await mutatePlayerSave(playerName, ({ character }) => {
            const ranked = rankUpHunter(character, body.actionId);
            if (!ranked.ok) return { ok: false as const, status: 409, error: ranked.reason };
            return { ok: true as const, character: ranked.character, value: { alreadyApplied: ranked.alreadyApplied } };
        });
        if (!result.ok) {
            return res.status(result.status).json({ error: RANK_UP_REFUSALS[result.error] ?? result.error, errorCode: result.error });
        }
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        console.error('[hunter/rank-up]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
