import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import {
    DURABLE_SETTLEMENT_RECONCILIATION_STATUS,
    listDurableSettlements,
    type DurableSettlementReconciliationSummary,
    type DurableSettlementState,
} from '../_durable-settlement.js';
import { runSettlementReconciliation } from '../cron/_settlement-reconciliation.js';

const STATES = new Set<DurableSettlementState>([
    'pending',
    'reserved',
    'debit-applied',
    'credit-applied',
    'completed',
    'cancelled',
    'refunded',
    'reconciliation-required',
]);

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
    const value = Math.floor(Number(raw));
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

/** Full-admin operator surface for durable economy journals. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    if (!isFullAdmin(req)) return res.status(403).json({ error: 'Full admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-economy-settlements', 30, 60_000)) return;

    try {
        if (req.method === 'POST') {
            const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
            if (body.action !== 'scan') return res.status(400).json({ error: 'Supported action: scan.' });
            const summary = await runSettlementReconciliation({
                staleAfterMs: boundedInt(body.staleAfterMs, 15 * 60_000, 60_000, 7 * 24 * 60 * 60_000),
                limit: boundedInt(body.limit, 100, 1, 500),
            });
            return res.status(200).json({ ok: true, summary });
        }

        const rawState = typeof req.query?.state === 'string' ? req.query.state : '';
        const state = STATES.has(rawState as DurableSettlementState) ? rawState as DurableSettlementState : null;
        const limit = boundedInt(req.query?.limit, 100, 1, 500);
        const all = (await listDurableSettlements({ kv })).sort((a, b) => b.updatedAt - a.updatedAt);
        const records = (state ? all.filter((record) => record.state === state) : all).slice(0, limit);
        const counts = Object.fromEntries([...STATES].map((candidate) => [
            candidate,
            all.filter((record) => record.state === candidate).length,
        ]));
        const lastScan = await kv.get<DurableSettlementReconciliationSummary>(DURABLE_SETTLEMENT_RECONCILIATION_STATUS);
        return res.status(200).json({ ok: true, total: all.length, counts, lastScan, records });
    } catch (error) {
        console.error('[admin/economy-settlements]', error);
        return res.status(500).json({ error: 'Failed to inspect durable settlements.' });
    }
}
