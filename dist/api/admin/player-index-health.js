"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _public_index_js_1 = require("../player/_public-index.js");
const _public_index_store_js_1 = require("../player/_public-index-store.js");
function truthy(value) {
    return value === true || value === '1' || value === 'true' || value === 'yes';
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST')
        return res.status(405).end();
    if (!(0, _auth_js_1.isFullAdmin)(req))
        return res.status(403).json({ error: 'Full admin access required.' });
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'admin-player-index-health', 30, 60_000))
        return;
    try {
        const scanSaves = truthy(req.query.scan);
        const [{ rawRegistry, backfilled, staleKeys }, saveKeys] = await Promise.all([
            (0, _public_index_store_js_1.readPublicPlayerIndex)({ backfill: true, logContext: 'admin-player-index-health' }),
            scanSaves ? _storage_js_1.kv.keys('save:*') : Promise.resolve(undefined),
        ]);
        const health = (0, _public_index_js_1.summarizePublicIndexHealth)(rawRegistry, saveKeys, Date.now());
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            ok: true,
            backfilled,
            staleBeforeBackfill: staleKeys.length,
            health,
        });
    }
    catch (err) {
        console.error('[admin-player-index-health]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
