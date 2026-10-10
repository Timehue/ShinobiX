import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { safeLogValue } from '../_safe-log.js';
import { viewerVillageOf } from '../_viewer-village.js';
import { memberVillageStateView, villageStateKey } from '../_village-state-view.js';

/*
 * GET /api/village/state[?village=<name>] — a village's members-only record.
 *
 * Owner ruling 2026-10-08: a village's internals are for its members. The public
 * /api/game-state frame no longer carries them (api/_village-state-view.ts), so
 * the Town Hall and the World Map read their own village's treasury and Village
 * Stores, upgrades, contribution total, activity log, orders and daily agenda
 * here.
 *
 * A player reads their OWN village, as their save records it (never the
 * client-supplied presence row). Naming another village is refused, so a stale
 * or forged `village` never answers for the wrong one. An admin names the village.
 *
 *   200 { ok: true, village, state }          state = every member field, null where unset
 *   200 { ok: true, village: '', state: null } a player with no village
 *   400 admin without ?village · 401 · 403 another village · 405 · 429 · 500
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    // Per-viewer by construction, and Cloudflare caches some /api GETs: this
    // must never reach a shared cache, not even as a 401.
    res.setHeader('Cache-Control', 'private, no-store');

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-state', 30, 60_000, identity.name))) return;

    try {
        const asked = String(req.query?.village ?? '').trim();
        let village = asked;
        if (identity.admin) {
            if (!asked) return res.status(400).json({ error: 'Missing village.' });
        } else {
            village = await viewerVillageOf(identity.name);
            if (asked && villageStateKey(asked) !== villageStateKey(village)) {
                return res.status(403).json({ error: 'A village\'s records are for its own members.' });
            }
            if (!village) return res.status(200).json({ ok: true, village: '', state: null });
        }
        const row = await kv.get<Record<string, unknown>>(villageStateKey(village));
        return res.status(200).json({ ok: true, village, state: memberVillageStateView(row) });
    } catch (err) {
        console.error('[village/state]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
