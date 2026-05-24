import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const targetName = safeName(String(body.targetName ?? ''));
        if (!targetName) return res.status(400).json({ error: 'Invalid target name.' });

        // Heal can only be self-targeted (or admin). Stops random bots from
        // healing every hospitalized player and nullifying hospital downtime.
        const identity = await authedPlayerOrAdmin(req, targetName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== targetName) {
            return res.status(403).json({ error: 'Can only heal yourself.' });
        }

        const key = `save:${targetName}`;
        const existing = await kv.get<Record<string, unknown>>(key);
        if (!existing) return res.status(404).json({ error: 'Player not found.' });

        const char = existing.character as Record<string, unknown> | undefined;
        if (!char?.hospitalized) return res.status(400).json({ error: 'Player is not hospitalized.' });

        // Enforce hospital timer: cannot heal out before the server-stamped
        // hospitalizedUntil expires (unless the actor is admin).
        const until = Number(char.hospitalizedUntil ?? 0);
        if (!identity.admin && until && Date.now() < until) {
            const remainingMs = until - Date.now();
            return res.status(429).json({
                error: 'Hospital timer not yet expired.',
                retryAfterMs: remainingMs,
            });
        }

        const healed = {
            ...existing,
            character: {
                ...char,
                hp: char.maxHp,
                chakra: char.maxChakra,
                stamina: char.maxStamina,
                hospitalized: false,
                hospitalizedUntil: 0,
            },
        };

        await kv.set(key, mergePreservingImages(healed, existing));
        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[heal]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
