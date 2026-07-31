import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { applySectorExploreReward } from './_explore.js';

function cleanRequestId(value: unknown): string {
    const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9_-]{8,96}$/.test(id) ? id : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const requestId = cleanRequestId(body.requestId);
        if (!playerName || !requestId) return res.status(400).json({ error: 'Invalid player or request id.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your exploration.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'world-explore', 180, 60_000, identity.name))) return;

        const today = new Date().toISOString().slice(0, 10);
        const result = await mutatePlayerSave(playerName, ({ character }) => {
            const receipts = Array.isArray(character.redeemedSectorExplorations)
                ? (character.redeemedSectorExplorations as Array<Record<string, unknown>>).filter((entry) => entry && typeof entry.id === 'string')
                : [];
            const prior = receipts.find((entry) => entry.id === requestId);
            if (prior) return { ok: true as const, character, value: { reward: prior.reward, replayed: true } };
            const credit = body.credit === 'tile' ? 'tile' as const : 'full' as const;
            const applied = applySectorExploreReward(character, body.sector, today, credit);
            if (!applied.ok) return { ok: false as const, status: 409, error: applied.reason };
            const receipt = { id: requestId, sector: applied.reward.sector, reward: applied.reward, at: Date.now() };
            return {
                ok: true as const,
                character: { ...applied.character, redeemedSectorExplorations: [...receipts.slice(-149), receipt] },
                value: { reward: applied.reward, replayed: false },
            };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        console.error('[world/explore]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
