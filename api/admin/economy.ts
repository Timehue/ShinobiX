import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { isAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { readEconomySnapshot } from '../_economy.js';
import { readWarEcoSnapshot } from '../_war-telemetry.js';
import { WAR_VILLAGES } from '../_war-map-sectors.js';

// Admin-only economy telemetry reader (docs/economy-telemetry-plan.md).
//
// Surfaces the running created/destroyed aggregates per currency (faucet-vs-sink
// / inflation), a slice of the recent currency-delta transactions, and the
// duplicate-txnId anomaly flag. Also folds in the Village-War economy snapshot
// (WR + treasury-seal faucet-vs-sink, tax split, maintenance, dormancy per
// village — plan §8). Read-only, admin-gated.
//
//   GET /api/admin/economy?limit=200   (x-admin-password header)
//   → 200 { aggregates, recent, duplicateTxnIds, war }
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-economy', 60, 60_000)) return;

    const body = typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
        : (req.body ?? {});
    const limit = Math.max(1, Math.min(Number(req.query?.limit ?? body?.limit ?? 200) || 200, 5000));

    const snapshot = await readEconomySnapshot(limit);
    // Village-War economy telemetry (Phase 8) — per-village WR/seal faucet-vs-sink,
    // tax split, maintenance, dormancy. Empty until ENABLE_VILLAGE_WAR is on.
    const war = await readWarEcoSnapshot(WAR_VILLAGES, limit);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, ...snapshot, war });
}
