/**
 * Admin endpoint: copy disk-routed keys from the disk overlay (cPanel proxy /
 * local disk) INTO the base backend (Supabase / Postgres). This is the reverse
 * of /api/admin/migrate-kv and exists to RETIRE the overlay (Option B in
 * docs/RETIRE_CPANEL_RUNBOOK.md): move save:* / shared:images* / shared:imgfields*
 * into Postgres so cPanel can be decommissioned.
 *
 * Routed prefixes (see _DISK_PREFIXES in _storage.ts):
 *   - save:*
 *   - shared:images*
 *   - shared:imgfields*
 *
 * Usage:
 *   POST /api/admin/migrate-to-base?dry=1  → dry run, reports what WOULD copy
 *   POST /api/admin/migrate-to-base        → live copy (upsert base + verify)
 *
 * SAFETY: never deletes the overlay. Re-pointing to it is reversible only while
 * all writers remain stopped; after base-store traffic resumes, the retained
 * overlay is a stale rollback source and must not be selected blindly. The copy
 * is idempotent, but a changing source invalidates its verification evidence. A
 * live run requires KV_MIGRATION_WRITE_FROZEN=1, set only after every overlay
 * writer has been independently stopped and verified. MAINTENANCE_MODE alone is
 * not a write fence. `ok:true` with mismatches:[] means every key was
 * copied and byte-verified in the base store — only then is it safe to flip the
 * env off the overlay.
 *
 * Auth: full admin (Admin 1) — x-admin-password === process.env.ADMIN_PASSWORD.
 */

import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { copyDiskRoutedKeysToBase } from '../_storage.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { migrationSourceWritersStopped } from './_migration-write-fence.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'POST only' });
        return;
    }
    if (!enforceRateLimit(req, res, 'admin-migrate-to-base', 10, 60 * 60_000)) return;
    if (!isFullAdmin(req)) {
        res.status(401).json({ error: 'invalid admin password' });
        return;
    }
    const dryRun = req.query?.dry === '1' || req.query?.dry === 'true';
    // Explicit operator acknowledgement only. It is set after independently
    // stopping request, GET-side-effect, scheduled, realtime, and other source
    // writers; neither this flag nor MAINTENANCE_MODE performs that work itself.
    if (!dryRun && !migrationSourceWritersStopped()) {
        res.status(409).json({
            ok: false,
            error: 'Live copy requires KV_MIGRATION_WRITE_FROZEN=1 after every overlay writer has been independently stopped and verified. MAINTENANCE_MODE alone only pauses Express player API traffic.',
        });
        return;
    }
    try {
        const result = await withKvLock(
            'admin:migrate-to-base',
            () => copyDiskRoutedKeysToBase({ dryRun }),
            { failClosed: true, ttlSec: 60 * 60, maxAttempts: 1 },
        );
        // Report counts (not the full copied key list, which is one entry per
        // player). Mismatches ARE returned in full — they must be zero to cut
        // over, and the operator needs the exact keys to reconcile if not.
        res.status(200).json({
            ok: result.mismatches.length === 0,
            dryRun,
            sourceCount: result.sourceCount,
            copied: result.copied,
            verified: result.verified,
            skipped: result.skipped,
            mismatchCount: result.mismatches.length,
            mismatches: result.mismatches,
        });
    } catch (err) {
        if (err instanceof LockContendedError) {
            res.status(409).json({ ok: false, error: 'Another migration is already running.' });
            return;
        }
        console.error('[admin/migrate-to-base] failed:', err);
        res.status(500).json({ ok: false, error: 'Internal server error.' });
    }
}
