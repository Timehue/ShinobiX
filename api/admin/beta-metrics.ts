import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { readBetaMetricsSnapshot } from '../_beta-metrics.js';

// Admin-only beta readiness telemetry reader.
//
//   GET /api/admin/beta-metrics?days=14   (x-admin-password header)
//   -> 200 { ok, generatedAt, days, daily, totals }
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    if (!isFullAdmin(req)) return res.status(403).json({ error: 'Full admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-beta-metrics', 60, 60_000)) return;

    const body = typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
        : (req.body ?? {});
    const days = Math.max(1, Math.min(Number(req.query?.days ?? body?.days ?? 14) || 14, 60));
    const snapshot = await readBetaMetricsSnapshot(days);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, ...snapshot });
}
