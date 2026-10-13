import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { jsonValueEqual, kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { isFullAdmin, safeEqual } from '../_auth.js';

/*
 * /api/cron/snapshot-saves  — daily auto-snapshot of every player save.
 *
 * The existing /api/admin/save-snapshot endpoint gives a MANUAL recovery
 * path: an admin can press "snapshot" for a specific player, or "restore"
 * a specific snapshot. That works for one-off support cases but doesn't
 * protect against an undetected wipe (player loses data and only notices
 * a week later, or a buggy admin tool quietly corrupts many saves at once).
 *
 * This cron fills that gap. Once per day the in-process scheduler
 * (`api/cron/_scheduler.ts`, started by the always-on server) runs this logic;
 * it iterates every `save:*` row in KV and copies each one to a daily
 * snapshot key with a 90-day TTL. With the manual snapshots also under
 * the same prefix, the admin "list" + "restore" actions transparently
 * pick up the daily versions too — no UI change needed.
 *
 * Dedup: skip a player whose most-recent snapshot is younger than
 * SKIP_IF_RECENT_MS. The 03:00 UTC firing + a 20h skip window means we get
 * one snapshot per player per day regardless of retries / double-firings.
 *
 * Auth: this endpoint stays mounted for manual/admin triggering and accepts
 * `Authorization: Bearer <CRON_SECRET>` — plus an admin password fallback.
 *
 * Safety: snapshots are READ-ONLY copies — the live `save:<name>` row
 * is never written. If KV is read-only or partially down, the worst
 * outcome is a missed snapshot for some players (logged + reported in
 * the response). No player save can be corrupted by this endpoint.
 */

const SAVE_PREFIX = 'save:';
const SNAPSHOT_PREFIX = 'save-snapshot:';
export const SNAPSHOT_SUCCESS_KEY = 'backup:save-snapshots:last-success';
const SNAPSHOT_TTL_SECONDS = 90 * 24 * 60 * 60;
const SNAPSHOT_SUCCESS_TTL_SECONDS = 180 * 24 * 60 * 60;
export const SNAPSHOT_FRESHNESS_MS = 26 * 60 * 60 * 1000;
const SKIP_IF_RECENT_MS = 20 * 60 * 60 * 1000;       // 20h — covers cron retries
/** When this process last renewed each player's newest snapshot (see the run loop). */
const renewedAt = new Map<string, number>();
/** Test-only. */
export function __resetSnapshotRenewalsForTest(): void { renewedAt.clear(); }
const MAX_PARALLEL = 8;                              // throttle KV writes
const MAX_RUNTIME_MS = 25_000;                       // leave 5s headroom on a 30s fn

function snapshotKey(name: string, ts: number): string {
    return `${SNAPSHOT_PREFIX}${name}:${ts}`;
}

/**
 * Bucket all snapshot keys (`save-snapshot:<name>:<ts>`) into the newest ts per
 * player, in a single pass. This replaces a per-player kv.keys() scan inside the
 * snapshot loop — an N+1 where every player triggered a full disk-overlay tree
 * walk on cPanel. Pure + exported for testing.
 *
 * The ts is the segment after the LAST ':' and the name is everything before it,
 * so a name that itself contains ':' buckets exactly as the old per-player
 * pattern (`save-snapshot:<name>:*`) did. Malformed keys (no name, no/NaN ts) are
 * ignored, matching the old Number.isFinite filter.
 */
export function newestSnapshotByPlayer(snapshotKeys: string[]): Map<string, number> {
    const newest = new Map<string, number>();
    for (const key of snapshotKeys) {
        if (!key.startsWith(SNAPSHOT_PREFIX)) continue;
        const rest = key.slice(SNAPSHOT_PREFIX.length);
        const lastColon = rest.lastIndexOf(':');
        if (lastColon < 1) continue;                       // need a non-empty name AND a ts segment
        const name = rest.slice(0, lastColon);
        const ts = Number(rest.slice(lastColon + 1));
        if (!Number.isFinite(ts) || ts <= 0) continue;
        if (ts > (newest.get(name) ?? 0)) newest.set(name, ts);
    }
    return newest;
}

export type SnapshotSuccessMarker = {
    completedAt: number;
    snapshotted: number;
    /** Saves not copied this run: already copied within 20h, or `unchanged`. */
    skipped: number;
    /** Of `skipped`: saves equal to their newest snapshot, whose TTL was renewed. Absent on markers written before 2026-10-12. */
    unchanged?: number;
    total: number;
    elapsedMs: number;
};

export function isSnapshotMarkerFresh(
    marker: SnapshotSuccessMarker | null | undefined,
    now: number = Date.now(),
    maxAgeMs: number = SNAPSHOT_FRESHNESS_MS,
): boolean {
    const completedAt = Number(marker?.completedAt ?? 0);
    return Number.isSafeInteger(completedAt)
        && completedAt > 0
        && now >= completedAt
        && now - completedAt <= maxAgeMs;
}

export async function readSnapshotSuccessMarker(): Promise<SnapshotSuccessMarker | null> {
    return await kv.get<SnapshotSuccessMarker>(SNAPSHOT_SUCCESS_KEY);
}

// Cron auth: a Bearer CRON_SECRET only. Never trust a scheduler-identifying
// request header instead — a merely-present header is trivially spoofable, so
// it would amount to unauthenticated trust.
function isCronAuthorized(req: VercelRequest): boolean {
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
async function runBatches<T>(items: T[], worker: (item: T) => Promise<{ ok: boolean; skip?: boolean; unchanged?: boolean; renewed?: boolean; validPlayer?: boolean; err?: string }>, deadline: number) {
    let snapshotted = 0;
    let skipped = 0;
    let unchanged = 0;
    let renewed = 0;
    let validPlayers = 0;
    const failed: string[] = [];
    let cursor = 0;

    while (cursor < items.length) {
        if (Date.now() > deadline) break;
        const slice = items.slice(cursor, cursor + MAX_PARALLEL);
        cursor += slice.length;
        const results = await Promise.all(slice.map(async (it) => {
            try {
                return await worker(it);
            } catch (err) {
                return { ok: false, err: err instanceof Error ? err.message : String(err) };
            }
        }));
        results.forEach((r, i) => {
            if (r.validPlayer) validPlayers += 1;
            if (r.ok) snapshotted += 1;
            else if (r.skip) {
                skipped += 1;
                if ('unchanged' in r && r.unchanged) unchanged += 1;
                if ('renewed' in r && r.renewed) renewed += 1;
            }
            else failed.push(String((slice[i] as unknown as string)));
        });
        // Yield to the event loop between batches so this nightly pass doesn't
        // monopolize the shared always-on process during its bursts of ~1MB
        // JSON parse/serialize — queued player requests get a turn between
        // batches. Same items, same results; only the scheduling changes.
        if (cursor < items.length) await new Promise<void>((resolve) => setImmediate(resolve));
    }

    return { snapshotted, skipped, unchanged, renewed, validPlayers, failed, processed: cursor, total: items.length };
}

export type SnapshotRunResult = {
    ok: boolean;
    /** True when the save keyspace was empty (KV proxy likely misconfigured). */
    emptyKeyspace: boolean;
    /** True when every write failed and none succeeded (snapshot store down). */
    writeOutage: boolean;
    snapshotted: number;
    /** Includes `unchanged`. */
    skipped: number;
    /** Saves identical to their newest snapshot, whose TTL was renewed instead of copied. */
    unchanged: number;
    validPlayers: number;
    failed: string[];
    processed: number;
    total: number;
    elapsedMs: number;
    truncated: boolean;
    /** True when snapshots completed but the durable success marker could not be recorded. */
    healthMarkerFailed?: boolean;
    completedAt?: number;
};

/** True only for canonical individual-player save rows. */
export function isPlayerSnapshotSaveKey(key: string): boolean {
    if (!key.startsWith(SAVE_PREFIX)) return false;
    const name = safeName(key.slice(SAVE_PREFIX.length));
    if (!name) return false;
    // Admin/content records and shared clan blobs are backed up separately and
    // must never be enough to refresh the player-backup health marker.
    return !name.startsWith('health-probe-') && !name.startsWith('admin') && !name.startsWith('clan-');
}

/**
 * Core snapshot pass — extracted from the HTTP handler so the always-on
 * server's in-process scheduler (api/cron/_scheduler.ts) can run the exact same
 * logic directly, with NO HTTP and NO auth (it's internal trusted code). The
 * handler below is now a thin auth+response wrapper around this.
 *
 * `maxRuntimeMs` bounds one pass. The HTTP path keeps the original ~25s budget
 * (so a manual admin trigger returns promptly); the nightly scheduler passes a
 * larger budget so it snapshots everyone in one run instead of leaning on the
 * next-day catch-up.
 */
export async function runSnapshotSaves(maxRuntimeMs: number = MAX_RUNTIME_MS): Promise<SnapshotRunResult> {
    const startedAt = Date.now();
    const deadline = startedAt + maxRuntimeMs;

    const saveKeys = await kv.keys(`${SAVE_PREFIX}*`);
    // Alarm on an empty keyspace. Since the cPanel overlay retirement
    // (2026-07-17) live saves are rows in the base Postgres store, so zero
    // `save:*` keys means this process is pointed at the wrong database
    // (check DATABASE_URL / SUPABASE_POSTGRES_URL) — or, during a rollback,
    // that the re-enabled overlay env is incomplete. Either way, "snapshotted
    // ZERO players" must never masquerade as a healthy backup. No writes
    // happen before this point, so the early return is side-effect free.
    if (saveKeys.length === 0) {
        console.error('[cron/snapshot-saves] ALARM: zero save:* rows found — storage misconfigured (check DATABASE_URL / SUPABASE_POSTGRES_URL point at the production database). Snapshotted 0 players.');
        return { ok: false, emptyKeyspace: true, writeOutage: false, snapshotted: 0, skipped: 0, unchanged: 0, validPlayers: 0, failed: [], processed: 0, total: 0, elapsedMs: Date.now() - startedAt, truncated: false };
    }
    const playerSaveKeys = saveKeys.filter(isPlayerSnapshotSaveKey);
    if (playerSaveKeys.length === 0) {
        console.error('[cron/snapshot-saves] ALARM: save:* rows exist but none are player saves — refusing to refresh backup health from admin/clan data only.');
        return { ok: false, emptyKeyspace: true, writeOutage: false, snapshotted: 0, skipped: 0, unchanged: 0, validPlayers: 0, failed: [], processed: 0, total: 0, elapsedMs: Date.now() - startedAt, truncated: false };
    }

    // Dedup source: ONE scan of all snapshot keys, bucketed to the newest ts per
    // player — replacing a per-player kv.keys() inside the loop (an N+1 of full
    // disk-overlay tree walks on cPanel). If this scan fails we fall back to NO
    // dedup (snapshot everyone this run): a redundant snapshot is harmless, a
    // missed one is not, so erring toward more backups is the safe direction.
    let newestByPlayer = new Map<string, number>();
    try {
        newestByPlayer = newestSnapshotByPlayer(await kv.keys(`${SNAPSHOT_PREFIX}*`));
    } catch (err) {
        console.warn(`[cron/snapshot-saves] snapshot-key scan failed (${err instanceof Error ? err.message : String(err)}) — proceeding with no dedup (snapshot everyone this run).`);
    }

    const result = await runBatches(playerSaveKeys, async (saveKey) => {
        const playerName = saveKey.slice(SAVE_PREFIX.length);

        // Dedup: skip if this player already has a snapshot within the last
        // SKIP_IF_RECENT_MS window. Also makes a double run (e.g. two schedulers)
        // a harmless no-op. Sourced from the single up-front scan above.
        const live = await kv.get<Record<string, unknown>>(saveKey);
        if (!live || !live.character || typeof live.character !== 'object' || Array.isArray(live.character)) {
            // A corrupt/malformed player row is a backup failure, not a normal
            // dedup skip. Otherwise one healthy player could refresh the global
            // success marker while any number of broken saves were omitted.
            return { ok: false, validPlayer: false, err: 'missing or malformed character' };
        }

        const newest = newestByPlayer.get(playerName) ?? 0;
        if (newest > 0 && Date.now() - newest < SKIP_IF_RECENT_MS) {
            return { ok: false, skip: true, validPlayer: true };
        }

        // Renewed by this process within the window and still identical: a
        // re-run (the recovery retry loop, a manual trigger) must not rewrite
        // every unchanged snapshot again. The 20 h skip above keys on capture
        // time, which renewal never moves, so it never fires for them. A READ
        // costs no WAL; a changed save still falls through and is captured.
        if (newest > 0 && Date.now() - (renewedAt.get(playerName) ?? 0) < SKIP_IF_RECENT_MS) {
            const snapshot = await kv.get<Record<string, unknown>>(snapshotKey(playerName, newest));
            if (snapshot && jsonValueEqual(snapshot, live)) {
                return { ok: false, skip: true, unchanged: true, validPlayer: true };
            }
        }

        // Unchanged since the newest snapshot: renew that copy's TTL instead of
        // writing an identical one. A nightly copy of every save regardless of
        // change measured 96% duplicates in production (11,709 rows, 461
        // distinct, 1.17 GB of an 8 GB disk) and grew with ACCOUNTS, not play.
        // The compareSet is one atomic statement that matches the complete JSON
        // (key order insensitive) and rewrites it with a fresh 90-day expiry, so
        // an idle player's last backup never ages out while their save exists.
        // Lossless: any point in time restores to the same state as before.
        if (newest > 0 && await kv.compareSet(snapshotKey(playerName, newest), live, live, { ex: SNAPSHOT_TTL_SECONDS })) {
            renewedAt.set(playerName, Date.now());
            return { ok: false, skip: true, unchanged: true, renewed: true, validPlayer: true };
        }

        const ts = Date.now();
        await kv.set(snapshotKey(playerName, ts), live, { ex: SNAPSHOT_TTL_SECONDS });
        return { ok: true, validPlayer: true };
    }, deadline);

    const elapsed = Date.now() - startedAt;
    const truncated = result.processed < result.total;
    // Backup-health alarm: we had players to snapshot but wrote none and at
    // least one failed — i.e. the snapshot store is rejecting writes. (All-
    // skipped is normal: every player already has a recent snapshot, so we
    // don't alarm on that.) A renewal of an unchanged save IS a successful
    // write, so a quiet night with one transient failure is not an outage. A
    // read-only skip (renewed earlier this window, still identical) wrote
    // nothing, so it proves nothing about the store and does not count.
    const writeOutage = result.snapshotted + result.renewed === 0 && result.failed.length > 0;
    if (writeOutage) {
        console.error(`[cron/snapshot-saves] ALARM: ${result.failed.length} snapshot writes failed and 0 succeeded — snapshot store may be down. Sample: ${result.failed.slice(0, 5).join(', ')}`);
    }
    const complete = result.validPlayers > 0 && !writeOutage && !truncated && result.failed.length === 0;
    let healthMarkerFailed = false;
    let completedAt: number | undefined;
    if (complete) {
        completedAt = Date.now();
        const marker: SnapshotSuccessMarker = {
            completedAt,
            snapshotted: result.snapshotted,
            skipped: result.skipped,
            unchanged: result.unchanged,
            total: result.validPlayers,
            elapsedMs: elapsed,
        };
        try {
            await kv.set(SNAPSHOT_SUCCESS_KEY, marker, { ex: SNAPSHOT_SUCCESS_TTL_SECONDS });
        } catch (err) {
            healthMarkerFailed = true;
            console.error(`[cron/snapshot-saves] ALARM: snapshots completed but the success marker could not be stored: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return {
        ok: complete && !healthMarkerFailed,
        emptyKeyspace: result.validPlayers === 0,
        writeOutage,
        ...result,
        elapsedMs: elapsed,
        truncated,
        healthMarkerFailed,
        completedAt,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

    // Authorize via a Bearer CRON_SECRET OR a FULL-admin password (so ops can
    // trigger manually from the admin panel without exposing CRON_SECRET).
    // Content admins (Admin 2) must not be able to drive system-wide snapshot
    // runs — this is an operational endpoint.
    if (!isCronAuthorized(req) && !isFullAdmin(req)) {
        return res.status(401).json({ error: 'Cron secret or full admin password required.' });
    }

    try {
        const r = await runSnapshotSaves();
        if (r.emptyKeyspace) {
            return res.status(500).json({
                ok: false,
                error: 'No save rows found — refusing to report a healthy backup. Check DATABASE_URL / SUPABASE_POSTGRES_URL on this deployment (saves live in the base store since the cPanel overlay retirement).',
                snapshotted: 0,
                total: 0,
            });
        }
        return res.status(r.ok ? 200 : 500).json({
            ok: r.ok,
            snapshotted: r.snapshotted,
            skipped: r.skipped,
            unchanged: r.unchanged,
            failed: r.failed,
            processed: r.processed,
            total: r.total,
            elapsedMs: r.elapsedMs,
            truncated: r.truncated,
            completedAt: r.completedAt,
            healthMarkerFailed: r.healthMarkerFailed,
            warning: r.writeOutage
                ? 'Every snapshot write failed — the snapshot store may be unavailable. No player was backed up this run.'
                : undefined,
            note: r.truncated
                ? 'Hit runtime deadline before processing all players. The next firing will pick up the rest (dedup window prevents double-snapshots).'
                : undefined,
        });
    } catch (err) {
        console.error('[cron/snapshot-saves]', err);
        return res.status(500).json({ error: err instanceof Error ? err.message : 'Snapshot cron failed.' });
    }
}
