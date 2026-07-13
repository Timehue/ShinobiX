import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
const FOCI = new Set(['war', 'trade', 'training']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const focus = typeof body.focus === 'string' ? body.focus : '';
        if (!playerName || !FOCI.has(focus)) return res.status(400).json({ error: 'Invalid elder focus.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your elder focus.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'elder-focus', 10, 60_000, identity.name))) return;
        const result = await mutatePlayerSave(playerName, ({ character }) => ({ ok: true as const, character: { ...character, elderFocus: focus }, value: {} }));
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        console.error('[village/elder-focus]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
