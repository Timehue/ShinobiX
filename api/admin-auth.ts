import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from './_utils.js';
import { safeEqual } from './_auth.js';
import { enforceRateLimit } from './_ratelimit.js';

// Login endpoint for the admin panel.
//
// Two roles:
//   ADMIN_PASSWORD          → Admin 1 (full access — every tab, every endpoint)
//   ADMIN_CONTENT_PASSWORD  → Admin 2 (content-only — jutsu/bloodline, events,
//                             VNs, AI creator, pet editor, card editor,
//                             village leaders, professions tabs only)
//
// Returns { success, account, role } on match. Constant-time compares
// both candidates regardless of which one matches so timing doesn't leak
// "you tried the content password" vs "you tried the full password".
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Brute-force protection: 20 attempts / 15 min per IP.
    if (!enforceRateLimit(req, res, 'admin-auth', 20, 15 * 60_000)) return;

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { password } = body as { password?: string };

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
        return res.status(500).json({ success: false, error: 'ADMIN_PASSWORD not configured on server.' });
    }
    const adminContentPassword = process.env.ADMIN_CONTENT_PASSWORD;

    if (!password) {
        return res.status(401).json({ success: false, error: 'Incorrect password.' });
    }

    // Compare both — capture each result before deciding so the request
    // takes the same time regardless of which (or neither) matched.
    const matchFull = safeEqual(password, adminPassword);
    const matchContent = adminContentPassword ? safeEqual(password, adminContentPassword) : false;

    if (matchFull) {
        return res.status(200).json({ success: true, account: 'Admin 1', role: 'full' });
    }
    if (matchContent) {
        return res.status(200).json({ success: true, account: 'Admin 2', role: 'content' });
    }

    return res.status(401).json({ success: false, error: 'Incorrect password.' });
}
