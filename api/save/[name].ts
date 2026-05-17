import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { safeName, mergePreservingImages, cors } from '../_utils.js';

const REGISTRY_KEY = 'player:registry';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const name = safeName(String(req.query.name ?? ''));
    if (!name) return res.status(400).json({ error: 'Invalid name.' });

    const key = `save:${name}`;

    if (req.method === 'GET') {
        const data = await kv.get(key);
        if (data === null) return res.status(404).end();
        return res.status(200).json(data);
    }

    if (req.method === 'POST') {
        try {
            const resetSignalKey = `reset-signal:${name.toLowerCase()}`;
            const isAdminSave = req.query.signal === '1';

            // If a reset-signal is pending (admin edit in-flight) and this is NOT the admin save,
            // silently drop the client auto-save so it can't overwrite admin changes.
            if (!isAdminSave) {
                const pendingSignal = await kv.get(resetSignalKey);
                if (pendingSignal) return res.status(200).end();
            }

            const incoming = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const existing = await kv.get(key);
            const payload = existing ? mergePreservingImages(incoming, existing) : incoming;

            // Upsert player into persistent registry so admin can always see all accounts
            const char = (incoming as Record<string, unknown>)?.character as Record<string, unknown> | undefined;
            const displayName: string = (char?.name as string) || name;
            const registryEntry = {
                name: displayName,
                level: (char?.level as number) ?? 1,
                village: (char?.village as string) ?? '',
                specialty: (char?.specialty as string) ?? '',
                lastSeen: Date.now(),
            };

            await Promise.all([
                kv.set(key, payload),
                kv.hset(REGISTRY_KEY, { [name]: JSON.stringify(registryEntry) }),
                // Admin save: set reset-signal so client reloads on next heartbeat
                isAdminSave ? kv.set(resetSignalKey, 1, { ex: 300 }) : Promise.resolve(),
            ]);
            return res.status(200).end();
        } catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }

    if (req.method === 'DELETE') {
        try {
            await Promise.all([
                kv.del(key),
                kv.hdel(REGISTRY_KEY, name),
                // Signal the player's client to reload on next heartbeat (5-min TTL)
                kv.set(`reset-signal:${name.toLowerCase()}`, 1, { ex: 300 }),
            ]);
            return res.status(200).json({ ok: true });
        } catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }

    return res.status(405).end();
}
