/**
 * Admin endpoint: backfill existing shared image bytes from Postgres into
 * Cloudflare R2 (Stage 3 — see docs/R2_IMAGE_MIGRATION_PLAN.md + api/_r2.ts).
 *
 * Walks every `shared:img:*` key, decodes the inline data-URL bytes, and PUTs
 * them to R2. Copy-only — it NEVER deletes the Postgres value, so the cutover
 * stays instantly reversible (unset R2_PUBLIC_BASE → reads fall back to Postgres).
 * Idempotent + resumable: re-run any time to catch stragglers; a live run's
 * `failed:0` is the green light to set R2_PUBLIC_BASE and switch reads to R2.
 *
 * External http(s)-URL images (no inline bytes) are counted as `skippedExternal`
 * — they have nothing to upload and keep serving via the Postgres redirect path.
 *
 * Usage:
 *   POST /api/admin/migrate-images-to-r2?dry=1  → dry run (counts, no writes)
 *   POST /api/admin/migrate-images-to-r2        → live copy to R2
 *   optional &limit=N to cap objects per call (resumable batching)
 *
 * Auth: full admin (x-admin-password === ADMIN_PASSWORD). Unlike the save
 * migration this needs NO write-freeze — images are add-only and the dual-write
 * on upload keeps new images current, so a live backfill can't lose data.
 */

import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { r2WriteEnabled, putImage, objectKeyForId } from '../_r2.js';
import { decodeBase64Image } from '../images.js';

const PER_IMAGE_PREFIX = 'shared:img:';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'POST only' });
        return;
    }
    if (!enforceRateLimit(req, res, 'admin-migrate-images-to-r2', 20, 60 * 60_000)) return;
    if (!isFullAdmin(req)) {
        res.status(401).json({ error: 'invalid admin password' });
        return;
    }
    const dryRun = req.query?.dry === '1' || req.query?.dry === 'true';
    if (!dryRun && !r2WriteEnabled()) {
        res.status(409).json({
            ok: false,
            error: 'R2 write creds not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET).',
        });
        return;
    }
    const rawLimit = Number(req.query?.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : Infinity;

    try {
        const result = await withKvLock(
            'admin:migrate-images-to-r2',
            async () => {
                const keys = await kv.keys(`${PER_IMAGE_PREFIX}*`);
                let uploaded = 0, failed = 0, skippedExternal = 0, skippedEmpty = 0, processed = 0;
                const failures: string[] = [];

                for (const key of keys) {
                    if (processed >= limit) break;
                    const id = key.slice(PER_IMAGE_PREFIX.length);
                    if (!id) { skippedEmpty++; continue; }
                    const value = await kv.get<string>(key);
                    if (!value) { skippedEmpty++; continue; }
                    const decoded = decodeBase64Image(value);
                    if (!decoded) { skippedExternal++; continue; } // external URL / not bytes
                    processed++;
                    if (dryRun) { uploaded++; continue; }
                    const ok = await putImage(id, decoded);
                    if (ok) uploaded++;
                    else { failed++; if (failures.length < 50) failures.push(id); }
                }

                return {
                    totalKeys: keys.length,
                    processed,
                    uploaded,
                    failed,
                    skippedExternal,
                    skippedEmpty,
                    failures,
                };
            },
            { failClosed: true, ttlSec: 60 * 60, maxAttempts: 1 },
        );

        res.status(200).json({
            ok: result.failed === 0,
            dryRun,
            sampleObjectKey: objectKeyForId('ai:example'),
            ...result,
        });
    } catch (err) {
        if (err instanceof LockContendedError) {
            res.status(409).json({ ok: false, error: 'Another image backfill is already running.' });
            return;
        }
        console.error('[admin/migrate-images-to-r2] failed:', err);
        res.status(500).json({ ok: false, error: 'Internal server error.' });
    }
}
