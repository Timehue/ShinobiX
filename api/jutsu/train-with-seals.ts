import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';

// Honor Seal cost per jutsu-level increment, indexed by the *current* level
// (the one you're leveling FROM). 30→31 = 20 Seals, etc. Per docs/professions.md.
const SEAL_COSTS_BY_FROM_LEVEL: Record<number, number> = {
    30: 20,
    31: 25,
    32: 30,
    33: 35,
    34: 40,
    35: 45,
    36: 50,
    37: 55,
    38: 60,
    39: 65,
};

const MIN_LEVEL = 30;
const MAX_LEVEL = 40; // Seal path stops at 40 — 40→50 still requires PvP.

// Vanguard Rank 8+ pays 90% of the listed cost (10% discount).
const VANGUARD_RANK_FOR_DISCOUNT = 8;
const VANGUARD_DISCOUNT_MULT = 0.9;

function computeCost(fromLevel: number, profession: unknown, professionRank: unknown): number {
    const base = SEAL_COSTS_BY_FROM_LEVEL[fromLevel] ?? 0;
    if (base === 0) return 0;
    if (profession === 'vanguard' && Number(professionRank ?? 0) >= VANGUARD_RANK_FOR_DISCOUNT) {
        return Math.ceil(base * VANGUARD_DISCOUNT_MULT);
    }
    return base;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const jutsuId = String(body.jutsuId ?? '').trim();
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!jutsuId) return res.status(400).json({ error: 'Missing jutsuId.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only spend your own Seals.' });
        }

        const key = `save:${playerName}`;
        const record = await kv.get<Record<string, unknown>>(key);
        if (!record) return res.status(404).json({ error: 'Player not found.' });
        const char = record.character as Record<string, unknown> | undefined;
        if (!char) return res.status(404).json({ error: 'Character not found.' });

        const mastery = (char.jutsuMastery as Array<{ jutsuId: string; level: number; xp: number }> | undefined) ?? [];
        const idx = mastery.findIndex(m => m.jutsuId === jutsuId);
        if (idx === -1) return res.status(404).json({ error: 'You have not learned that jutsu.' });

        const current = mastery[idx];
        const fromLevel = Number(current.level ?? 0);
        // Honor Seal training only opens once the jutsu has been hand-grinded
        // to Lv 30 via ryo training. This prevents Seal-rich players from
        // skipping the entire early jutsu progression. Bloodline-locked
        // jutsu (and any element-gated jutsu) ARE eligible — once you've
        // legitimately trained one to 30, Seals can carry it the rest of
        // the way. The same-village / level / clan restrictions of the
        // bloodline don't change anything for this endpoint.
        if (fromLevel < MIN_LEVEL) {
            return res.status(400).json({ error: `Honor Seal training is only available at level ${MIN_LEVEL}+. Train this jutsu to ${MIN_LEVEL} with ryo first.` });
        }
        if (fromLevel >= MAX_LEVEL) {
            return res.status(400).json({ error: `Levels ${MAX_LEVEL}+ still require PvP training.` });
        }

        const cost = computeCost(fromLevel, char.profession, char.professionRank);
        if (cost <= 0) return res.status(400).json({ error: 'No cost defined for that level.' });

        const balance = Number(char.honorSeals ?? 0);
        if (balance < cost) {
            return res.status(402).json({ error: 'Not enough Honor Seals.', cost, balance });
        }

        // Apply: debit Seals, increment jutsu level.
        const newMastery = [...mastery];
        newMastery[idx] = { ...current, level: fromLevel + 1 };
        const updated = {
            ...record,
            character: {
                ...char,
                honorSeals: balance - cost,
                jutsuMastery: newMastery,
            },
        };
        await kv.set(key, mergePreservingImages(updated, record));

        return res.status(200).json({
            ok: true,
            jutsuId,
            newLevel: fromLevel + 1,
            sealsSpent: cost,
            honorSealsRemaining: balance - cost,
        });
    } catch (err) {
        console.error('[jutsu/train-with-seals]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
