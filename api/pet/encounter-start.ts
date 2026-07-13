import { randomInt, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { DAILY_WILD_ENCOUNTER_ATTEMPTS, rollWildPet } from './_encounter.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req); if (req.method === 'OPTIONS') return res.status(200).end(); if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const identity = playerName ? await authedPlayerOrAdmin(req, playerName) : null;
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your encounter.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-encounter-start', 180, 60_000, identity.name))) return;
        const day = new Date().toISOString().slice(0, 10);
        const count = await kv.incr(`pet-encounter-attempt:${playerName}:${day}`, { ex: 26 * 60 * 60 });
        if (!identity.admin && count > DAILY_WILD_ENCOUNTER_ATTEMPTS) return res.status(429).json({ error: 'Daily exploration limit reached.' });
        const pet = rollWildPet(() => randomInt(1_000_000_000) / 1_000_000_000);
        if (!pet) return res.status(200).json({ ok: true, pet: null });
        const token = randomUUID().replace(/-/g, '');
        await kv.set(`pet-encounter:${playerName}:${token}`, { playerName, pet, mintedAt: Date.now() }, { ex: 20 * 60 });
        return res.status(200).json({ ok: true, token, pet });
    } catch (error) { console.error('[pet/encounter-start]', error); return res.status(500).json({ error: 'Internal server error.' }); }
}
