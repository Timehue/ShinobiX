"use strict";
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
 * SAFETY: never deletes the overlay, so the cutover stays instantly reversible
 * (re-point KV_PROXY_URL and redeploy). Idempotent — safe to re-run to catch a
 * straggler written between the first pass and the env flip. A live run requires
 * KV_MIGRATION_WRITE_FROZEN=1 (set it AFTER enabling MAINTENANCE_MODE=1 so no
 * save is written mid-copy). `ok:true` with mismatches:[] means every key was
 * copied and byte-verified in the base store — only then is it safe to flip the
 * env off the overlay.
 *
 * Auth: full admin (Admin 1) — x-admin-password === process.env.ADMIN_PASSWORD.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'POST only' });
        return;
    }
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'admin-migrate-to-base', 10, 60 * 60_000))
        return;
    if (!(0, _auth_js_1.isFullAdmin)(req)) {
        res.status(401).json({ error: 'invalid admin password' });
        return;
    }
    const dryRun = req.query?.dry === '1' || req.query?.dry === 'true';
    if (!dryRun && process.env.KV_MIGRATION_WRITE_FROZEN !== '1') {
        res.status(409).json({
            ok: false,
            error: 'Live copy requires KV_MIGRATION_WRITE_FROZEN=1 (freeze save writes first — set MAINTENANCE_MODE=1 then this flag).',
        });
        return;
    }
    try {
        const result = await (0, _lock_js_1.withKvLock)('admin:migrate-to-base', () => (0, _storage_js_1.copyDiskRoutedKeysToBase)({ dryRun }), { failClosed: true, ttlSec: 60 * 60, maxAttempts: 1 });
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
    }
    catch (err) {
        if (err instanceof _lock_js_1.LockContendedError) {
            res.status(409).json({ ok: false, error: 'Another migration is already running.' });
            return;
        }
        console.error('[admin/migrate-to-base] failed:', err);
        res.status(500).json({ ok: false, error: 'Internal server error.' });
    }
}
