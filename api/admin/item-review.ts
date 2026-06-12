import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { isAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { recordAudit } from '../_audit.js';

const APPROVED_ITEMS_KEY = 'admin:approvedItems';

async function loadApprovedItems(): Promise<string[]> {
    const approved = await kv.get<string[]>(APPROVED_ITEMS_KEY);
    return Array.isArray(approved) ? approved : [];
}

async function saveApprovedItems(ids: string[]) {
    await kv.set(APPROVED_ITEMS_KEY, Array.from(new Set(ids)));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        try {
            const approved = await loadApprovedItems();
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ approvedItems: approved });
        } catch (err) {
            console.error('[admin/item-review GET]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    if (req.method === 'POST') {
        if (!enforceRateLimit(req, res, 'admin-item-review', 60, 5 * 60_000)) return;
        // Admin password via header (was body). See players.ts.
        if (!isAdmin(req)) {
            return res.status(401).json({ error: 'Unauthorized.' });
        }
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { action, itemId } = body as {
                action?: 'approve' | 'hide';
                itemId?: string;
            };
            if (!itemId || (action !== 'approve' && action !== 'hide')) {
                return res.status(400).json({ error: 'Missing action or itemId.' });
            }

            const approved = await loadApprovedItems();
            const next = Array.from(new Set([...approved, itemId]));
            await saveApprovedItems(next);

            // Content audit (Priority 8) — best-effort, never blocks the response.
            await recordAudit({
                domain: 'content', actor: 'admin', action: `item.${action}`,
                entityType: 'item', entityId: itemId,
            });
            return res.status(200).json({ ok: true, approvedItems: next });
        } catch (err) {
            console.error('[admin/item-review POST]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
