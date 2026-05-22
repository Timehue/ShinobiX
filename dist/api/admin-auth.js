"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("./_utils.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { password } = body;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
        return res.status(500).json({ success: false, error: 'ADMIN_PASSWORD not configured on server.' });
    }
    if (password === adminPassword) {
        return res.status(200).json({ success: true });
    }
    return res.status(401).json({ success: false, error: 'Incorrect password.' });
}
