import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { executeSoloPveAction } from './_action-service.js';
import type { SoloPveAction } from './_session.js';

function parseAction(body: Record<string, unknown>): SoloPveAction | null {
    const type = String(body.type ?? '');
    if (type === 'move' && Number.isFinite(Number(body.tile))) return { type, tile: Math.floor(Number(body.tile)) };
    if (type === 'jutsu' && typeof body.jutsuId === 'string' && body.jutsuId) {
        return { type, jutsuId: body.jutsuId.slice(0, 128), ...(Number.isFinite(Number(body.tile)) ? { tile: Math.floor(Number(body.tile)) } : {}) };
    }
    if ((type === 'weapon' || type === 'item') && typeof body.itemId === 'string' && body.itemId) {
        return { type, itemId: body.itemId.slice(0, 128) };
    }
    if (type === 'basicAttack' || type === 'basicHeal' || type === 'clear' || type === 'cleanse' || type === 'wait' || type === 'flee') {
        return { type };
    }
    return null;
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const sessionId = String(body.sessionId ?? '').slice(0, 128);
        const action = parseAction(body);
        if (!playerName || !sessionId || !action) return res.status(400).json({ error: 'Invalid solo-PvE action.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only act in your own encounter.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'solo-pve-action', 180, 60_000, identity.name))) return;

        const result = await executeSoloPveAction({
            sessionId,
            ownerSlug: playerName,
            expectedVersion: Number(body.expectedVersion),
            moveToken: String(body.moveToken ?? ''),
            action,
        });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[solo-pve/action]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
