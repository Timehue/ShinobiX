import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';

// Honor Seal training speedup. Each Seal reduces the current training timer
// by 10 minutes. 10 Seals = effectively instant (cap at 100 minutes per call
// to keep the math simple — the client can chain calls for longer skips).
//
// Training state lives on the client (activeJutsuTraining); this endpoint
// is the server-side ledger of Seal debits. The client subtracts the granted
// minutes from its local endsAt timestamp on success.
const MINUTES_PER_SEAL = 10;
const MAX_SEALS_PER_CALL = 20;

// Vanguard Rank 8+ pays 90% of the listed cost (10% discount), so the same
// time-skip costs fewer Seals: ceil(seals * 0.9).
const VANGUARD_RANK_FOR_DISCOUNT = 8;
const VANGUARD_DISCOUNT_MULT = 0.9;

function effectiveCost(seals: number, profession: unknown, professionRank: unknown): number {
    if (profession === 'vanguard' && Number(professionRank ?? 0) >= VANGUARD_RANK_FOR_DISCOUNT) {
        return Math.max(1, Math.ceil(seals * VANGUARD_DISCOUNT_MULT));
    }
    return seals;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const sealsRequested = Math.floor(Number(body.seals ?? 0));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!Number.isFinite(sealsRequested) || sealsRequested <= 0) {
            return res.status(400).json({ error: 'seals must be a positive integer.' });
        }
        if (sealsRequested > MAX_SEALS_PER_CALL) {
            return res.status(400).json({ error: `Max ${MAX_SEALS_PER_CALL} Seals per call.` });
        }

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

        const cost = effectiveCost(sealsRequested, char.profession, char.professionRank);
        const balance = Number(char.honorSeals ?? 0);
        if (balance < cost) {
            return res.status(402).json({ error: 'Not enough Honor Seals.', cost, balance });
        }

        const minutesReduced = sealsRequested * MINUTES_PER_SEAL;
        const updated = {
            ...record,
            character: {
                ...char,
                honorSeals: balance - cost,
            },
        };
        await kv.set(key, mergePreservingImages(updated, record));

        return res.status(200).json({
            ok: true,
            sealsRequested,
            sealsSpent: cost,
            minutesReduced,
            honorSealsRemaining: balance - cost,
        });
    } catch (err) {
        console.error('[jutsu/speedup]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
