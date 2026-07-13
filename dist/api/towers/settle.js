"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _storage_js_1 = require("../_storage.js");
const _tower_store_js_1 = require("./_tower-store.js");
/*
 * POST /api/towers/settle — finalize a completed tower run.
 *
 * Fully server-authoritative + idempotent: consumable/throwable spends are deducted once for
 * any done run, while settleFloorForMember / settleAssistForAlly each re-verify the session
 * (status 'done' + squad win), resolve the floor from the catalog by id, compute the score,
 * and credit at most once (NX receipts + the permanent first-clear gate). Safe to call
 * repeatedly. Body: { runId, playerName }.
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
        // Endless Spire runs settle through the weekly spire channel (best-tier-per-week); the
        // 10 story floors keep the one-time first-clear channel. All spire members are live humans.
        const spire = (0, _tower_store_js_1.isSpireRun)(session);
        const results = {};
        const consumables = {};
        for (const a of session.actors.filter(x => x.side === 'squad')) {
            const slug = a.ownerSlug;
            if (!slug)
                continue;
            (0, _utils_js_1.setSafeRecordValue)(consumables, slug, await (0, _tower_store_js_1.settleConsumedItemsForMember)({ session, slug }));
            (0, _utils_js_1.setSafeRecordValue)(results, slug, spire
                ? await (0, _tower_store_js_1.settleSpireForMember)({ session, slug })
                : a.ai
                    ? await (0, _tower_store_js_1.settleAssistForAlly)({ session, slug })
                    : await (0, _tower_store_js_1.settleFloorForMember)({ session, slug }));
        }
        // Return only the caller's committed character. The results map may cover
        // multiple squad members, but their private save data must not be exposed.
        const responseSlug = callerSlug ?? (0, _utils_js_1.safeName)(playerName);
        const committed = await _storage_js_1.kv.get(`save:${responseSlug}`);
        return res.status(200).json({
            runId,
            winner: session.winner,
            results,
            consumables,
            character: committed?.character ?? null,
            _saveVersion: Number(committed?._saveVersion ?? 0),
        });
    }
    catch (err) {
        console.error('[towers/settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
