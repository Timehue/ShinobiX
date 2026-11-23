import { safeLogValue } from '../_safe-log.js';
import type { ApiRequest, ApiResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { recordAudit } from '../_audit.js';
import { LockContendedError } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import {
    COAST_LAND, coastLandViews, declareCoastContest, isContestableCoastSector, readCoastClaim, readCoastContest, readCoastLandPause,
    releaseCoastClaim, setCoastClaimSchool, setCoastClaimWeather, settleCoastContest, withdrawCoastContest,
} from './_land.js';

/*
 * /api/coast/land: POST { action, sector? }
 *
 * Who holds each contestable sector of the Unmapped Coast, and a clan's way to
 * take one from the Unmoored (see _land.ts for the rules).
 *
 *   status                 -> { ok, rules, sectors }
 *   declare  { sector }    -> { ok, contest }      a clan's founder, leader or officer
 *   withdraw { sector }    -> { ok }               before the fighting opens
 *   terrain  { sector, terrainBuffStat } -> { ok, claim }
 *                                                  the holding clan's founder, leader or officer chooses the
 *                                                  school its members hit 10% harder with on that sector
 *   weather  { sector, weather } -> { ok, claim }  the same officers fix the sky over that sector, or pass
 *                                                  `scheduled` to hand it back to the coast's own weather
 *
 * Each sector in the status reply carries `sky`: the weather over it now, and whether its holder fixed it.
 *
 * Admin only, and written to the audit log:
 *   force-settle { sector } -> { ok, result }      ends a contest now, as its score stands
 *   release      { sector } -> { ok, released }    gives a sector back to the Unmoored
 *
 * The caller is the signed-in player; no action takes a player name. Garrison
 * wins are never reported here. They are counted from the fight's own
 * settlement (api/missions/report-ai-fight.ts).
 */

const ACTIONS = new Set(['status', 'declare', 'withdraw', 'terrain', 'weather', 'force-settle', 'release']);

export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';
        if (!ACTIONS.has(action)) return res.status(400).json({ error: 'Unknown action.' });
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `coast-land-${action}`, action === 'status' ? 30 : 6, 60_000, identity.name))) return;

        if (action === 'status') {
            return res.status(200).json({
                ok: true,
                rules: { noticeMs: COAST_LAND.noticeMs, windowMs: COAST_LAND.windowMs, minMembers: COAST_LAND.minMembers, target: COAST_LAND.target, perPlayerCap: COAST_LAND.perPlayerCap, declareScrolls: COAST_LAND.declareScrolls },
                sectors: await coastLandViews(Date.now()),
                // Set while an admin has the contests stopped (api/coast/admin.ts): nothing can be declared or fought.
                paused: !!(await readCoastLandPause()),
            });
        }

        const sector = Math.floor(Number(body.sector));
        if (!isContestableCoastSector(sector)) return res.status(400).json({ error: 'That ground cannot be held.' });

        if (action === 'force-settle' || action === 'release') {
            if (!identity.admin) return res.status(403).json({ error: 'Admin only.' });
            const before = { claim: await readCoastClaim(sector), contest: await readCoastContest(sector) };
            const outcome = action === 'force-settle'
                ? { result: await settleCoastContest(sector, Date.now(), { force: true }) }
                : { released: await releaseCoastClaim(sector) };
            await recordAudit({ actor: 'admin', domain: 'sector', action: `coast-land.${action}`, entityType: 'coast-sector', entityId: String(sector), before, after: outcome });
            return res.status(200).json({ ok: true, ...outcome });
        }

        if (identity.admin) return res.status(400).json({ error: 'A player declares or withdraws a contest, not an admin.' });
        const result = action === 'declare'
            ? await declareCoastContest({ playerName: identity.name, sector })
            : action === 'terrain'
                ? await setCoastClaimSchool({ playerName: identity.name, sector, terrainBuffStat: body.terrainBuffStat })
                : action === 'weather'
                    ? await setCoastClaimWeather({ playerName: identity.name, sector, weather: body.weather })
                    : await withdrawCoastContest({ playerName: identity.name, sector });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json(result);
    } catch (err) {
        if (err instanceof LockContendedError) return res.status(503).json({ error: 'The coast is busy. Please retry.' });
        console.error('[coast/land]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
