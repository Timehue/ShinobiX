import { safeLogValue } from '../_safe-log.js';
import type { ApiRequest, ApiResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { LockContendedError } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { SaveDebitRefusal } from '../_save-debit-saga.js';
import { isPlayerSaveVersionConflict } from '../save/_projected-write.js';
import { dressCoastHall, COAST_LANDING_MATERIAL_NAMES, buildCoastLandingWorkFor, contributeToCoastLanding, coastLandingView, foundCoastLanding, raiseCoastLanding } from './_landing.js';
import { COAST_LANDING, COAST_LANDING_MATERIALS, COAST_LANDING_TIERS } from './_landing-rules.js';
import { enterCoastTown, inCoastTown, leaveCoastTown } from './_town-presence.js';

/*
 * /api/coast/landing: POST { action, itemId?, count?, requestId? }
 *
 * A clan's Landing on the sector it holds (see _landing.ts).
 *
 *   status                               -> { ok, rules, clan, holds, landing, canFound, fallen }
 *   found                                -> { ok, landing }   an officer stakes the plot
 *   contribute { itemId, count, requestId } -> { ok, landing, character, _saveVersion }
 *   raise                                -> { ok, landing }   an officer, when the stores cover it
 *   build { workId }                     -> { ok, landing }   an officer who has finished the work's quest
 *   town-enter                           -> { ok, sector, town }   a member standing in the sector walks into the
 *                                           clan's town: a safe zone while they stay (see _town-presence.ts)
 *   town-leave                           -> { ok }            and walks back out onto the sector
 *
 * `inTown` in the status reply says whether the server holds this player as inside the town.
 *
 * `landing.works` in the status reply lists every work with its cost, whether
 * it is built, what blocks it (`block`) and whether this player can build it.
 *
 * The caller is the signed-in player; no action takes a player or clan name.
 * A contribution moves materials out of the player's save, so it carries a
 * request id and can be retried safely.
 */

const ACTIONS = new Set(['status', 'hall-style', 'found', 'contribute', 'raise', 'build', 'town-enter', 'town-leave']);

export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';
        if (!ACTIONS.has(action)) return res.status(400).json({ error: 'Unknown action.' });
        const identity = await authedPlayerOrAdmin(req);
        if (!identity || identity.admin) return res.status(401).json({ error: 'Player authentication required.' });
        if (!(await enforceRateLimitKv(req, res, `coast-landing-${action}`, action === 'status' ? 30 : 12, 60_000, identity.name))) return;

        if (action === 'status') {
            return res.status(200).json({
                ok: true,
                rules: {
                    tiers: COAST_LANDING_TIERS, materials: COAST_LANDING_MATERIALS, materialNames: COAST_LANDING_MATERIAL_NAMES,
                    memberWeeklyCap: COAST_LANDING.memberWeeklyCap, perContribution: COAST_LANDING.perContribution,
                },
                ...(await coastLandingView(identity.name)),
                inTown: inCoastTown(identity.name),
            });
        }
        if (action === 'town-leave') {
            leaveCoastTown(identity.name);
            return res.status(200).json({ ok: true });
        }
        if (action === 'town-enter') {
            const entered = await enterCoastTown(identity.name);
            if (!entered.ok) return res.status(entered.status).json({ error: entered.error });
            return res.status(200).json(entered);
        }
        if (action === 'contribute') {
            const settled = await contributeToCoastLanding({ playerName: identity.name, itemId: body.itemId, count: body.count, requestId: body.requestId });
            return res.status(200).json({ ok: true, ...settled });
        }
        const result = action === 'found' ? await foundCoastLanding({ playerName: identity.name, hallStyle: body.hallStyle })
            : action === 'hall-style' ? await dressCoastHall(identity.name, body.hallStyle)
            : action === 'build' ? await buildCoastLandingWorkFor({ playerName: identity.name, workId: body.workId })
                : await raiseCoastLanding({ playerName: identity.name });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json(result);
    } catch (err) {
        if (err instanceof SaveDebitRefusal) return res.status(err.status).json({ error: err.message, ...err.details });
        if (err instanceof LockContendedError || isPlayerSaveVersionConflict(err)) return res.status(503).json({ error: 'The Landing is busy. Please retry.' });
        console.error('[coast/landing]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
