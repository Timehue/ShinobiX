import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { targetName, attacker } = body as { targetName?: string; attacker?: unknown };
        if (!targetName) return res.status(400).json({ error: 'Missing targetName.' });

        const key = `presence:${targetName}`;
        const target = await kv.get<Record<string, unknown>>(key);
        if (!target) return res.status(404).json({ error: 'Target not online.' });

        await kv.set(key, { ...target, pendingAttacker: attacker ?? null }, { ex: 30 });
        return res.status(200).json({ ok: true });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
