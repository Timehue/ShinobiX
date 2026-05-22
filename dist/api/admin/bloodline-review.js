"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const APPROVED_BLOODLINES_KEY = 'admin:approvedBloodlines';
async function loadApprovedBloodlines() {
    const approved = await _storage_js_1.kv.get(APPROVED_BLOODLINES_KEY);
    return Array.isArray(approved) ? approved : [];
}
async function saveApprovedBloodlines(ids) {
    await _storage_js_1.kv.set(APPROVED_BLOODLINES_KEY, Array.from(new Set(ids)));
}
function reviewKey(ownerKey, bloodlineId) {
    return `${ownerKey || 'admin'}:${bloodlineId}`;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { password, action, ownerKey, bloodlineId, bloodline } = body;
        const adminPassword = process.env.ADMIN_PASSWORD;
        if (!adminPassword || password !== adminPassword) {
            return res.status(401).json({ error: 'Unauthorized.' });
        }
        if (!bloodlineId || (action !== 'approve' && action !== 'delete' && action !== 'update')) {
            return res.status(400).json({ error: 'Missing action or bloodlineId.' });
        }
        const cleanOwnerKey = (0, _utils_js_1.safeName)(ownerKey ?? '');
        const key = reviewKey(cleanOwnerKey || 'admin', bloodlineId);
        const approved = await loadApprovedBloodlines();
        if ((action === 'delete' || action === 'update') && cleanOwnerKey && cleanOwnerKey !== 'admin' && !cleanOwnerKey.startsWith('admin')) {
            const saveKey = `save:${cleanOwnerKey}`;
            const adminLockKey = `admin-lock:${cleanOwnerKey}`;
            const resetSignalKey = `reset-signal:${cleanOwnerKey}`;
            const snap = await _storage_js_1.kv.get(saveKey);
            if (snap) {
                const rawBloodlines = Array.isArray(snap.savedBloodlines) ? snap.savedBloodlines : [];
                const nextBloodlines = action === 'delete'
                    ? rawBloodlines.filter((savedBloodline) => {
                        return !(savedBloodline && typeof savedBloodline === 'object' && String(savedBloodline.id ?? '') === bloodlineId);
                    })
                    : rawBloodlines.map((savedBloodline) => {
                        if (!(savedBloodline && typeof savedBloodline === 'object' && String(savedBloodline.id ?? '') === bloodlineId))
                            return savedBloodline;
                        return { ...savedBloodline, ...bloodline, id: bloodlineId };
                    });
                await Promise.all([
                    _storage_js_1.kv.set(adminLockKey, 1, { ex: 300 }),
                    _storage_js_1.kv.set(saveKey, { ...snap, savedBloodlines: nextBloodlines }),
                    _storage_js_1.kv.set(resetSignalKey, 1, { ex: 300 }),
                ]);
            }
        }
        const nextApproved = action === 'update' ? approved : Array.from(new Set([...approved, key]));
        await saveApprovedBloodlines(nextApproved);
        return res.status(200).json({ ok: true, approvedBloodlines: nextApproved });
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
