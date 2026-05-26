import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';

const VALID_PROFESSIONS = ['healer', 'vanguard', 'petTamer'] as const;
type Profession = typeof VALID_PROFESSIONS[number];

const PROFESSION_UNLOCK_LEVEL = 13;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const profession = String(body.profession ?? '') as Profession;

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!VALID_PROFESSIONS.includes(profession)) {
            return res.status(400).json({ error: 'Invalid profession.' });
        }
        // Admin accounts can't pick a profession — the picker UI also skips
        // them, but block at the endpoint as defense-in-depth.
        if (playerName.toLowerCase() === 'admin 1' || playerName.toLowerCase() === 'admin 2') {
            return res.status(403).json({ error: 'Admin accounts do not pick professions.' });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only choose a profession for yourself.' });
        }

        const key = `save:${playerName}`;
        const existing = await kv.get<Record<string, unknown>>(key);
        if (!existing) return res.status(404).json({ error: 'Player not found.' });

        const char = existing.character as Record<string, unknown> | undefined;
        if (!char) return res.status(404).json({ error: 'Character not found.' });

        const level = Number(char.level ?? 0);
        if (level < PROFESSION_UNLOCK_LEVEL) {
            return res.status(403).json({
                error: `Profession unlocks at Level ${PROFESSION_UNLOCK_LEVEL}.`,
            });
        }

        if (char.profession) {
            return res.status(409).json({
                error: 'Profession already chosen and cannot be changed.',
                current: char.profession,
            });
        }

        const updated = {
            ...existing,
            character: {
                ...char,
                profession,
                professionRank: 1,
                professionXp: 0,
                professionChosenAt: Date.now(),
            },
        };

        await kv.set(key, mergePreservingImages(updated, existing));
        return res.status(200).json({ ok: true, profession });
    } catch (err) {
        console.error('[profession/choose]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
