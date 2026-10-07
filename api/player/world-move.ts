import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, parseJsonBody } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { applyWorldMovement, worldMovementSnapshot, nearbyWorldPlayers } from '../_realtime/world-movement-service.js';
import { onlineStore } from '../_realtime/online-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    const identity = await authedPlayerOrAdmin(req);
    if (!identity || identity.admin) return res.status(401).json({ error: 'Player authentication required.' });
    if (!enforceRateLimit(req, res, 'world-movement', 600, 60_000, identity.name)) return;
    const player = onlineStore.get(identity.name);
    if (!player) return res.status(409).json({ ok: false, reason: 'offline' });
    if (req.method === 'GET') return res.status(200).json({ ok: true, ...worldMovementSnapshot(player), players: nearbyWorldPlayers(player) });
    const parsed = parseJsonBody(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const result = await applyWorldMovement(identity.name, parsed.body);
    return res.status(result.ok ? 200 : 409).json(result);
}
