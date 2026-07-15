import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { readBattleReceipt } from '../_receipts.js';
import { kv } from '../_storage.js';
import { hollowGateCombatBindingKey, type HollowGateCombatBinding } from '../hollow-gate/_combat-session.js';

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
    if (!isFullAdmin(req)) return res.status(403).json({ error: 'Full admin access required.' });
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
    if (receipt) return res.status(200).json({ receipt });

    // Hollow Gate uses the shared server combat engine but banks through its
    // own run-bound receipt. Let support search the same runId here instead of
    // needing direct KV access during a reward/replay investigation.
    if (/^hgcombat-[a-f0-9]{32}$/.test(battleId)) {
        const [binding, settlement] = await Promise.all([
            kv.get<HollowGateCombatBinding>(hollowGateCombatBindingKey(battleId)),
            kv.get<Record<string, unknown>>(`hg-combat-paid:${battleId}`),
        ]);
        if (binding || settlement) {
            return res.status(200).json({ receipt: { type: 'hollow-gate-combat', battleId, binding, settlement } });
        }
    }

    return res.status(404).json({
        error: 'No receipt for that battleId — it may predate receipts, or the retention window has expired.',
    });
}
