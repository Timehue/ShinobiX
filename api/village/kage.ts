import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';

type VillageKageState = {
    kageSystemUnlocked: boolean;
    seatedKage?: string;
    firstLiberator?: string;
    unlockedAt?: number;
};

function kageKey(village: string) {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const village = typeof req.query.village === 'string' ? req.query.village.trim() : '';

    if (req.method === 'GET') {
        try {
            if (!village) return res.status(400).json({ error: 'Missing village.' });
            const state = await kv.get<VillageKageState>(kageKey(village)) ?? { kageSystemUnlocked: false };
            res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
            return res.status(200).json(state);
        } catch (err) {
            console.error('[village/kage]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { village: bodyVillage, playerName, action } = body as {
                village?: string;
                playerName?: string;
                action?: 'unlock' | 'seat';
            };
            const v = (bodyVillage ?? '').trim() || village;
            if (!v || !playerName) return res.status(400).json({ error: 'Missing village or playerName.' });

            const key = kageKey(v);
            const current = await kv.get<VillageKageState>(key) ?? { kageSystemUnlocked: false };

            if (action === 'unlock') {
                if (current.kageSystemUnlocked) {
                    // Already unlocked — return current without changing the seated kage
                    return res.status(200).json(current);
                }
                const next: VillageKageState = {
                    kageSystemUnlocked: true,
                    seatedKage: playerName,
                    firstLiberator: playerName,
                    unlockedAt: Date.now(),
                };
                await kv.set(key, next);
                return res.status(200).json(next);
            }

            if (action === 'seat') {
                if (!current.kageSystemUnlocked) {
                    return res.status(400).json({ error: 'Kage system not unlocked for this village.' });
                }
                const next: VillageKageState = { ...current, seatedKage: playerName };
                await kv.set(key, next);
                return res.status(200).json(next);
            }

            return res.status(400).json({ error: 'Invalid action.' });
        } catch (err) {
            console.error('[village/kage]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
