import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { maxPets } from '../_entitlements.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { safeLogValue } from '../_safe-log.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { listPetSanctuary } from './_sanctuary.js';

function queryValue(value: unknown): string {
    return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    try {
        const playerName = safeName(queryValue(req.query?.playerName));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only view your own sanctuary.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-sanctuary-list', 90, 60_000, identity.name))) return;
        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = record?.character as Record<string, unknown> | undefined;
        if (!character) return res.status(404).json({ error: 'Player save not found.' });
        const carried = Array.isArray(character.pets) ? character.pets as Array<Record<string, unknown>> : [];
        const result = await listPetSanctuary(playerName, {
            cursor: queryValue(req.query?.cursor).slice(0, 32),
            search: queryValue(req.query?.search).slice(0, 64),
            element: queryValue(req.query?.element).slice(0, 32),
            rarity: queryValue(req.query?.rarity).slice(0, 32),
            origin: queryValue(req.query?.origin).slice(0, 32),
            limit: Number(queryValue(req.query?.limit)) || undefined,
            excludePetIds: carried.map((pet) => String(pet.id ?? '')).filter(Boolean),
        });
        res.setHeader('Cache-Control', 'private, no-store');
        return res.status(200).json({
            ok: true,
            ...result,
            carriedCount: carried.length,
            carriedCapacity: maxPets(character),
        });
    } catch (error) {
        console.error('[pet/sanctuary/list]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
