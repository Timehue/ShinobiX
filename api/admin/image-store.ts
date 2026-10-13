/**
 * Admin endpoint: the read-only image-store audit (api/_image-store.ts), one
 * category per call. It is step 2 of docs/SHARED_HASH_ROW_SPLIT_PLAN.md: it
 * shows what listing ids from the per-image rows would change, before anything
 * changes.
 *
 * Usage:
 *   POST /api/admin/image-store?cat=<category>   → the dry-run report
 *
 * It writes nothing: no image row, no lock row and no counter. That is why the
 * one-at-a-time guard is an in-process flag rather than a KV lock (Railway runs
 * one replica), and why the rate limit is the in-memory one. A second call
 * while an audit runs gets 409, so two clicks cannot double the read load.
 *
 * Auth: full admin (x-admin-password === ADMIN_PASSWORD, or a full admin token).
 */

import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { KNOWN_PREFIXES, buildManifestIds, isManifestCategory } from '../images.js';
import { auditImageCategory, ManifestUnavailableForAuditError } from '../_image-store.js';

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
    if (mode !== 'dry-run') {
        res.status(400).json({ error: 'Only the read-only dry run exists in this release.' });
        return;
    }
    if (running) {
        res.status(409).json({ ok: false, error: 'Another image audit is already running.' });
        return;
    }

    running = true;
    try {
        const report = await auditImageCategory(cat, {
            store: kv,
            todayManifest: (category) => buildManifestIds(category, <T,>(read: Promise<T | null>) => read),
        });
        res.status(200).json({ ok: true, ...report });
    } catch (err) {
        if (err instanceof ManifestUnavailableForAuditError) {
            res.status(503).json({ ok: false, error: 'The image index could not be read. Retry in a moment.' });
            return;
        }
        console.error('[admin/image-store] audit failed:', err);
        res.status(500).json({ ok: false, error: 'Internal server error.' });
    } finally {
        running = false;
    }
}
