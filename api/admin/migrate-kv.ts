/**
 * Admin endpoint: migrate disk-routed keys from the base backend (Supabase /
 * Postgres) to the disk overlay (cPanel disk or remote proxy).
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

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { migrateDiskRoutedKeysToOverlay } from '../_storage.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';

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
    try {
        const result = await migrateDiskRoutedKeysToOverlay({ dryRun });
        res.status(200).json({
            ok: true,
            dryRun,
            migratedCount: result.migrated.length,
            skippedCount: result.skipped.length,
            deletedFromBase: result.deleted,
            migrated: result.migrated,
            skipped: result.skipped,
        });
    } catch (err) {
        console.error('[admin/migrate-kv] failed:', err);
        res.status(500).json({ ok: false, error: 'Internal server error.' });
    }
}
