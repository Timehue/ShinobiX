"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const online_store_js_1 = require("../_realtime/online-store.js");
const _public_index_js_1 = require("./_public-index.js");
const _public_index_store_js_1 = require("./_public-index-store.js");
function parseLimit(value) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return 25;
    return Math.max(1, Math.min(Math.floor(n), 100));
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    try {
        const limit = parseLimit(req.query.limit);
        const onlineNames = new Set(online_store_js_1.onlineStore.list().map((entry) => entry.name));
        const { entries, backfilled, staleKeys } = await (0, _public_index_store_js_1.readPublicPlayerIndex)({ backfill: true, logContext: 'leaderboards' });
        const publicEntries = [...entries.entries()]
            .filter(([key, entry]) => (0, _public_index_js_1.isPublicPlayerIndexKey)(key) && (0, _public_index_js_1.isPublicPlayerIndexKey)(entry.name))
            .map(([, entry]) => entry);
        const boards = (0, _public_index_js_1.buildPublicLeaderboards)(publicEntries, onlineNames, limit);
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=10');
        return res.status(200).json({
            ok: true,
            generatedAt: Date.now(),
            limit,
            backfilled,
            stale: staleKeys.length,
            boards,
        });
    }
    catch (err) {
        console.error('[player-leaderboards]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
