import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { claimBuiltinEvent } from './_claim.js';

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
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your event claim.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'event-claim', 10, 60_000, identity.name))) return;
        const result = await mutatePlayerSave(playerName, ({ character }) => {
            const claimed = claimBuiltinEvent(character, body.eventId);
            if (!claimed.ok) return { ok: false as const, status: 409, error: claimed.reason };
            return { ok: true as const, character: claimed.character, value: { alreadyClaimed: claimed.alreadyClaimed } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        console.error('[events/claim]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
