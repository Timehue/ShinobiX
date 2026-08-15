import type { VercelRequest, VercelResponse } from '../_vercel.js';
import type { PublicCapabilitiesResponse } from '../../shared/public-capabilities.js';
import { cors } from '../_utils.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { publicCapabilities } from './_public-capabilities.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    // Read-only, in-process projection. The budget is deliberately sized for
    // many visible clients behind one school/office NAT; clients still use a
    // jittered 30s cadence with failure backoff.
    if (!enforceRateLimit(req, res, 'public-capabilities', 600, 60_000)) return;
    const body: PublicCapabilitiesResponse = { ok: true, capabilities: publicCapabilities() };
    return res.status(200).json(body);
}
