import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { onlineStore } from '../_realtime/online-store.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { applyCafeteriaMeal, cafeteriaMeal, cookRecipe, applyCookRecipe } from './_cafeteria.js';
import { villageStoresEnabled } from '../_release-flags.js';

/*
 * /api/player/cafeteria - POST
 *
 * Server-side cafeteria meals. The client no longer edits ryo/vitals directly;
 * the server checks balance, blocks active battles, applies the meal under the
 * save lock, and returns the updated character snapshot.
 *
 * Village Stores COOK path — body { playerName, recipeId } (instead of mealId):
 * consumes ryo + 1 hunt material, mints ration-pack stacks (40 rations/day per
 * player), response { ok, cooked, dailyCooked, dailyCap, character, _saveVersion }.
 * 404 when the stores kill switch is set.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const cooking = body.recipeId !== undefined;
        const recipe = cooking ? cookRecipe(body.recipeId) : null;
        const meal = cooking ? null : cafeteriaMeal(body.mealId);
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });
        if (cooking && !villageStoresEnabled()) return res.status(404).json({ error: 'Not found.' });
        if (cooking && !recipe) return res.status(400).json({ error: 'Unknown cook recipe.' });
        if (!cooking && !meal) return res.status(400).json({ error: 'Unknown cafeteria meal.' });

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

        if (recipe) {
            const cooked = await mutatePlayerSave(playerName, ({ character }) => {
                const applied = applyCookRecipe(character, recipe);
                if (!applied.ok) return { ok: false, status: 400, error: applied.error };
                return { ok: true, character: applied.character, value: { cooked: applied.cooked, dailyCooked: applied.dailyCooked, dailyCap: applied.dailyCap } };
            });
            if (!cooked.ok) return res.status(cooked.status).json({ error: cooked.error });
            return res.status(200).json({ ok: true, recipe: recipe.id, ...cooked.value, character: cooked.character, _saveVersion: cooked._saveVersion });
        }

        const out = await mutatePlayerSave(playerName, ({ character }) => {
            const applied = applyCafeteriaMeal(character, meal!);
            if (!applied.ok) return { ok: false, status: 400, error: applied.error };
            return { ok: true, character: applied.character, value: { meal } };
        });

        if (!out.ok) return res.status(out.status).json({ error: out.error });
        return res.status(200).json({ ok: true, meal, character: out.character, _saveVersion: out._saveVersion });
    } catch (err) {
        console.error('[player/cafeteria]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
