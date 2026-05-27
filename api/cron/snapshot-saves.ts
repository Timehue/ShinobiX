import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { isAdmin, safeEqual } from '../_auth.js';

/*
 * /api/cron/snapshot-saves  — daily auto-snapshot of every player save.
 *
 * The existing /api/admin/save-snapshot endpoint gives a MANUAL recovery
 * path: an admin can press "snapshot" for a specific player, or "restore"
 * a specific snapshot. That works for one-off support cases but doesn't
 * protect against an undetected wipe (player loses data and only notices
 * a week later, or a buggy admin tool quietly corrupts many saves at once).
 *
 * This cron fills that gap. Once per day Vercel invokes this endpoint;
 * it iterates every `save:*` row in KV and copies each one to a daily
 * snapshot key with a 90-day TTL. With the manual snapshots also under
 * the same prefix, the admin "list" + "restore" actions transparently
 * pick up the daily versions too — no UI change needed.
 *
 * Dedup: skip a player whose most-recent snapshot is younger than
 * SKIP_IF_RECENT_HOURS. Vercel cron firing at 03:00 UTC + a 20h skip
 * window means we get one snapshot per player per day regardless of
 * cron retries / accidental double-firings.
 *
 * Auth: Vercel sets the `x-vercel-cron` header (or sometimes
 * `Authorization: Bearer <CRON_SECRET>`) on cron invocations. We accept
 * either, plus an admin password fallback for manual ops triggering.
 *
 * Safety: snapshots are READ-ONLY copies — the live `save:<name>` row
 * is never written. If KV is read-only or partially down, the worst
 * outcome is a missed snapshot for some players (logged + reported in
 * the response). No player save can be corrupted by this endpoint.
 */

const SAVE_PREFIX = 'save:';
const SNAPSHOT_PREFIX = 'save-snapshot:';
const SNAPSHOT_TTL_SECONDS = 90 * 24 * 60 * 60;
const SKIP_IF_RECENT_MS = 20 * 60 * 60 * 1000;       // 20h — covers cron retries
const MAX_PARALLEL = 8;                              // throttle KV writes
const MAX_RUNTIME_MS = 25_000;                       // leave 5s headroom on a 30s fn

function snapshotKey(name: string, ts: number): string {
    return `${SNAPSHOT_PREFIX}${name}:${ts}`;
}

function isVercelCron(req: VercelRequest): boolean {
    if (req.headers['x-vercel-cron']) return true;
    const auth = req.headers.authorization;
    const secret = process.env.CRON_SECRET;
    if (auth && secret && auth.startsWith('Bearer ')) {
        return safeEqual(auth.slice('Bearer '.length), secret);
    }
    return false;
}

/**
 * Process snapshots in fixed-size parallel batches. Returns counts +
 * a list of player names that failed so the response surfaces partial
 * outages to whoever's looking.
 */
async function runBatches<T>(items: T[], worker: (item: T) => Promise<{ ok: boolean; skip?: boolean; err?: string }>, deadline: number) {
    let snapshotted = 0;
    let skipped = 0;
    const failed: string[] = [];
    let cursor = 0;

    while (cursor < items.length) {
        if (Date.now() > deadline) break;
        const slice = items.slice(cursor, cursor + MAX_PARALLEL);
        cursor += MAX_PARALLEL;
        const results = await Promise.all(slice.map(async (it) => {
            try {
                return await worker(it);
            } catch (err) {
                return { ok: false, err: err instanceof Error ? err.message : String(err) };
            }
        }));
        results.forEach((r, i) => {
            if (r.ok) snapshotted += 1;
            else if (r.skip) skipped += 1;
            else failed.push(String((slice[i] as unknown as string)));
        });
    }

    return { snapshotted, skipped, failed, processed: cursor, total: items.length };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

    // Allow Vercel cron OR an admin password (so ops can trigger manually
    // from the admin panel without exposing CRON_SECRET).
    if (!isVercelCron(req) && !isAdmin(req)) {
        return res.status(401).json({ error: 'Cron secret or admin password required.' });
    }

    const startedAt = Date.now();
    const deadline = startedAt + MAX_RUNTIME_MS;

    try {
        const saveKeys = await kv.keys(`${SAVE_PREFIX}*`);
        // Filter out admin saves — they don't represent player progress and
        // bloat the snapshot table. Admin accounts (`save:Admin*`, `save:Rill`)
        // store content authoring data which has its own backups.
        const playerSaveKeys = saveKeys.filter(k => {
            const name = k.slice(SAVE_PREFIX.length);
            return !name.startsWith('Admin ') && name !== 'Rill';
        });

        const result = await runBatches(playerSaveKeys, async (saveKey) => {
            const playerName = saveKey.slice(SAVE_PREFIX.length);

            // Dedup against existing snapshots: if the player has a snapshot
            // within the last SKIP_IF_RECENT_MS window, skip.
            const existing = await kv.keys(`${SNAPSHOT_PREFIX}${playerName}:*`);
            if (existing.length > 0) {
                const newest = existing
                    .map(k => Number(k.slice(`${SNAPSHOT_PREFIX}${playerName}:`.length)))
                    .filter(n => Number.isFinite(n))
                    .reduce((a, b) => Math.max(a, b), 0);
                if (newest > 0 && Date.now() - newest < SKIP_IF_RECENT_MS) {
                    return { ok: false, skip: true };
                }
            }

            const live = await kv.get<Record<string, unknown>>(saveKey);
            if (!live) return { ok: false, skip: true };

            const ts = Date.now();
            await kv.set(snapshotKey(playerName, ts), live, { ex: SNAPSHOT_TTL_SECONDS });
            return { ok: true };
        }, deadline);

        const elapsed = Date.now() - startedAt;
        const truncated = result.processed < result.total;
        return res.status(200).json({
            ok: true,
            ...result,
            elapsedMs: elapsed,
            truncated,
            note: truncated
                ? 'Hit runtime deadline before processing all players. The next cron firing will pick up the rest (dedup window prevents double-snapshots).'
                : undefined,
        });
    } catch (err) {
        console.error('[cron/snapshot-saves]', err);
        return res.status(500).json({ error: err instanceof Error ? err.message : 'Snapshot cron failed.' });
    }
}
