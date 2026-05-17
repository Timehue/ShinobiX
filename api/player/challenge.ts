import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from '../_utils.js';

const CHALLENGE_TTL = 120; // seconds — long enough for two heartbeat cycles

function challengeKey(name: string) {
    return `challenges:${name.toLowerCase().trim()}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { targetName, challenge } = body as { targetName?: string; challenge?: unknown };
        if (!targetName || !challenge) return res.status(400).json({ error: 'Missing targetName or challenge.' });

        const key = challengeKey(targetName);
        const existing = await kv.get<unknown[]>(key) ?? [];
        const updated = [...existing, challenge].slice(-20); // cap at 20 pending challenges
        await kv.set(key, updated, { ex: CHALLENGE_TTL });

        return res.status(200).json({ ok: true });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
