"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../../_utils.js");
const _auth_js_1 = require("../../_auth.js");
const _storage_js_1 = require("./_storage.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    // Auth gate: previously anon-readable. Active escorter names + their
    // stamps leak presence intel. Any logged-in player can read; the
    // underlying _storage helper does best-effort stale-cleanup writes
    // so we also avoid anonymous write-induction.
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    try {
        const clanName = String(req.query.clanName ?? '').trim();
        if (!clanName)
            return res.status(400).json({ error: 'Missing clanName.' });
        const escorters = await (0, _storage_js_1.listActiveEscorters)(clanName);
        // 15s edge cache. List changes when a Pet Tamer toggles their
        // escort offer; minute-scale latency would be too laggy for
        // the UI but 15s is fine.
        res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
        return res.status(200).json({ clanName, escorters });
    }
    catch (err) {
        console.error('[clan/pet-escort/list]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
