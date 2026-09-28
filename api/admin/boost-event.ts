import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { safeLogValue } from '../_safe-log.js';
import { readStoredBoostEvent, startBoostEvent, stopBoostEvent } from '../_boost-event.js';
import { isBoostEventActive } from '../../shared/boost-event.js';

// Admin control for timed boost events (api/_boost-event.ts).
//
//   GET  /api/admin/boost-event                 → { event, active }
//   POST /api/admin/boost-event
//        { action: 'start', multiplier, targets, hours, title? } → { ok, event }
//        { action: 'stop' }                                     → { ok, stopped }
//
// Full admin only: an event changes reward rates for every player.
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    if (!isFullAdmin(req)) return res.status(403).json({ error: 'Full admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-boost-event', 30, 60_000)) return;
    res.setHeader('Cache-Control', 'no-store');

    try {
        if (req.method === 'GET') {
            const event = await readStoredBoostEvent();
            return res.status(200).json({ event, active: isBoostEventActive(event, Date.now()) });
        }

        const body = typeof req.body === 'string'
            ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
            : (req.body ?? {});
        const action = String(body?.action ?? '');
        if (action === 'start') {
            const result = await startBoostEvent({
                multiplier: body.multiplier,
                targets: body.targets,
                hours: body.hours,
                title: body.title,
                actor: 'admin',
            });
            if (!result.ok) return res.status(result.status).json({ error: result.error });
            return res.status(200).json({ ok: true, event: result.event });
        }
        if (action === 'stop') {
            const { stopped } = await stopBoostEvent('admin');
            return res.status(200).json({ ok: true, stopped });
        }
        return res.status(400).json({ error: "action must be 'start' or 'stop'." });
    } catch (err) {
        console.error('[admin/boost-event]', safeLogValue(err));
        return res.status(503).json({ error: 'Boost event storage is unavailable. Try again.' });
    }
}
