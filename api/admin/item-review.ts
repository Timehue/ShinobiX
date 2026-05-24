import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { safeEqual } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';

const APPROVED_ITEMS_KEY = 'admin:approvedItems';

async function loadApprovedItems(): Promise<string[]> {
    const approved = await kv.get<string[]>(APPROVED_ITEMS_KEY);
    return Array.isArray(approved) ? approved : [];
}

async function saveApprovedItems(ids: string[]) {
    await kv.set(APPROVED_ITEMS_KEY, Array.from(new Set(ids)));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        try {
            const approved = await loadApprovedItems();
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ approvedItems: approved });
        } catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }

    if (req.method === 'POST') {
        if (!enforceRateLimit(req, res, 'admin-item-review', 60, 5 * 60_000)) return;
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { password, action, itemId } = body as {
                password?: string;
                action?: 'approve' | 'hide';
                itemId?: string;
            };

            const adminPassword = process.env.ADMIN_PASSWORD;
            if (!adminPassword || !password || !safeEqual(password, adminPassword)) {
                return res.status(401).json({ error: 'Unauthorized.' });
            }
            if (!itemId || (action !== 'approve' && action !== 'hide')) {
                return res.status(400).json({ error: 'Missing action or itemId.' });
            }

            const approved = await loadApprovedItems();
            const next = Array.from(new Set([...approved, itemId]));
            await saveApprovedItems(next);

            return res.status(200).json({ ok: true, approvedItems: next });
        } catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }

    return res.status(405).end();
}
