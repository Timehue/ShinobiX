"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _audit_js_1 = require("../_audit.js");
// Admin-only audit-log reader (Priority 8).
//
// Surfaces the per-domain action audit (`audit:<domain>`) recorded by content
// edits, reward settlements, and sector changes — the trail these areas
// previously lacked (only moderation + territory were logged before). Read-only.
//
//   GET /api/admin/audit-log?domain=content&limit=200   (x-admin-password header)
//   → 200 { domain, count, entries }
const DOMAINS = ['content', 'reward', 'sector', 'combat'];
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST')
        return res.status(405).end();
    if (!(0, _auth_js_1.isAdmin)(req))
        return res.status(403).json({ error: 'Admin access required.' });
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'admin-audit-log', 60, 60_000))
        return;
    const body = typeof req.body === 'string'
        ? (() => { try {
            return JSON.parse(req.body);
        }
        catch {
            return {};
        } })()
        : (req.body ?? {});
    const requested = String(req.query?.domain ?? body?.domain ?? 'content');
    const domain = DOMAINS.includes(requested) ? requested : 'content';
    const limit = Math.max(1, Math.min(Number(req.query?.limit ?? body?.limit ?? 200) || 200, 5000));
    const entries = await (0, _audit_js_1.readAudit)(domain, limit);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ domain, count: entries.length, entries });
}
