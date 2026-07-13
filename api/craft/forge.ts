import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { applyForge, type CraftKind } from './_forge.js';

const requestId = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(v) ? v : '';
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req); if (req.method === 'OPTIONS') return res.status(200).end(); if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? '')); const id = requestId(body.requestId);
        const kind = String(body.kind ?? '') as CraftKind; const recipeId = String(body.recipeId ?? '').slice(0, 96);
        if (!playerName || !id || !['supply', 'weapon', 'armor', 'relic'].includes(kind)) return res.status(400).json({ error: 'Invalid craft request.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your forge.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'craft-forge', 40, 60_000, identity.name))) return;
        const result = await mutatePlayerSave(playerName, ({ character }) => {
            const receipts = Array.isArray(character.redeemedCrafts) ? character.redeemedCrafts as string[] : [];
            if (receipts.includes(id)) return { ok: true as const, character, value: { replayed: true } };
            const next = applyForge(character, kind, recipeId, body.quantity);
            if (!next) return { ok: false as const, status: 409, error: 'invalid-or-unaffordable-recipe' };
            return { ok: true as const, character: { ...next, redeemedCrafts: [...receipts.slice(-99), id] }, value: { replayed: false } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) { console.error('[craft/forge]', error); return res.status(500).json({ error: 'Internal server error.' }); }
}
