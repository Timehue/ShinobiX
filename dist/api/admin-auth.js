"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("./_utils.js");
const _auth_js_1 = require("./_auth.js");
const _ratelimit_js_1 = require("./_ratelimit.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    // Brute-force protection: 20 attempts / 15 min per IP.
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'admin-auth', 20, 15 * 60_000))
        return;
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { password } = body;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
        return res.status(500).json({ success: false, error: 'ADMIN_PASSWORD not configured on server.' });
    }
    // Constant-time compare so attackers can't byte-leak via response timing.
    if (password && (0, _auth_js_1.safeEqual)(password, adminPassword)) {
        return res.status(200).json({ success: true });
    }
    return res.status(401).json({ success: false, error: 'Incorrect password.' });
}
