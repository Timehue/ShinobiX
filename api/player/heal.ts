import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { safeName, mergePreservingImages, cors } from '../_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const targetName = safeName(String(body.targetName ?? ''));
        if (!targetName) return res.status(400).json({ error: 'Invalid target name.' });

        const key = `save:${targetName}`;
        const existing = await kv.get<Record<string, unknown>>(key);
        if (!existing) return res.status(404).json({ error: 'Player not found.' });

        const char = existing.character as Record<string, unknown> | undefined;
        if (!char?.hospitalized) return res.status(400).json({ error: 'Player is not hospitalized.' });

        const healed = {
            ...existing,
            character: {
                ...char,
                hp: char.maxHp,
                chakra: char.maxChakra,
                stamina: char.maxStamina,
                hospitalized: false,
            },
        };

        await kv.set(key, mergePreservingImages(healed, existing));
        return res.status(200).json({ ok: true });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
