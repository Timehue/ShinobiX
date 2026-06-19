"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _tower_store_js_1 = require("./_tower-store.js");
/*
 * POST /api/towers/settle — pay out a cleared floor to every squad member.
 *
 * Fully server-authoritative + idempotent: settleFloorForMember / settleAssistForAlly each
 * re-verify the session (status 'done' + squad win), resolve the floor from the catalog by
 * id, compute the score, and credit at most once (NX receipts + the permanent first-clear
 * gate). Safe to call repeatedly. Live human members get the full first-clear reward;
 * borrowed AI allies get the capped, daily-bounded assist. Body: { runId, playerName }.
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
        if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'towers-settle', 30, 60_000, playerName))
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
        const results = {};
        for (const a of session.actors.filter(x => x.side === 'squad')) {
            const slug = a.ownerSlug;
            if (!slug)
                continue;
            results[slug] = a.ai
                ? await (0, _tower_store_js_1.settleAssistForAlly)({ session, slug })
                : await (0, _tower_store_js_1.settleFloorForMember)({ session, slug });
        }
        return res.status(200).json({ runId, winner: session.winner, results });
    }
    catch (err) {
        console.error('[towers/settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
