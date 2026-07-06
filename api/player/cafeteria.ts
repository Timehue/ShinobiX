import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { onlineStore } from '../_realtime/online-store.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { applyCafeteriaMeal, cafeteriaMeal } from './_cafeteria.js';

/*
 * /api/player/cafeteria - POST
 *
 * Server-side cafeteria meals. The client no longer edits ryo/vitals directly;
 * the server checks balance, blocks active battles, applies the meal under the
 * save lock, and returns the updated character snapshot.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const meal = cafeteriaMeal(body.mealId);
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });
        if (!meal) return res.status(400).json({ error: 'Unknown cafeteria meal.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'You can only buy meals for your own account.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'player-cafeteria', 30, 60_000, identity.name))) return;

        if (!identity.admin && onlineStore.get(playerName)?.inBattle) {
            return res.status(409).json({ error: 'Cannot eat while in an active battle.' });
        }
        if (!identity.admin && await kv.get(`battle-lock:${playerName}`)) {
            return res.status(409).json({ error: 'Resolve your active battle before eating.' });
        }

        const out = await mutatePlayerSave(playerName, ({ character }) => {
            const applied = applyCafeteriaMeal(character, meal);
            if (!applied.ok) return { ok: false, status: 400, error: applied.error };
            return { ok: true, character: applied.character, value: { meal } };
        });

        if (!out.ok) return res.status(out.status).json({ error: out.error });
        return res.status(200).json({ ok: true, meal, character: out.character, _saveVersion: out._saveVersion });
    } catch (err) {
        console.error('[player/cafeteria]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
