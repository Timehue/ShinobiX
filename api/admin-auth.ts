import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from './_utils.js';
import { safeEqual } from './_auth.js';
import { enforceRateLimit } from './_ratelimit.js';

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

    // Constant-time compare so attackers can't byte-leak via response timing.
    if (password && safeEqual(password, adminPassword)) {
        return res.status(200).json({ success: true });
    }

    return res.status(401).json({ success: false, error: 'Incorrect password.' });
}
