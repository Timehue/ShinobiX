import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { isAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { cors } from '../_utils.js';
import { publicCapabilities } from '../player/_public-capabilities.js';
import { runtimeModeCapabilityMatrix } from '../../shared/runtime-mode-capabilities.js';

/** Read-only server projection of the canonical runtime registry for operators. */
export default function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-runtime-mode-capabilities', 30, 60_000)) return;

    const capabilities = publicCapabilities();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
        ok: true,
        capabilities,
        runtimeModes: runtimeModeCapabilityMatrix(capabilities),
    });
}
