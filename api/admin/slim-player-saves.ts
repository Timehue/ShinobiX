import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { cors } from '../_utils.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { ADMIN_ITEM_CATALOG_UNAVAILABLE } from '../_admin-item-catalog.js';
import { slimPlayerSaveRecord, slimPlayerSavesEnabled } from '../save/_slim-player-save.js';
import { checkSlimParity } from '../save/_slim-parity.js';

/*
 * /api/admin/slim-player-saves — POST (full admin)
 *
 * Verify, then apply, the slim-player-save migration (api/save/_slim-player-save.ts)
 * on stored saves. Active players are slimmed by their own next autosave (on by
 * default; SLIM_PLAYER_SAVES=0 is the kill switch); this covers dormant accounts
 * and PROVES, on the live rows, that the slim changes no fight.
 *
 * Body: { dryRun?: boolean = true, cursor?: number = 0, limit?: number = 25 (max 50) }
 *   - dryRun (default): read-only. For every save in the batch it runs the real
 *     fighter loaders on the original and the slimmed record (checkSlimParity)
 *     and reports any difference, plus the bytes the slim would save.
 *   - dryRun:false: refused while SLIM_PLAYER_SAVES=0. Re-reads each save under its
 *     lock, re-checks parity, and commits with compare-and-set, pausing between
 *     writes so the batch never floods the database. A save whose parity fails is
 *     NEVER written.
 * Call repeatedly with the returned nextCursor until it is null.
 */
const MAX_BATCH = 50;
const WRITE_PAUSE_MS = 250;
const ADMIN_SLOTS = new Set(['save:admin1', 'save:admin2']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isOrdinaryPlayerSaveKey(key: string): boolean {
    if (!key.startsWith('save:') || ADMIN_SLOTS.has(key)) return false;
    const name = key.slice('save:'.length);
    return Boolean(name) && !name.includes(':') && !name.startsWith('clan-');
}

function bytes(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value ?? null));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (!isFullAdmin(req)) return res.status(403).json({ error: 'Full admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-slim-player-saves', 30, 60_000)) return;

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const dryRun = body.dryRun !== false;
        const cursor = Math.max(0, Math.floor(Number(body.cursor) || 0));
        const limit = Math.min(MAX_BATCH, Math.max(1, Math.floor(Number(body.limit) || 25)));
        if (!dryRun && !slimPlayerSavesEnabled()) {
            return res.status(409).json({ error: 'Slim saves are switched off (SLIM_PLAYER_SAVES=0); remove that setting before writing.' });
        }

        const admin = await loadAdminCombatContent();
        const keys = (await kv.keys('save:*')).filter(isOrdinaryPlayerSaveKey).sort();
        const batch = keys.slice(cursor, cursor + limit);
        const report = {
            dryRun,
            totalSaves: keys.length,
            scanned: 0,
            unchanged: 0,
            slimmable: 0,
            written: 0,
            skippedBusy: 0,
            parityFailures: [] as Array<{ key: string; diffs: string[] }>,
            bytesBefore: 0,
            bytesAfter: 0,
        };

        for (const key of batch) {
            const record = await kv.get<Record<string, unknown>>(key);
            if (!record || typeof record !== 'object' || !record.character) continue;
            report.scanned += 1;
            const slim = slimPlayerSaveRecord(record);
            report.bytesBefore += bytes(record);
            report.bytesAfter += bytes(slim.record);
            if (!slim.changed) { report.unchanged += 1; continue; }
            const parity = await checkSlimParity(record, slim.record, admin);
            if (!parity.equal) {
                report.parityFailures.push({ key, diffs: parity.diffs.slice(0, 10) });
                continue;
            }
            report.slimmable += 1;
            if (dryRun) continue;

            const outcome = await withKvLock(key, async () => {
                const fresh = await kv.get<Record<string, unknown>>(key);
                if (!fresh || typeof fresh !== 'object' || !fresh.character) return 'gone' as const;
                const freshSlim = slimPlayerSaveRecord(fresh);
                if (!freshSlim.changed) return 'unchanged' as const;
                const freshParity = await checkSlimParity(fresh, freshSlim.record, admin);
                if (!freshParity.equal) return 'parity' as const;
                // The row's own `_saveVersion` is left alone: nothing a player
                // owns changed, so an open client must not be forced to refetch.
                return await kv.compareSet(key, fresh, freshSlim.record) ? 'written' as const : 'busy' as const;
            }, { failClosed: true }).catch(() => 'busy' as const);
            if (outcome === 'written') report.written += 1;
            else if (outcome === 'busy') report.skippedBusy += 1;
            else if (outcome === 'parity') report.parityFailures.push({ key, diffs: ['changed between scan and write; parity failed'] });
            await sleep(WRITE_PAUSE_MS);
        }

        const nextCursor = cursor + batch.length < keys.length ? cursor + batch.length : null;
        console.log('[admin/slim-player-saves]', JSON.stringify({ ...report, parityFailures: report.parityFailures.length, cursor, nextCursor }));
        return res.status(200).json({ ok: true, ...report, nextCursor });
    } catch (error) {
        if (error instanceof Error && error.message === ADMIN_ITEM_CATALOG_UNAVAILABLE) {
            return res.status(503).json({ error: 'The admin item catalog is unavailable; parity cannot be checked. Retry.' });
        }
        console.error('[admin/slim-player-saves]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
