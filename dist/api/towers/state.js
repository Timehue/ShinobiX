"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _tower_store_js_1 = require("./_tower-store.js");
const _tower_mp_js_1 = require("./_tower-mp.js");
const _lock_js_1 = require("../_lock.js");
/*
 * GET /api/towers/state?runId=...&playerName=... — reconnect / poll the live session.
 *
 * Unlike the PvP spectator stream, tower state is gated to RUN MEMBERS (it carries live
 * co-op state) — a non-member / unauth caller gets 403. Never cached.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    try {
        const runId = String(req.query.runId ?? '');
        const playerName = (0, _utils_js_1.safeName)(String(req.query.playerName ?? ''));
        if (!runId || !playerName)
            return res.status(400).json({ error: 'Missing run or player.' });
        if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'towers-state', 240, 60_000, playerName))
            return;
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        const session = await (0, _tower_store_js_1.readSession)(runId);
        if (!session)
            return res.status(404).json({ error: 'Run not found.' });
        const callerSlug = identity.admin ? null : identity.name;
        const isMember = identity.admin || session.actors.some(a => a.side === 'squad' && a.ownerSlug === callerSlug);
        if (!isMember)
            return res.status(403).json({ error: 'Not a member of this run.' });
        // Co-op liveness: a poll auto-passes any AFK player blocking the queue, so a run
        // never stalls on someone who walked away. The local `session` reflects the pass
        // for THIS response; do the durable write under the session lock (re-reading fresh)
        // so it can't clobber a concurrent /action turn write. Only locks when it actually
        // advances, so ordinary polls stay lock-free.
        if ((0, _tower_mp_js_1.autoPassAfkHumans)(session, Date.now())) {
            await (0, _lock_js_1.withKvLock)((0, _tower_store_js_1.sessionKey)(runId), async () => {
                const fresh = await (0, _tower_store_js_1.readSession)(runId);
                if (fresh && fresh.status === 'active' && (0, _tower_mp_js_1.autoPassAfkHumans)(fresh, Date.now())) {
                    await (0, _tower_store_js_1.writeSession)(fresh);
                }
            }).catch(() => undefined);
        }
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ session });
    }
    catch (err) {
        console.error('[towers/state]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
