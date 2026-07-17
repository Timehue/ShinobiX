/**
 * Admin endpoint: migrate disk-routed keys from the base backend (Supabase /
 * Postgres) to the disk overlay (cPanel disk or remote proxy).
 *
 * ‼ POST-RETIREMENT WARNING (2026-07-17): the base Postgres store is now the
 * AUTHORITATIVE home of save:* — this endpoint MOVES saves off it (copy then
 * delete-from-base). With no overlay configured it throws before touching
 * data, so it is inert in the current topology; it exists solely as the
 * forward-reconcile step of the documented rollback
 * (docs/RETIRE_CPANEL_RUNBOOK.md). Do not run it outside that runbook.
 *
 * Routed prefixes (see _DISK_PREFIXES in _storage.ts):
 *   - save:*
 *   - shared:images*
 *   - shared:imgfields*
 *
 * Usage:
 *   POST /api/admin/migrate-kv         → live migration (moves data)
 *   POST /api/admin/migrate-kv?dry=1   → dry run, reports what would move
 *
 * Auth: x-admin-password header must match process.env.ADMIN_PASSWORD.
 */

import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { migrateDiskRoutedKeysToOverlay } from '../_storage.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'POST only' });
        return;
    }
    if (!enforceRateLimit(req, res, 'admin-migrate-kv', 10, 60 * 60_000)) return;
    // Full admin (Admin 1) only — destructive endpoint.
    if (!isFullAdmin(req)) {
        res.status(401).json({ error: 'invalid admin password' });
        return;
    }
    const dryRun = req.query?.dry === '1' || req.query?.dry === 'true';
    if (!dryRun && process.env.KV_MIGRATION_WRITE_FROZEN !== '1') {
        res.status(409).json({
            ok: false,
            error: 'Live migration requires KV_MIGRATION_WRITE_FROZEN=1 after legacy base writers are stopped.',
        });
        return;
    }
    try {
        const result = await withKvLock(
            'admin:migrate-kv',
            () => migrateDiskRoutedKeysToOverlay({ dryRun }),
            { failClosed: true, ttlSec: 60 * 60, maxAttempts: 1 },
        );
        res.status(200).json({
            ok: true,
            dryRun,
            migratedCount: result.migrated.length,
            alreadyPresentCount: result.alreadyPresent.length,
            conflictCount: result.conflicts.length,
            skippedCount: result.skipped.length,
            deletedFromBase: result.deleted,
            migrated: result.migrated,
            alreadyPresent: result.alreadyPresent,
            conflicts: result.conflicts,
            skipped: result.skipped,
        });
    } catch (err) {
        if (err instanceof LockContendedError) {
            res.status(409).json({ ok: false, error: 'Another migration is already running.' });
            return;
        }
        console.error('[admin/migrate-kv] failed:', err);
        res.status(500).json({ ok: false, error: 'Internal server error.' });
    }
}
