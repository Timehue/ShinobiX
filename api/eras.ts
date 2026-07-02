import type { VercelRequest, VercelResponse } from './_vercel.js';
import { cors } from './_utils.js';
import { enforceRateLimitKv } from './_ratelimit.js';
import { getEraViews } from './_era.js';
import { legacyEnabled } from './_legacy-track.js';

/*
 * GET /api/eras — the world's chapter markers: current status, live milestone
 * progress toward the next unlock, and the credited history of past eras
 * (docs/legacy-system-plan.md §14). Read-only; unlocks happen server-side
 * (trigger hooks + the nightly cron pass), tuning happens via admin actions.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    if (!legacyEnabled()) return res.status(200).json({ eras: [] });
    if (!(await enforceRateLimitKv(req, res, 'eras', 30, 60_000, null))) return;

    try {
        const eras = await getEraViews();
        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.status(200).json({ eras });
    } catch (err) {
        console.error('[eras]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
