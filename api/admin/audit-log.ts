import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { isAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { readAudit, type AuditDomain } from '../_audit.js';

// Admin-only audit-log reader (Priority 8).
//
// Surfaces the per-domain action audit (`audit:<domain>`) recorded by content
// edits, reward settlements, and sector changes — the trail these areas
// previously lacked (only moderation + territory were logged before). Read-only.
//
//   GET /api/admin/audit-log?domain=content&limit=200   (x-admin-password header)
//   → 200 { domain, count, entries }
const DOMAINS: AuditDomain[] = ['content', 'reward', 'sector', 'combat'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-audit-log', 60, 60_000)) return;

    const body = typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
        : (req.body ?? {});
    const requested = String((req.query?.domain as string | undefined) ?? body?.domain ?? 'content');
    const domain: AuditDomain = (DOMAINS as string[]).includes(requested) ? (requested as AuditDomain) : 'content';
    const limit = Math.max(1, Math.min(Number(req.query?.limit ?? body?.limit ?? 200) || 200, 5000));

    const entries = await readAudit(domain, limit);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ domain, count: entries.length, entries });
}
