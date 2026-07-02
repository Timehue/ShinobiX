import type { VercelRequest, VercelResponse } from './_vercel.js';
import { cors } from './_utils.js';
import { isAdmin } from './_auth.js';
import { enforceRateLimitKv } from './_ratelimit.js';
import { readHallEntries } from './_announce.js';
import { legacyEnabled } from './_legacy-track.js';

/*
 * GET /api/hall-of-legends?type=<entryType> — permanent server history
 * (docs/legacy-system-plan.md §13). Entries are append-only; revoked ones
 * render with their status (never silently erased), hidden ones are
 * admin-only. Corrections happen through api/admin/legacy.ts.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    if (!legacyEnabled()) return res.status(200).json({ entries: [] });
    if (!(await enforceRateLimitKv(req, res, 'hall-of-legends', 30, 60_000, null))) return;

    try {
        const admin = isAdmin(req);
        const type = typeof req.query.type === 'string' ? req.query.type : '';
        const limit = Math.max(1, Math.min(200, Math.floor(Number(req.query.limit) || 100)));
        let entries = await readHallEntries({ includeHidden: admin, limit: 500 });
        if (type) entries = entries.filter((e) => e.entryType === type);
        // Admin responses include hidden entries — never let a shared cache
        // serve one to a player (verification finding).
        res.setHeader('Cache-Control', admin ? 'no-store' : 'public, max-age=60');
        return res.status(200).json({ entries: entries.slice(0, limit) });
    } catch (err) {
        console.error('[hall-of-legends]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
