import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';

const APPROVED_BLOODLINES_KEY = 'admin:approvedBloodlines';

async function loadApprovedBloodlines() {
    const approved = await kv.get<string[]>(APPROVED_BLOODLINES_KEY);
    return Array.isArray(approved) ? approved : [];
}

async function saveApprovedBloodlines(ids: string[]) {
    await kv.set(APPROVED_BLOODLINES_KEY, Array.from(new Set(ids)));
}

function reviewKey(ownerKey: string, bloodlineId: string) {
    return `${ownerKey || 'admin'}:${bloodlineId}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { password, action, ownerKey, bloodlineId, bloodline } = body as {
            password?: string;
            action?: 'approve' | 'delete' | 'update';
            ownerKey?: string;
            bloodlineId?: string;
            bloodline?: Record<string, unknown>;
        };

        const adminPassword = process.env.ADMIN_PASSWORD;
        if (!adminPassword || password !== adminPassword) {
            return res.status(401).json({ error: 'Unauthorized.' });
        }
        if (!bloodlineId || (action !== 'approve' && action !== 'delete' && action !== 'update')) {
            return res.status(400).json({ error: 'Missing action or bloodlineId.' });
        }

        const cleanOwnerKey = safeName(ownerKey ?? '');
        const key = reviewKey(cleanOwnerKey || 'admin', bloodlineId);
        const approved = await loadApprovedBloodlines();

        if ((action === 'delete' || action === 'update') && cleanOwnerKey && cleanOwnerKey !== 'admin' && !cleanOwnerKey.startsWith('admin')) {
            const saveKey = `save:${cleanOwnerKey}`;
            const adminLockKey = `admin-lock:${cleanOwnerKey}`;
            const resetSignalKey = `reset-signal:${cleanOwnerKey}`;
            const snap = await kv.get<Record<string, unknown>>(saveKey);
            if (snap) {
                const rawBloodlines = Array.isArray(snap.savedBloodlines) ? snap.savedBloodlines : [];
                const nextBloodlines = action === 'delete'
                    ? rawBloodlines.filter((savedBloodline) => {
                        return !(savedBloodline && typeof savedBloodline === 'object' && String((savedBloodline as { id?: unknown }).id ?? '') === bloodlineId);
                    })
                    : rawBloodlines.map((savedBloodline) => {
                        if (!(savedBloodline && typeof savedBloodline === 'object' && String((savedBloodline as { id?: unknown }).id ?? '') === bloodlineId)) return savedBloodline;
                        return { ...(savedBloodline as Record<string, unknown>), ...bloodline, id: bloodlineId };
                    });
                await Promise.all([
                    kv.set(adminLockKey, 1, { ex: 300 }),
                    kv.set(saveKey, { ...snap, savedBloodlines: nextBloodlines }),
                    kv.set(resetSignalKey, 1, { ex: 300 }),
                ]);
            }
        }

        const nextApproved = action === 'update' ? approved : Array.from(new Set([...approved, key]));
        await saveApprovedBloodlines(nextApproved);
        return res.status(200).json({ ok: true, approvedBloodlines: nextApproved });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
