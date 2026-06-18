import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';

/*
 * /api/village/war-debuff — GET ?village=<name>
 *
 * Returns the village's active "demoralized" debuff expiry (set on the loser's
 * village-state at war settlement, api/world-state.ts). 0 when none / expired.
 * Read by Training.tsx + PetYard.tsx to apply the -10% training XP / +20% jutsu
 * training time. Public + briefly cached (the value changes only at war-end).
 */

const VILLAGE_STATE_PREFIX = 'game:village-state:';
function villageStateKey(village: string): string {
    return `${VILLAGE_STATE_PREFIX}${village.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    const village = typeof req.query.village === 'string' ? req.query.village : '';
    if (!village) return res.status(400).json({ error: 'Missing village.' });
    const state = await kv.get<Record<string, unknown>>(villageStateKey(village));
    const until = Number(state?.warLossDebuffUntil ?? 0) || 0;
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=30');
    return res.status(200).json({ warLossDebuffUntil: until > Date.now() ? until : 0 });
}
