"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _floor_catalog_js_1 = require("./_floor-catalog.js");
const _tower_session_js_1 = require("./_tower-session.js");
const _engine_js_1 = require("./_engine.js");
const _sim_js_1 = require("./_sim.js");
const _tower_store_js_1 = require("./_tower-store.js");
const _tower_mp_js_1 = require("./_tower-mp.js");
const _lock_js_1 = require("../_lock.js");
/*
 * POST /api/towers/action — submit ONE action for the human's actor on their turn.
 *
 * Server-authoritative: the move is validated by the engine against the tower:<runId>
 * record; the caller may only act for THEIR OWN squad actor on its turn. A 'wait' ends the
 * turn and advances all AI (allies + enemies) until the human is up again or the floor
 * resolves. Body: { runId, playerName, type, targetId?, tile?, jutsuId? }.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const runId = String(body.runId ?? '');
        if (!playerName || !runId)
            return res.status(400).json({ error: 'Missing player or run.' });
        if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'towers-action', 120, 60_000, playerName))
            return;
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        // Serialize the whole read-modify-write on the shared session so a concurrent
        // /state AFK-pass or /join can't clobber this turn write (lost-update / board
        // desync in a 2+ human run). Re-read INSIDE the lock so we mutate the freshest
        // session. No failClosed (no currency path); default fall-through mirrors
        // api/pvp/move.ts under sustained contention.
        const outcome = await (0, _lock_js_1.withKvLock)((0, _tower_store_js_1.sessionKey)(runId), async () => {
            const session = await (0, _tower_store_js_1.readSession)(runId);
            if (!session)
                return { status: 404, body: { error: 'Run not found.' } };
            if (session.status !== 'active')
                return { status: 200, body: { applied: false, reason: 'session-done', session } };
            const now = Date.now();
            // Co-op: clear any AFK player(s) blocking the queue before we read whose turn it is.
            const afkAdvanced = (0, _tower_mp_js_1.autoPassAfkHumans)(session, now);
            const actor = (0, _tower_session_js_1.activeActor)(session);
            const callerSlug = identity.admin ? null : identity.name;
            const owns = !!actor && (identity.admin || (actor.ai === false && actor.hp > 0 && actor.ownerSlug === callerSlug));
            if (!owns) {
                if (afkAdvanced)
                    await (0, _tower_store_js_1.writeSession)(session); // persist the AFK pass even if it's not our turn
                return { status: 409, body: { error: 'Not your turn.', session } };
            }
            const floor = (0, _floor_catalog_js_1.getFloor)(session.floor);
            if (!floor)
                return { status: 500, body: { error: 'Floor missing.' } };
            const rng = (0, _sim_js_1.makeRng)(session.seed);
            const type = String(body.type);
            // Build the action server-side with actorId = the verified active actor (no client spoof).
            const action = type === 'move' ? { actorId: actor.id, type: 'move', tile: Math.floor(Number(body.tile)) }
                : type === 'dash' ? { actorId: actor.id, type: 'dash', tile: Math.floor(Number(body.tile)) }
                    : type === 'attack' ? { actorId: actor.id, type: 'attack', targetId: String(body.targetId ?? '') }
                        : type === 'jutsu' ? { actorId: actor.id, type: 'jutsu', jutsuId: String(body.jutsuId ?? ''), targetId: body.targetId !== undefined ? String(body.targetId) : undefined, tile: body.tile !== undefined ? Math.floor(Number(body.tile)) : undefined }
                            : type === 'weapon' ? { actorId: actor.id, type: 'weapon', targetId: String(body.targetId ?? ''), itemId: body.itemId ? String(body.itemId) : undefined }
                                : type === 'item' ? { actorId: actor.id, type: 'item', itemId: body.itemId ? String(body.itemId) : undefined }
                                    : type === 'heal' ? { actorId: actor.id, type: 'heal' }
                                        : type === 'cleanse' ? { actorId: actor.id, type: 'cleanse' }
                                            : type === 'clear' ? { actorId: actor.id, type: 'clear', targetId: String(body.targetId ?? '') }
                                                : { actorId: actor.id, type: 'wait' };
            const result = (0, _engine_js_1.applyAction)(session, floor, action, rng);
            if (!result.applied) {
                return { status: 200, body: { applied: false, reason: result.reason, session } };
            }
            if (action.type === 'wait') {
                (0, _engine_js_1.endTurn)(session, floor);
                (0, _engine_js_1.runAiUntilHuman)(session, floor, rng); // run allies + enemies until the human is up / done
            }
            (0, _tower_mp_js_1.stampTurnClock)(session, now); // (re)start the AFK clock for whoever is up now
            await (0, _tower_store_js_1.writeSession)(session);
            return { status: 200, body: { applied: true, session } };
        });
        return res.status(outcome.status).json(outcome.body);
    }
    catch (err) {
        console.error('[towers/action]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
