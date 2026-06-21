"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _tower_store_js_1 = require("./_tower-store.js");
const _seal_js_1 = require("./_seal.js");
const _lock_js_1 = require("../_lock.js");
/*
 * POST /api/towers/join — a squad member (esp. a borrowed/invited ally) supplies their
 * client-computed loadout extras (pvpItems + equipment passives the SAVE doesn't persist) so
 * their LIVE fighter is fully equipped, exactly like the host's at /start. It merges ONLY the
 * clamped loadout fields onto the caller's OWN squad actor — never the server-authoritative
 * stats / jutsu / vitals / itemCharges (those were sealed from the save at /start). Idempotent
 * (re-merging the same clamped values is a no-op in effect). Body: { runId, playerName, loadout }.
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
        if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'towers-join', 12, 60_000, playerName))
            return;
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Can only join as yourself.' });
        // Merge the caller's clamped loadout under the session lock so it can't clobber a
        // concurrent /action turn write or /state AFK-pass (re-read fresh inside).
        const outcome = await (0, _lock_js_1.withKvLock)((0, _tower_store_js_1.sessionKey)(runId), async () => {
            const session = await (0, _tower_store_js_1.readSession)(runId);
            if (!session)
                return { status: 404, body: { error: 'Run not found.' } };
            // Only the caller's own LIVE squad actor (membership = ownership).
            const myActor = session.actors.find(a => a.side === 'squad' && a.ownerSlug === playerName);
            if (!myActor)
                return { status: 403, body: { error: 'Not a member of this run.' } };
            if (session.status !== 'active')
                return { status: 200, body: { session } };
            const loadout = (body.loadout && typeof body.loadout === 'object') ? body.loadout : {};
            const clamped = (0, _seal_js_1.clampTowerLoadout)(loadout);
            if (Object.keys(clamped).length > 0) {
                Object.assign(myActor.character, clamped);
                await (0, _tower_store_js_1.writeSession)(session);
            }
            return { status: 200, body: { session } };
        });
        return res.status(outcome.status).json(outcome.body);
    }
    catch (err) {
        console.error('[towers/join]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
