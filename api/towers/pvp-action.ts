import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import type { TowerPvpActionType } from '../../shared/tower-pvp.js';
import { projectTowerPvpMatchForViewer, TOWER_PVP_ID } from './_pvp-session.js';
import { applyTowerPvpCommand } from './_pvp-action.js';
import { LockContendedError } from '../_lock.js';

/** POST one idempotent, optimistic-concurrency 2v2 combat command. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const matchId = String(body.matchId ?? '');
        if (!playerName || !TOWER_PVP_ID.test(matchId)) return res.status(400).json({ error: 'Valid player and match are required.' });
        if (!enforceRateLimit(req, res, 'tower-pvp-action', 120, 60_000, playerName)) return;
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only act as your own fighter.' });
        const slug = identity.admin ? playerName : identity.name;
        const outcome = await applyTowerPvpCommand({
            matchId,
            slug,
            type: String(body.type ?? '') as TowerPvpActionType,
            targetId: body.targetId,
            tile: body.tile,
            jutsuId: body.jutsuId,
            itemId: body.itemId,
            moveToken: body.moveToken,
            expectedVersion: body.expectedVersion,
        });
        res.setHeader('Cache-Control', 'private, no-store');
        return res.status(outcome.status).json({
            applied: outcome.applied,
            replayed: outcome.replayed,
            reason: outcome.reason,
            match: outcome.match ? projectTowerPvpMatchForViewer(outcome.match, slug) : undefined,
            currentVersion: outcome.currentVersion,
        });
    } catch (error) {
        if (error instanceof LockContendedError) {
            res.setHeader('Retry-After', '1');
            return res.status(503).json({ error: 'Tower MPvP state is busy. Retry this request.', errorCode: 'tower-pvp-busy' });
        }
        console.error('[towers/pvp-action]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
