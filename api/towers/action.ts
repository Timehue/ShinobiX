import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { getFloor } from './_floor-catalog.js';
import { activeActor } from './_tower-session.js';
import { applyAction, endTurn, runAiUntilHuman, type TowerAction } from './_engine.js';
import { makeRng } from './_sim.js';
import { readSession, writeSession } from './_tower-store.js';
import { autoPassAfkHumans, stampTurnClock } from './_tower-mp.js';

/*
 * POST /api/towers/action — submit ONE action for the human's actor on their turn.
 *
 * Server-authoritative: the move is validated by the engine against the tower:<runId>
 * record; the caller may only act for THEIR OWN squad actor on its turn. A 'wait' ends the
 * turn and advances all AI (allies + enemies) until the human is up again or the floor
 * resolves. Body: { runId, playerName, type, targetId?, tile?, jutsuId? }.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const runId = String(body.runId ?? '');
        if (!playerName || !runId) return res.status(400).json({ error: 'Missing player or run.' });
        if (!enforceRateLimit(req, res, 'towers-action', 120, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });

        const session = await readSession(runId);
        if (!session) return res.status(404).json({ error: 'Run not found.' });
        if (session.status !== 'active') return res.status(200).json({ applied: false, reason: 'session-done', session });

        const now = Date.now();
        // Co-op: clear any AFK player(s) blocking the queue before we read whose turn it is.
        const afkAdvanced = autoPassAfkHumans(session, now);

        const actor = activeActor(session);
        const callerSlug = identity.admin ? null : identity.name;
        const owns = !!actor && (identity.admin || (actor.ai === false && actor.hp > 0 && actor.ownerSlug === callerSlug));
        if (!owns) {
            if (afkAdvanced) await writeSession(session); // persist the AFK pass even if it's not our turn
            return res.status(409).json({ error: 'Not your turn.', session });
        }

        const floor = getFloor(session.floor);
        if (!floor) return res.status(500).json({ error: 'Floor missing.' });

        const rng = makeRng(session.seed);
        const type = String(body.type);
        // Build the action server-side with actorId = the verified active actor (no client spoof).
        const action: TowerAction =
            type === 'move' ? { actorId: actor.id, type: 'move', tile: Math.floor(Number(body.tile)) }
            : type === 'attack' ? { actorId: actor.id, type: 'attack', targetId: String(body.targetId ?? '') }
            : type === 'jutsu' ? { actorId: actor.id, type: 'jutsu', jutsuId: String(body.jutsuId ?? ''), targetId: String(body.targetId ?? '') }
            : type === 'weapon' ? { actorId: actor.id, type: 'weapon', targetId: String(body.targetId ?? ''), itemId: body.itemId ? String(body.itemId) : undefined }
            : type === 'item' ? { actorId: actor.id, type: 'item', itemId: body.itemId ? String(body.itemId) : undefined }
            : { actorId: actor.id, type: 'wait' };

        const result = applyAction(session, floor, action, rng);
        if (!result.applied) {
            return res.status(200).json({ applied: false, reason: result.reason, session });
        }
        if (action.type === 'wait') {
            endTurn(session, floor);
            runAiUntilHuman(session, floor, rng); // run allies + enemies until the human is up / done
        }
        stampTurnClock(session, now); // (re)start the AFK clock for whoever is up now
        await writeSession(session);
        return res.status(200).json({ applied: true, session });
    } catch (err) {
        console.error('[towers/action]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
