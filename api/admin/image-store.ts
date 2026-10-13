/**
 * Admin endpoint: the shared image store's tools (api/_image-store.ts), one
 * category per call. See docs/SHARED_HASH_ROW_SPLIT_PLAN.md.
 *
 * Usage:
 *   POST /api/admin/image-store?cat=<category>
 *        The read-only audit: per-image rows compared with the frozen legacy
 *        rows. It writes nothing: no image row, no lock row and no counter.
 *   POST /api/admin/image-store?cat=<category>&mode=write-back&confirm=<category>
 *        The rollback (plan §3.8): copies every image the legacy hash lacks into
 *        it, in ONE write. Turn on IMAGE_LEGACY_HASH_WRITE=1 first. `confirm`
 *        must repeat the category, because this rewrites a multi-MB row.
 *
 * One call runs at a time. The guard is an in-process flag rather than a KV
 * lock, since Railway runs one replica and the audit must write nothing. The
 * rate limit is the in-memory one. A second call while one runs gets 409, so
 * two clicks cannot double the load.
 *
 * Auth: full admin (x-admin-password === ADMIN_PASSWORD, or a full admin token).
 */

import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { KNOWN_PREFIXES, buildLegacyManifestIds, isManifestCategory } from '../images.js';
import { auditImageCategory, ManifestUnavailableForAuditError, writeBackImageCategory } from '../_image-store.js';

const CATEGORIES = [...new Set([...Object.values(KNOWN_PREFIXES), 'misc'])].sort();

let running = false;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'POST only' });
        return;
    }
    if (!enforceRateLimit(req, res, 'admin-image-store', 30, 60 * 60_000)) return;
    if (!isFullAdmin(req)) {
        res.status(401).json({ error: 'invalid admin password' });
        return;
    }
    const cat = typeof req.query?.cat === 'string' ? req.query.cat.trim() : '';
    if (!isManifestCategory(cat)) {
        res.status(400).json({ error: `Unknown image category. Use one of: ${CATEGORIES.join(', ')}.` });
        return;
    }
    const mode = typeof req.query?.mode === 'string' ? req.query.mode.trim() : 'dry-run';
    if (mode !== 'dry-run' && mode !== 'write-back') {
        res.status(400).json({ error: 'Unknown mode. Use dry-run (the default) or write-back.' });
        return;
    }
    if (mode === 'write-back' && req.query?.confirm !== cat) {
        res.status(400).json({ error: `write-back rewrites the ${cat} hash: pass confirm=${cat} to run it.` });
        return;
    }
    if (running) {
        res.status(409).json({ ok: false, error: 'Another image-store call is already running.' });
        return;
    }

    running = true;
    try {
        if (mode === 'write-back') {
            const result = await writeBackImageCategory(cat, { store: kv });
            res.status(200).json({ ok: true, mode, ...result });
            return;
        }
        const report = await auditImageCategory(cat, {
            store: kv,
            // The legacy rows alone: what the manifest listed before the split.
            todayManifest: (category) => buildLegacyManifestIds(category, <T,>(read: Promise<T | null>) => read),
        });
        res.status(200).json({ ok: true, mode, ...report });
    } catch (err) {
        if (err instanceof ManifestUnavailableForAuditError) {
            res.status(503).json({ ok: false, error: 'The image index could not be read. Retry in a moment.' });
            return;
        }
        console.error(`[admin/image-store] ${mode} failed:`, err);
        res.status(500).json({ ok: false, error: 'Internal server error.' });
    } finally {
        running = false;
    }
}
