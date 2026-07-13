import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { applyMasteryInvestment } from '../_profession-mastery.js';

const RESPEC_COST = 50_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req); if (req.method === 'OPTIONS') return res.status(200).end(); if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? '')); const action = String(body.action ?? '');
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await authedPlayerOrAdmin(req, playerName); if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only update your own mastery.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'profession-mastery', 30, 60_000, identity.name))) return;
        const result = await mutatePlayerSave(playerName, ({ character }) => {
            if (!character.profession) return { ok: false as const, status: 409, error: 'Choose a profession first.' };
            if (action === 'invest') {
                const masterySpec = applyMasteryInvestment(character.profession, character.professionXp, character.masterySpec, String(body.nodeId ?? ''));
                if (!masterySpec) return { ok: false as const, status: 409, error: 'That mastery node cannot be increased.' };
                return { ok: true as const, character: { ...character, masterySpec }, value: { action } };
            }
            if (action === 'respec') {
                const ryo = Math.max(0, Number(character.ryo) || 0); if (ryo < RESPEC_COST) return { ok: false as const, status: 409, error: `Respec costs ${RESPEC_COST} ryo.` };
                return { ok: true as const, character: { ...character, ryo: ryo - RESPEC_COST, masterySpec: {} }, value: { action } };
            }
            return { ok: false as const, status: 400, error: 'Invalid mastery action.' };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) { console.error('[profession/mastery]', error); return res.status(500).json({ error: 'Internal server error.' }); }
}
