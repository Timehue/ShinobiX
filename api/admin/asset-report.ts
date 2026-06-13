import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { isAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { listAssetMeta, findDuplicates } from '../_asset-registry.js';

// Admin-only asset-registry report (Priority 6).
//
// Returns the metadata layer (`asset:meta:*`) the image system never had:
// per-asset type/format/size/hash/createdBy/hidden, a category histogram, and
// server-computed duplicates (assets sharing a content hash). The admin panel
// cross-references this against the in-memory catalogs + the existing
// `/api/images?cat=X&ids=1` manifest to surface missing / dead / unused /
// missing-metadata assets client-side. Read-only; mutates nothing.
//
//   GET /api/admin/asset-report   (x-admin-password header)
//   → 200 { total, byCategory, duplicates, hidden, assets }
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-asset-report', 30, 60_000)) return;

    const assets = await listAssetMeta();
    const byCategory: Record<string, number> = {};
    for (const a of assets) byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
        total: assets.length,
        byCategory,
        duplicates: findDuplicates(assets),
        hidden: assets.filter((a) => a.hidden).map((a) => a.id),
        // Full metadata list — small (no image bytes), ~150 B/record.
        assets,
    });
}
