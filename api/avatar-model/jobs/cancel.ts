import type { ApiRequest, ApiResponse } from '../../_vercel.js';
import { authedPlayer } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { cors } from '../../_utils.js';
import { endModelJob } from '../_settlement.js';

export default async function cancelModelJob(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    res.setHeader('Cache-Control', 'private, no-store');
    try {
        const owner = await authedPlayer(req);
        if (!owner) return res.status(401).end();
        if (!(await enforceRateLimitKv(req,res,'avatar-model-cancel',12,60_000,owner))) return;
        if (typeof req.query.id !== 'string') return res.status(404).end();
        const result = await endModelJob(req.query.id, owner, 'player-cancelled');
        if (result === 'unavailable') return res.status(404).end();
        if (result !== 'cancelled') return res.status(409).json({error:'Model request changed. Refresh its status.'});
        return res.status(200).json({state:result});
    } catch {
        return res.status(503).json({error:'Unable to cancel the request. Try again.'});
    }
}
