import { randomInt } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { applyAncientChestLoot, DAILY_ANCIENT_CHEST_LIMIT, rollAncientChestLoot } from './_chest.js';

const cleanId = (value: unknown) => {
    const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9_-]{8,96}$/.test(id) ? id : '';
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const requestId = cleanId(body.requestId);
        if (!playerName || !requestId) return res.status(400).json({ error: 'Invalid player or request id.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your chest.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'world-open-chest', 30, 60_000, identity.name))) return;
        const today = new Date().toISOString().slice(0, 10);
        const result = await mutatePlayerSave(playerName, ({ character }) => {
            const receipts = Array.isArray(character.redeemedAncientChests)
                ? (character.redeemedAncientChests as Array<Record<string, unknown>>).filter((entry) => entry && typeof entry.id === 'string') : [];
            const prior = receipts.find((entry) => entry.id === requestId);
            if (prior) return { ok: true as const, character, value: { loot: prior.loot, replayed: true } };
            const storedDate = typeof character.serverChestDate === 'string' ? character.serverChestDate : '';
            const count = storedDate === today ? Math.max(0, Math.floor(Number(character.serverChestsToday) || 0)) : 0;
            if (count >= DAILY_ANCIENT_CHEST_LIMIT) return { ok: false as const, status: 409, error: 'daily-limit' };
            const loot = rollAncientChestLoot(body.sector, () => randomInt(1_000_000_000) / 1_000_000_000);
            if (!loot) return { ok: false as const, status: 400, error: 'invalid-sector' };
            const receipt = { id: requestId, sector: Math.floor(Number(body.sector)), loot, at: Date.now() };
            return { ok: true as const, character: {
                ...applyAncientChestLoot(character, loot), serverChestDate: today, serverChestsToday: count + 1,
                redeemedAncientChests: [...receipts.slice(-49), receipt],
            }, value: { loot, replayed: false } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        console.error('[world/open-chest]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
