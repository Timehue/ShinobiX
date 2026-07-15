import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { readBetaMetricsSnapshot } from '../_beta-metrics.js';
import {
    buildBetaPopulationSnapshot,
    buildDailyBetaReport,
    formatDailyBetaReport,
} from '../_beta-report.js';

// Admin-only beta readiness telemetry reader.
//
//   GET /api/admin/beta-metrics?days=14&includePopulation=1&format=text
// Population scans are opt-in because save:* lives on the remote overlay. The
// response remains aggregate-only: names and raw save records are never returned.
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
    const includePopulation = String(req.query?.includePopulation ?? body?.includePopulation ?? '') === '1'
        || body?.includePopulation === true;
    let population;
    if (includePopulation) {
        const keys = await kv.keys('save:*');
        const records: unknown[] = [];
        for (let i = 0; i < keys.length; i += 200) {
            records.push(...await kv.mget(...keys.slice(i, i + 200)));
        }
        population = buildBetaPopulationSnapshot(records);
    }
    const report = buildDailyBetaReport(snapshot, population);
    res.setHeader('Cache-Control', 'no-store');
    if (String(req.query?.format ?? body?.format ?? '').toLowerCase() === 'text') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(formatDailyBetaReport(report));
    }
    return res.status(200).json({ ok: true, ...report });
}
