"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const APPROVED_ITEMS_KEY = 'admin:approvedItems';
async function loadApprovedItems() {
    const approved = await _storage_js_1.kv.get(APPROVED_ITEMS_KEY);
    return Array.isArray(approved) ? approved : [];
}
async function saveApprovedItems(ids) {
    await _storage_js_1.kv.set(APPROVED_ITEMS_KEY, Array.from(new Set(ids)));
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method === 'GET') {
        try {
            const approved = await loadApprovedItems();
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ approvedItems: approved });
        }
        catch (err) {
            console.error('[admin/item-review GET]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    if (req.method === 'POST') {
        if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'admin-item-review', 60, 5 * 60_000))
            return;
        // Admin password via header (was body). See players.ts.
        if (!(0, _auth_js_1.isAdmin)(req)) {
            return res.status(401).json({ error: 'Unauthorized.' });
        }
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { action, itemId } = body;
            if (!itemId || (action !== 'approve' && action !== 'hide')) {
                return res.status(400).json({ error: 'Missing action or itemId.' });
            }
            const approved = await loadApprovedItems();
            const next = Array.from(new Set([...approved, itemId]));
            await saveApprovedItems(next);
            return res.status(200).json({ ok: true, approvedItems: next });
        }
        catch (err) {
            console.error('[admin/item-review POST]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    return res.status(405).end();
}
