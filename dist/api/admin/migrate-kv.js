"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'POST only' });
        return;
    }
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'admin-migrate-kv', 10, 60 * 60_000))
        return;
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) {
        res.status(500).json({ error: 'ADMIN_PASSWORD not configured.' });
        return;
    }
    const providedRaw = req.headers['x-admin-password'];
    const provided = Array.isArray(providedRaw) ? providedRaw[0] : providedRaw;
    if (!provided || !(0, _auth_js_1.safeEqual)(provided, expected)) {
        res.status(401).json({ error: 'invalid admin password' });
        return;
    }
    const dryRun = req.query?.dry === '1' || req.query?.dry === 'true';
    try {
        const result = await (0, _storage_js_1.migrateDiskRoutedKeysToOverlay)({ dryRun });
        res.status(200).json({
            ok: true,
            dryRun,
            migratedCount: result.migrated.length,
            skippedCount: result.skipped.length,
            deletedFromBase: result.deleted,
            migrated: result.migrated,
            skipped: result.skipped,
        });
    }
    catch (err) {
        console.error('[admin/migrate-kv] failed:', err);
        res.status(500).json({ ok: false, error: String(err) });
    }
}
