import { safeLogValue } from '../_safe-log.js';
import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { mutateDungeonRun } from './_run.js';
import { sectorPresenceBlock } from '../_sector-presence-gate.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req); if (req.method === 'OPTIONS') return res.status(200).end(); if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player.' });
        const identity = await authedPlayerOrAdmin(req, playerName); if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your dungeon run.' });
        const action = typeof body.action === 'string' ? body.action : '';
        if (!identity.admin && !(await enforceRateLimitKv(req, res, action === 'probe-free' ? 'dungeon-probe' : 'dungeon-run', action === 'probe-free' ? 180 : 20, 60_000, identity.name))) return;
        if (action === 'probe-free' && !identity.admin) {
            const presenceBlock = sectorPresenceBlock(playerName, body.sector);
            if (presenceBlock) return res.status(presenceBlock.status).json({ error: presenceBlock.error, reason: presenceBlock.reason });
        }
        const result = await mutatePlayerSave(playerName, ({ character }) => {
            const out = mutateDungeonRun(character, body.action, body.token, randomUUID().replaceAll('-', ''));
            if (!out.ok) return { ok: false as const, status: 409, error: out.reason };
            return { ok: true as const, character: out.character, value: { token: out.token, found: 'found' in out ? out.found : undefined, alreadyApplied: out.alreadyApplied } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) { console.error('[dungeon/run]', safeLogValue(error)); return res.status(500).json({ error: 'Internal server error.' }); }
}
