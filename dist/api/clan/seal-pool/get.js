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
    // Auth gate: previously anon-readable. The pool balance + recent
    // donation log (donor names + amounts + timestamps) is useful intel
    // for griefing campaigns. Any logged-in player can read; we don't
    // restrict to clan members because the in-game UI shows other clans'
    // pools in the Clan Hall comparison view.
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    try {
        const clanName = String(req.query.clanName ?? '').trim();
        if (!clanName)
            return res.status(400).json({ error: 'Missing clanName.' });
        const pool = await (0, _storage_js_1.loadPool)(clanName);
        return res.status(200).json({
            clanName: pool.clanName,
            balance: pool.balance,
            log: pool.log.slice(0, 20),
        });
    }
    catch (err) {
        console.error('[clan/seal-pool/get]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
