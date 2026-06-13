import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { isAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { readBattleReceipt } from '../_receipts.js';

// Admin-only durable battle-receipt lookup (Priority 3 / 4 visibility).
//
// Receipts are written once when a PvP battle resolves (api/_receipts.ts) and
// kept for 90 days, outliving the 15-min session TTL. This endpoint lets a
// support admin paste a battleId and see exactly what happened — fighters,
// rounds, winner, the final combat log, and the server-credited settlement
// (ranked delta + whether base ryo/XP was credited) — to triage a reward
// dispute or "the fight glitched" report.
//
//   GET /api/admin/battle-receipts?battleId=<id>   (x-admin-password header)
//   → 200 { receipt } | 404 { error }
//
// Read-only: it never mutates game state, so either admin tier may use it.
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-battle-receipts', 60, 60_000)) return;

    const body = typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
        : (req.body ?? {});
    const battleId = String(
        (req.query?.battleId as string | undefined) ?? body?.battleId ?? '',
    ).trim();
    if (!battleId) return res.status(400).json({ error: 'Missing battleId.' });

    const receipt = await readBattleReceipt(battleId);
    res.setHeader('Cache-Control', 'no-store');
    if (!receipt) {
        return res.status(404).json({
            error: 'No receipt for that battleId — it may predate receipts, or the 90-day window has expired.',
        });
    }
    return res.status(200).json({ receipt });
}
