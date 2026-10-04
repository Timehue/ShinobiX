/**
 * Dual-mode KV adapter — drop-in replacement for @vercel/kv.
 * Railway is the active runtime; cPanel/Passenger and Vercel references below
 * describe retained compatibility, migration, or rollback behavior only.
 *
 * ┌──────────────┬──────────────────────────────────────────────────────┐
 * │ Environment  │ Backend                                              │
 * ├──────────────┼──────────────────────────────────────────────────────┤
 * │ cPanel /     │ pg Pool → direct Postgres.  No REST timeout; handles │
 * │ Passenger    │ 10 MB+ image blobs.  DATABASE_URL env var required.  │
 * ├──────────────┼──────────────────────────────────────────────────────┤
 * │ Vercel /     │ Supabase REST API (PostgREST).  HTTP-based; no TCP   │
 * │ serverless   │ cold-start penalty.  SUPABASE_URL +                  │
 * │              │ SUPABASE_SERVICE_ROLE_KEY env vars required.         │
 * │              │ Statement timeout raised to 120s via ALTER ROLE.     │
 * └──────────────┴──────────────────────────────────────────────────────┘
 *
 * Storage model (shared):
 *   Each key is one row in public.kv_store.
 *   String/JSON values → value column (JSONB).
 *   Hash values        → value column holds a JSON object.
 *   TTL                → expires_at (timestamptz); lazily evicted on read.
 */

// ─── In-process read cache ────────────────────────────────────────────────────
// On cPanel / Passenger the Node process is long-lived, so this Map survives
// across requests and acts as a free first-level cache that absorbs repeated
// reads (world-state, images, etc.) without touching Postgres at all.
// On Vercel (stateless) instances are short-lived so this is a best-effort
// bonus; CDN Cache-Control headers are the primary caching layer there.

import type { KvProjection } from './_storage-projection.js';
import { signalKeyWritten } from './_kv-write-signal.js';
import { assertKvLockContext, currentKvLockContext, LockOwnershipLostError, poisonKvLockContext } from './_kv-lock-context.js';
import { runtimeTimeouts } from './_runtime-timeouts.js';
import { makeGuardedRestKv } from './_storage-lock-rest.js';

interface CacheEntry { value: unknown; expiresAt: number; }
const _readCache = new Map<string, CacheEntry>();

// Hard ceiling on distinct cached keys. On Railway the process is long-lived, so
// without a cap the Map grows for the life of the process — one entry per distinct
// key ever read (for example `img-owner:<id>`), and expired
// entries are only reclaimed if that *same* key is read again. A key written once
// and never re-read would leak forever. We bound it as an LRU: Map preserves
// insertion order, so the oldest (least-recently-used) key is always the first one
// the iterator yields, and re-inserting on access moves an entry to the newest slot.
const _CACHE_MAX_ENTRIES = 5000;

// These prefixes change too rapidly to benefit from caching.
const _noCachePrefixes = [
    // Save blobs are optimistic-concurrency and RMW authority shared across
    // processes. A process-local cached v5 can survive another process's v6
    // commit, pass an exact `_baseSaveVersion:5` guard under the distributed
    // lock, and overwrite v6. Every save read (including mget/hgetall) must hit
    // the backing store; caches remain enabled for deliberately safe prefixes.
    'save:',
    // Shared treasury/pool balances, their receipts, and reservation counters
    // are read under distributed locks. A process-local pre-lock snapshot can
    // still overwrite a newer worker's credit or exceed a shared encounter cap.
    'game:village-state:', 'clan-seal-pool:', 'world:sector-pool:', 'world:shrine:',
    // Recovery journals and discovery pointers must agree with uncached debit
    // and credit receipts after a retry or a deployment handoff.
    'economy-tx:', 'economy-settlement:', 'economy-settlement-pending:',
    // The active Weekly Boss attempt and its prepared/settled record are
    // cross-worker authority just like the boss's shared generation state.
    'weekly-boss-active:', 'weekly-boss-run:',
    // Credential rotation/revocation and Google subject ownership must become
    // visible on every worker immediately. These namespaces are distinct from
    // `auth:`; a cached recovery hash can accept a replaced spare key.
    'auth-recovery:', 'guest-resume:', 'auth-google:', 'auth-google-ticket:',
    // Purchase receipt ownership is checked under its distributed lock. A
    // cached miss must not hide another account's already-claimed purchase.
    'play:reward:purchase:',
    // Recovery joins these private receipts with uncached player/clan debit
    // proofs. A worker-local pending snapshot must not hide another worker's
    // completion or make that join disagree immediately after a retry.
    'clan:mission-claimed:', 'economy-settlement:clan-exchange-',
    // Mentor records hold pending milestone settlements and are only ever
    // replaced by exact CAS; the pointers and student markers beside them are
    // compare-and-delete guarded. A worker-local snapshot would turn every
    // write into a spurious conflict or hide another worker's admission.
    'clan-mentor',
    // Player deletion generations are durable cross-worker save authority. A
    // cached floor would let another worker resurrect an old save.
    'save-delete-version:',
    'presence:', 'challenges:', 'reset-signal:', 'admin-lock:', 'auth:', 'auth-session:', 'world:travel-lease:',
    // Natural-wanderer cooldown proofs are NX claims shared by all workers.
    // A process-local cached null can make an idempotent readback look absent.
    'wanderer-use:',
    // Pet-battle authority is coordinated across processes. A cached null can
    // admit duplicate work; a cached proof/result can resurrect an already-
    // settled match; a stale queue/lobby/session can overwrite another worker's
    // participant or move while its distributed lock is correctly held.
    // `pet:` covers battle proofs/results and future pet authority by default.
    'pet:', 'arena:lobby:', 'sector-pet:',
    // Hollow Gate run, parent-combat, child-result, and retained Showdown
    // sidecar state participate in the same cross-worker single-authority
    // handshake. A process-local null or pre-claim binding can admit a second
    // child engine even while the distributed lock is working correctly.
    'hg-run:', 'hg-combat-binding:', 'hg-combat-paid:', 'hg-pet-result:', 'sd-hg:', 'sd-wcr80:', 'sd-fp:', 'first-pact:',
    // Archived Standing Court proofs can appear on another worker after a
    // cached miss; their absence must be checked against shared storage.
    'first-pact-standing-receipt:',
    'petgauntlet:', 'petladder:', 'clan-war-pet:',
    'pet-sanctuary:', 'pet-breeding-result:', 'pet-encounter:', 'pet-encounter-attempt:',
    'pet-encounter-active:', 'pet-encounter-request:', 'pet-encounter-declined:',
    // Chronicle match/queue state and Legacy ledgers are lock-protected RMW
    // authority. Process-local snapshots would defeat those distributed locks,
    // lose accepted turns, or replay/erase exact-once progression receipts.
    'card-clash:queue', 'cc-pair:', 'cc-freeplay:', 'cc-ai:', 'cc-freeplay-legacy-pair:',
    // Every Legacy key is authoritative: this includes the active trial,
    // permanent accepted marker, offer/pity state, exact-once activity ledgers,
    // and completion-effect outbox. Keeping the whole namespace uncached makes
    // future Legacy RMW keys safe by default instead of relying on a fragile
    // per-key allowlist.
    'legacy:',
    // Exchange reservations and transfer journals must be fresh across workers.
    'sunscar-exchange:',
    'offline-notices:',
    // Legacy completion fans out through retry-safe world-history RMW stores.
    // Their distributed locks only work when the lock holder reads the shared
    // latest list/state, not a process-local pre-lock snapshot.
    'audit:', 'hall:', 'game:announcements', 'game:era-state', 'era:', 'world:crisis:',
    // Weekly Boss resets and reward finalization share generation-CAS state.
    // A cached prior spawn would defeat the distributed lock and let a late
    // phase-3 continuation overwrite the replacement generation.
    'game:weekly-boss-state',
    // Circuit join/seal/pause writes share a distributed event lock.
    'game:dojo-circuit:',
    'game:tournaments:',
    // Direct-message inboxes, threads, and per-player deletion cutoffs are all
    // lock-coordinated live state. A worker-local snapshot can resurrect a
    // deleted row or lose a concurrently delivered message. Sector chat is the
    // same shape, and its socket hint makes every reader refetch at once: a
    // cached row would answer that hint with the line it was sent to announce.
    'chat:village:', 'chat:sector:', 'dm:',
    // Solo-PvE move/state versions and their story bindings are likewise
    // distributed-lock authority. A cached pre-move session can accept an old
    // expectedVersion after another worker committed, overwriting that move and
    // its terminal/consumable evidence; bindings must stay coherent with it.
    'solo-pve:', 'story-combat-binding:',
    // Main PvP sessions, move locks, ranked queues, reward receipts, and bounty
    // claims share the same cross-worker correctness requirement. In
    // particular, pvp/move re-reads `pvp:<battleId>` while holding its
    // distributed lock; a process-local snapshot at that point defeats the
    // lock and can apply a move against an already-advanced turn.
    'pvp:',
    // Player-ranked settlement authority: the per-match terminal journal, its
    // no-contest records, and the recovery sweep's pending pointers. A cached
    // journal is the object this process wrote, in JS key order; every other
    // reader (a restarted saga, the other deploy's worker, the sweep) gets the
    // Postgres JSONB row with its keys reordered. That asymmetry is how a
    // key-order-dependent fingerprint passed every uninterrupted saga yet
    // failed every resumed one — keep all readers on the same stored bytes.
    'player:ranked-',
    // Competitive war records are also lock-protected shared combat state.
    // Reports, challenges, mercenary damage, and reward claims must resolve
    // against the same latest war revision on every worker.
    // Territory HP and its immutable raid proof markers form a help-forward
    // settlement saga. A lock holder must never serve a worker-local snapshot
    // that predates another worker's pending or terminal receipt.
    'world:territory:', 'raid-territory-proof:',
    'world:war:', 'world:village-war-', 'clan-war:', 'clan-war-xp:',
    // Sector-war battle receipts are exactly-once scoring evidence. A
    // process-local cached null for a receipt another worker has since written
    // would make a replayed battle look new and score it twice.
    'shared:sector-war-battle:',
    // Interlude and road-event choices are permanent, server-owned character
    // history. Each choice appends under a distributed lock and must read the
    // latest lane tally written by any worker.
    'story:',
    // Player trades are finished from their nonce markers, journals and the
    // recovery sweep's pending pointers, read under both save locks by the
    // player's retry, the admin reconcile and the sweep
    // (api/player/_trade-settlement.ts). A worker-local snapshot of a marker
    // another worker released could re-run a debit that worker already ran.
    'trade:', 'economy-tx:player-trade:',
];

function _shouldCache(key: string): boolean {
    return !_noCachePrefixes.some(p => key.startsWith(p));
}

function _cacheTtlMs(key: string): number {
    if (key.startsWith('shared:images') || key.startsWith('shared:imgfields')) return 60_000;
    if (key.startsWith('world:') || key.startsWith('game:')) return 15_000;
    return 10_000; // registry and other comparatively stable records
}

function _cacheRead<T>(key: string): T | undefined {
    if (_storageClosed) throw new Error('Storage is closed for shutdown.');
    assertKvLockContext();
    // A lock holder needs the current database predecessor, regardless of the
    // ordinary cache policy for this key. Detached/poisoned holders fail above.
    if (currentKvLockContext()) return undefined;
    if (!_shouldCache(key)) return undefined;
    const entry = _readCache.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) { _readCache.delete(key); return undefined; }
    // Mark as most-recently-used so a hot key is never the first eviction target.
    _readCache.delete(key);
    _readCache.set(key, entry);
    return entry.value as T;
}

function _cacheWrite(key: string, value: unknown, rowExpiresAt?: string | null): void {
    if (!_shouldCache(key)) return;
    // Cache freshness must never extend the lifetime of the stored row. This
    // also applies to write-through cache entries and batched reads.
    const cacheExpiresAt = Date.now() + _cacheTtlMs(key);
    const expiresAt = rowExpiresAt ? Math.min(cacheExpiresAt, new Date(rowExpiresAt).getTime()) : cacheExpiresAt;
    // Delete-then-set moves an existing key to the newest LRU slot.
    _readCache.delete(key);
    _readCache.set(key, { value, expiresAt });
    // Evict the least-recently-used entries once over the ceiling. The oldest key is
    // the first one the iterator yields; deleting it is O(1). Old expired entries sit
    // near the front, so they get reclaimed first in the natural course of eviction.
    while (_readCache.size > _CACHE_MAX_ENTRIES) {
        const oldest = _readCache.keys().next().value;
        if (oldest === undefined) break;
        _readCache.delete(oldest);
    }
}

function _cacheInvalidate(...keys: string[]): void {
    for (const k of keys) _readCache.delete(k);
}

// ─── pg Pool backend (cPanel / Passenger) ────────────────────────────────────

import pg from 'pg';

const { Pool } = pg;

let _pool: pg.Pool | null = null;
let _storageClosed = false;
let _poolClose: Promise<void> | null = null;

export async function closeStoragePool(): Promise<void> {
    _storageClosed = true;
    _readCache.clear();
    _poolClose ??= _pool ? _pool.end() : Promise.resolve();
    await _poolClose;
}

function getPool(): pg.Pool {
    if (_storageClosed) throw new Error('Storage is closed for shutdown.');
    if (_pool) return _pool;

    // DATABASE_URL wins; fall back to SUPABASE_POSTGRES_URL (set automatically
    // by the Supabase Vercel integration on all environments).
    const url = (process.env.DATABASE_URL ?? process.env.SUPABASE_POSTGRES_URL)!;

    // Strip params that confuse pg: sslmode (pg v8 treats require as verify-full)
    // and pgbouncer=true (Supavisor hint for ORMs, not understood by pg driver).
    const cleanUrl = url
        .replace(/([?&])sslmode=[^&]*/g, (_, sep) => (sep === '?' ? '?' : ''))
        .replace(/([?&])pgbouncer=[^&]*/g, (_, sep) => (sep === '?' ? '?' : ''))
        .replace(/\?$/, '')
        .replace(/\?&/, '?');

    // Parse the URL manually with the WHATWG URL API instead of passing
    // connectionString. pg v8 delegates connection-string parsing to
    // pg-connection-string which calls the deprecated url.parse() internally,
    // causing Node.js to emit DEP0169 on every request. Passing individual
    // config fields bypasses that code path entirely.
    const parsed = new URL(cleanUrl);
    const limits = runtimeTimeouts();
    _pool = new Pool({
        host: parsed.hostname,
        port: parsed.port ? parseInt(parsed.port, 10) : 5432,
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.replace(/^\//, ''),
        // SSL on by default (Supabase requires it, as does Railway's PUBLIC proxy
        // URL). Set PG_SSL=disable ONLY when connecting over Railway's PRIVATE
        // network (host postgres.railway.internal): that listener is on an
        // isolated per-project overlay, serves plaintext, and rejects an SSL
        // handshake — so forcing SSL there fails to connect. Never disable SSL on
        // a public/internet connection string.
        ssl: process.env.PG_SSL === 'disable' ? false : { rejectUnauthorized: false },
        // Pool size PER PROCESS. cPanel/Passenger runs many small worker
        // processes, so 5 each is plenty there. The single always-on Railway
        // instance serves EVERY player's heartbeat/save traffic through this one
        // pool, so it defaults to 15 (Railway is detected via the platform's own
        // RAILWAY_ENVIRONMENT var); with only 5 connections a small burst of slow
        // statements starves the pool and everything else waits on the 15s
        // acquire timeout. PG_POOL_MAX overrides either default explicitly, and
        // a (dormant) cPanel host booting N Passenger workers stays at 5 so it
        // can't multiply into the Supabase connection ceiling.
        max: limits.poolMax,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: limits.connectionMs,
        // Bound a pathologically slow query so it can't pin a pool connection
        // indefinitely (there was no query timeout before — a hung statement held
        // its connection until the server role's 2-min default, and with only a
        // handful of connections a few of those starve the whole pool and
        // everything else 15s-times-out waiting to acquire). Base-store queries
        // are PK/indexed lookups or small batched reads; since the cPanel disk
        // overlay was retired (2026-07-17) the multi-MB save/image blobs also
        // travel this pool, and 30s remains far above any legitimate statement —
        // this only ever fires on a genuine hang.
        // statement_timeout is server-enforced; query_timeout is the client-side
        // backstop if the socket itself wedges. Overridable via PG_STATEMENT_TIMEOUT_MS.
        statement_timeout: limits.statementMs,
        query_timeout: limits.statementMs,
    });

    _pool.on('error', (err) => {
        console.error('[pg pool error]', err.message);
    });

    return _pool;
}

type PgQueryExecutor = {
    query<R extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
};

/**
 * Each locked KV statement is fenced in its own transaction. FOR SHARE holds
 * every owner row until COMMIT, so even an expired lease cannot be replaced
 * between its validation and the protected write. No callback-wide transaction
 * is needed, and this works with transaction-pooling Postgres connections.
 */
const fencedPg: PgQueryExecutor = {
    async query<R extends pg.QueryResultRow>(sql: string, values?: unknown[]): Promise<pg.QueryResult<R>> {
        const context = currentKvLockContext();
        if (!context) return getPool().query<R>(sql, values);
        assertKvLockContext(context);
        let client: pg.PoolClient | undefined;
        try {
            client = await getPool().connect();
            assertKvLockContext(context);
            await client.query('BEGIN');
            const { rows } = await client.query<{ key: string; value: unknown; live: boolean }>(
                `WITH held AS MATERIALIZED (
                     SELECT key, value, expires_at FROM public.kv_store
                     WHERE key = ANY($1::text[]) ORDER BY key FOR SHARE
                 ) SELECT key, value, expires_at > clock_timestamp() AS live FROM held`,
                [context.leases.map(lease => lease.key)],
            );
            const owners = new Map(rows.map(row => [row.key, row]));
            if (context.leases.some(lease => {
                const row = owners.get(lease.key);
                return !row?.live || row.value !== lease.owner;
            })) throw new LockOwnershipLostError();
            assertKvLockContext(context);
            const result = await client.query<R>(sql, values);
            assertKvLockContext(context);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            // Never replay a mutation after a lost query/COMMIT response. It
            // might already be durable. Domain receipt/recovery code owns retry.
            const failure = poisonKvLockContext(context, error);
            if (client) await client.query('ROLLBACK').catch(() => undefined);
            client?.release(failure);
            client = undefined;
            throw failure;
        } finally {
            client?.release();
        }
    },
};

function getPgDb(): PgQueryExecutor {
    assertKvLockContext();
    return currentKvLockContext() ? fencedPg : getPool();
}

export function _toSqlPattern(pattern: string): string {
    return pattern
        // PostgreSQL LIKE treats backslash as its default escape character.
        // Escape it first so a caller cannot use `\%` / `\_` to undo the
        // literal escaping below.
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_')
        .replace(/\*/g, '%')
        .replace(/\?/g, '_');
}

function expiresAt(ex: number): string {
    return new Date(Date.now() + ex * 1000).toISOString();
}

// ─── pg implementations ───────────────────────────────────────────────────────

const pgKv = {
    async get<T = unknown>(key: string): Promise<T | null> {
        const hit = _cacheRead<T>(key);
        if (hit !== undefined) return hit;
        const db = getPgDb();
        const { rows } = await db.query<{ value: unknown; expires_at: string | null }>(
            `SELECT value, expires_at FROM public.kv_store WHERE key = $1`,
            [key]
        );
        if (!rows.length) { _cacheWrite(key, null); return null; }
        const row = rows[0];
        if (row.expires_at && new Date(row.expires_at) <= new Date()) {
            // Another writer may replace this expired row after the SELECT.
            // Recheck expiry in the DELETE so lazy cleanup cannot erase its
            // live replacement. Cleanup failure must not reject an expired read.
            // A locked read must not spawn detached fenced maintenance after
            // its callback ends. NX/CAS already handle expired predecessors;
            // an ordinary unlocked read can reclaim this row later.
            if (!currentKvLockContext()) void db.query(
                `DELETE FROM public.kv_store WHERE key = $1 AND expires_at <= now()`, [key],
            ).catch(() => undefined);
            return null;
        }
        _cacheWrite(key, row.value, row.expires_at);
        return row.value as T;
    },

    async set(key: string, value: unknown, options?: { ex?: number; nx?: boolean }): Promise<'OK' | null> {
        _cacheInvalidate(key);
        const db = getPgDb();
        const exp = options?.ex ? expiresAt(options.ex) : null;
        if (options?.nx) {
            const { rows } = await db.query<{ kv_set_nx: boolean }>(
                `SELECT public.kv_set_nx($1, $2::jsonb, $3::timestamptz) AS kv_set_nx`,
                [key, JSON.stringify(value), exp]
            );
            if (rows[0].kv_set_nx) { _cacheWrite(key, value, exp); signalKeyWritten(key); }
            return rows[0].kv_set_nx ? 'OK' : null;
        }
        await db.query(
            `INSERT INTO public.kv_store (key, value, expires_at, updated_at)
             VALUES ($1, $2::jsonb, $3::timestamptz, now())
             ON CONFLICT (key) DO UPDATE
                 SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, updated_at = now()`,
            [key, JSON.stringify(value), exp]
        );
        _cacheWrite(key, value, exp);
        signalKeyWritten(key);
        return 'OK';
    },

    async compareSet(key: string, expected: unknown | null, value: unknown, options?: { ex?: number }): Promise<boolean> {
        _cacheInvalidate(key);
        const exp = options?.ex ? expiresAt(options.ex) : null;
        const db = getPgDb();
        let swapped: boolean;
        if (expected === null) {
            // One statement handles both allowed absence cases. A conflicting
            // LIVE row makes the ON CONFLICT WHERE false and changes nothing;
            // an expired row is atomically replaced while PostgreSQL holds the
            // conflicting row lock. This avoids requiring a separately-applied
            // schema RPC on Railway without weakening CAS into get-then-set.
            const { rows } = await db.query<{ swapped: boolean }>(
                `INSERT INTO public.kv_store AS current (key, value, expires_at, updated_at)
                 VALUES ($1, $2::jsonb, $3::timestamptz, now())
                 ON CONFLICT (key) DO UPDATE
                     SET value = EXCLUDED.value,
                         expires_at = EXCLUDED.expires_at,
                         updated_at = now()
                     WHERE current.expires_at IS NOT NULL
                       AND current.expires_at <= now()
                 RETURNING true AS swapped`,
                [key, JSON.stringify(value), exp],
            );
            swapped = rows[0]?.swapped === true;
        } else {
            // Exact full-JSON predecessor match and liveness check happen in the
            // UPDATE itself. A mismatch/expired row returns no row and preserves
            // both its value and TTL. On success, even a null expiry is written,
            // so the replacement TTL is authoritative just like set().
            const { rows } = await db.query<{ swapped: boolean }>(
                `UPDATE public.kv_store
                 SET value = $3::jsonb,
                     expires_at = $4::timestamptz,
                     updated_at = now()
                 WHERE key = $1
                   AND value = $2::jsonb
                   AND (expires_at IS NULL OR expires_at > now())
                 RETURNING true AS swapped`,
                [key, JSON.stringify(expected), JSON.stringify(value), exp],
            );
            swapped = rows[0]?.swapped === true;
        }
        if (swapped) { _cacheWrite(key, value, exp); signalKeyWritten(key); }
        return swapped;
    },

    async del(...keys: string[]): Promise<number> {
        if (!keys.length) return 0;
        _cacheInvalidate(...keys);
        const { rowCount } = await getPgDb().query(
            `DELETE FROM public.kv_store WHERE key = ANY($1::text[])`, [keys]
        );
        if (rowCount) signalKeyWritten(...keys);
        return rowCount ?? 0;
    },

    async delIfEqual(key: string, expected: unknown): Promise<boolean> {
        _cacheInvalidate(key);
        // Single atomic statement — the value comparison and the delete happen in
        // one row-locked operation, so no other writer can slip a new lock in
        // between. The lock value is stored as a JSONB string, so compare against
        // the JSON-encoded token.
        const { rowCount } = await getPgDb().query(
            `DELETE FROM public.kv_store WHERE key = $1 AND value = $2::jsonb`,
            [key, JSON.stringify(expected)]
        );
        const deleted = (rowCount ?? 0) > 0;
        if (deleted) signalKeyWritten(key);
        return deleted;
    },

    async incr(key: string, options?: { ex?: number }): Promise<number> {
        _cacheInvalidate(key);
        const exp = options?.ex ? expiresAt(options.ex) : null;
        const { rows } = await getPgDb().query<{ kv_incr: string }>(
            `SELECT public.kv_incr($1, $2::timestamptz) AS kv_incr`,
            [key, exp]
        );
        signalKeyWritten(key);
        return Number(rows[0].kv_incr);
    },

    async keys(pattern: string): Promise<string[]> {
        const { rows } = await getPgDb().query<{ key: string }>(
            `SELECT key FROM public.kv_store WHERE key LIKE $1 AND (expires_at IS NULL OR expires_at > now())`,
            [_toSqlPattern(pattern)]
        );
        return rows.map((r) => r.key);
    },

    async mget<T extends unknown[] = unknown[]>(...keys: string[]): Promise<(T[number] | null)[]> {
        if (!keys.length) return [];
        // Check cache first — only fetch keys not already cached.
        const result: (T[number] | null)[] = new Array(keys.length).fill(null);
        const missIndices: number[] = [];
        const missKeys: string[] = [];
        for (let i = 0; i < keys.length; i++) {
            const hit = _cacheRead<T[number]>(keys[i]);
            if (hit !== undefined) { result[i] = hit; }
            else { missIndices.push(i); missKeys.push(keys[i]); }
        }
        if (missKeys.length) {
            const { rows } = await getPgDb().query<{ key: string; value: unknown; expires_at: string | null }>(
                `SELECT key, value, expires_at FROM public.kv_store WHERE key = ANY($1::text[]) AND (expires_at IS NULL OR expires_at > now())`,
                [missKeys]
            );
            const map = new Map(rows.map((r) => [r.key, r]));
            for (let j = 0; j < missKeys.length; j++) {
                const row = map.get(missKeys[j]);
                const val = row ? (row.value as T[number]) : null;
                result[missIndices[j]] = val;
                _cacheWrite(missKeys[j], val, row?.expires_at);
            }
        }
        return result;
    },

    async mgetProjected(keys: string[], projection: KvProjection): Promise<Array<Record<string, unknown> | null>> {
        if (!keys.length) return [];
        const params: unknown[] = [keys];
        const fragments = Object.entries(projection).map(([field, path]) => {
            params.push(field, path);
            const fieldParam = `$${params.length - 1}::text`;
            const pathParam = `$${params.length}::text[]`;
            return `CASE WHEN value #> ${pathParam} IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(${fieldParam}, value #> ${pathParam}) END`;
        });
        const expression = fragments.length ? fragments.join(' || ') : "'{}'::jsonb";
        // Read the current row directly. A projection must never seed the cache
        // consumed by get/mget or become authority for a subsequent save write.
        const { rows } = await getPgDb().query<{ key: string; value: Record<string, unknown> | null }>(
            `SELECT key, CASE WHEN jsonb_typeof(value) = 'object' THEN ${expression} ELSE NULL END AS value
             FROM public.kv_store WHERE key = ANY($1::text[]) AND (expires_at IS NULL OR expires_at > now())`,
            params,
        );
        const byKey = new Map(rows.map(row => [row.key, row.value]));
        return keys.map(key => byKey.get(key) ?? null);
    },

    async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
        return pgKv.get<T>(key);
    },

    async hkeys(key: string, options?: { nonEmptyStrings?: boolean }): Promise<string[]> {
        // Image manifests opt into a value predicate so legacy empty-string
        // tombstones never become broken image URLs. Ordinary hash callers keep
        // normal Redis-style hkeys semantics.
        if (options?.nonEmptyStrings) {
            const { rows } = await getPgDb().query<{ k: string }>(
                `SELECT field.key AS k FROM public.kv_store
                 CROSS JOIN LATERAL jsonb_each(
                     CASE WHEN jsonb_typeof(kv_store.value) = 'object' THEN kv_store.value ELSE '{}'::jsonb END
                 ) AS field(key, value)
                 WHERE kv_store.key = $1 AND (expires_at IS NULL OR expires_at > now())
                   AND jsonb_typeof(kv_store.value) = 'object'
                   AND jsonb_typeof(field.value) = 'string'
                   AND field.value <> '""'::jsonb`,
                [key],
            );
            return rows.map((r) => r.k);
        }
        // Extract field names IN SQL — never ships the (multi-MB) value itself.
        // jsonb_object_keys errors on non-objects, so guard on jsonb_typeof.
        const { rows } = await getPgDb().query<{ k: string }>(
            `SELECT jsonb_object_keys(value) AS k FROM public.kv_store
             WHERE key = $1 AND (expires_at IS NULL OR expires_at > now())
               AND jsonb_typeof(value) = 'object'`,
            [key],
        );
        return rows.map((r) => r.k);
    },

    async hset(key: string, fields: Record<string, unknown>): Promise<number> {
        _cacheInvalidate(key);
        await getPgDb().query(`SELECT public.kv_hset($1, $2::jsonb)`, [key, JSON.stringify(fields)]);
        signalKeyWritten(key);
        return Object.keys(fields).length;
    },

    async hdel(key: string, ...fields: string[]): Promise<number> {
        if (!fields.length) return 0;
        _cacheInvalidate(key);
        await getPgDb().query(`SELECT public.kv_hdel($1, $2::text[])`, [key, fields]);
        signalKeyWritten(key);
        return fields.length;
    },
};

/** Actual production pg adapter, exported only for storage-boundary tests that
 * simulate independent processes over one mocked Postgres row store. */
export const _pgKvForTest = pgKv;

// ─── Supabase REST backend (Vercel / serverless) ──────────────────────────────

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

function _cleanDnsHost(value: string | undefined): string | null {
    const host = (value ?? '').trim().toLowerCase();
    if (!host) return null;
    if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.') || !host.includes('.')) {
        throw new Error('[kv] SUPABASE_DNS_HOST must be a bare hostname such as project.supabase.co.');
    }
    return host;
}

function _cleanIpv4(value: string | undefined): string | null {
    const ip = (value ?? '').trim();
    if (!ip) return null;
    const parts = ip.split('.');
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
        throw new Error('[kv] SUPABASE_HARDCODED_IP must be a valid IPv4 address.');
    }
    return ip;
}

function _buildSupabaseDnsMap(env: NodeJS.ProcessEnv): Record<string, string> {
    const explicitlyEnabled = env.SUPABASE_DNS_BYPASS === '1';
    const host = _cleanDnsHost(env.SUPABASE_DNS_HOST);
    const ip = _cleanIpv4(env.SUPABASE_HARDCODED_IP);
    if (!explicitlyEnabled && !host && !ip) return {};
    if (!host || !ip) {
        throw new Error('[kv] SUPABASE_DNS_BYPASS requires both SUPABASE_DNS_HOST and SUPABASE_HARDCODED_IP.');
    }
    return { [host]: ip };
}

function getSupabase(): SupabaseClient {
    if (_supabase) return _supabase;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');

    // Optional cPanel-only DNS bypass. Configure BOTH SUPABASE_DNS_HOST and
    // SUPABASE_HARDCODED_IP when CageFS cannot resolve the Supabase hostname.
    // No project hostname or fallback IP is embedded here because Supabase's
    // Cloudflare address can rotate and is deployment-specific.
    const _DNS_MAP = _buildSupabaseDnsMap(process.env);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function _envDnsLookup(hostname: string, options: any, callback: (err: Error | null, address: string, family: number) => void): void {
        if (_DNS_MAP[hostname]) return callback(null, _DNS_MAP[hostname], 4);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('dns').lookup(hostname, options, callback);
    }
    let baseFetch: typeof fetch = globalThis.fetch;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
        const undici = require('undici') as any;
        if (Object.keys(_DNS_MAP).length > 0) {
            const agent = new undici.Agent({ connect: { family: 4, lookup: _envDnsLookup } });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            baseFetch = (input, init) => undici.fetch(input, { ...(init ?? {}), dispatcher: agent } as any);
        }
    } catch {
        // undici not available — fall back to global fetch
    }

    // Give every Supabase REST call a 20-second hard timeout.
    const fetchWithTimeout: typeof fetch = (input, init) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20_000);
        return baseFetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
    };
    _supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: fetchWithTimeout },
    });
    return _supabase;
}

function isExpired(exp: string | null): boolean {
    return !!exp && new Date(exp) <= new Date();
}

// ─── PostgREST result-limit safety ────────────────────────────────────────────
// PostgREST silently caps every response at the project's max-rows setting
// (Supabase default: 1000 rows) — it does NOT error, it just truncates. The
// production kv_store already holds >4k rows and the `save-snapshot:*` prefix
// alone is near the cap, so an unpaginated keys()/mget() would silently drop
// matches (incomplete snapshot dedup, truncated admin restore lists, partial
// batch deletes). Reads paginate with .range(); .in() inputs are chunked so a
// batch can never exceed one page (and the filter URL stays bounded).
const SUPABASE_PAGE_SIZE = 1000;
const SUPABASE_IN_CHUNK = 200;

export function _chunkArray<T>(items: readonly T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size) as T[]);
    return out;
}

/**
 * Drain a paginated PostgREST query: `fetchPage(from, to)` returns one
 * inclusive `.range(from, to)` page; pages are requested until one comes back
 * short. Ordering must be stable (callers order by key) or rows could repeat/
 * skip across pages.
 */
export async function _collectPaginated<Row>(
    fetchPage: (from: number, to: number) => Promise<Row[]>,
    pageSize: number = SUPABASE_PAGE_SIZE,
): Promise<Row[]> {
    const all: Row[] = [];
    for (let from = 0; ; from += pageSize) {
        const page = await fetchPage(from, from + pageSize - 1);
        all.push(...page);
        if (page.length < pageSize) return all;
    }
}

const supabaseKv = {
    async get<T = unknown>(key: string): Promise<T | null> {
        const db = getSupabase();
        const { data, error } = await db.from('kv_store').select('value, expires_at').eq('key', key).maybeSingle();
        if (error) throw new Error(`kv.get(${key}): ${error.message}`);
        if (!data) return null;
        if (isExpired(data.expires_at as string | null)) {
            void db.from('kv_store').delete().eq('key', key);
            return null;
        }
        return data.value as T;
    },

    async set(key: string, value: unknown, options?: { ex?: number; nx?: boolean }): Promise<'OK' | null> {
        const db = getSupabase();
        const exp = options?.ex ? expiresAt(options.ex) : null;
        if (options?.nx) {
            const { data, error } = await db.rpc('kv_set_nx', { p_key: key, p_value: value, p_expires_at: exp });
            if (error) throw new Error(`kv.set NX(${key}): ${error.message}`);
            return data ? 'OK' : null;
        }
        const { error } = await db.from('kv_store').upsert(
            { key, value, expires_at: exp, updated_at: new Date().toISOString() },
            { onConflict: 'key' }
        );
        if (error) throw new Error(`kv.set(${key}): ${error.message}`);
        return 'OK';
    },

    async compareSet(key: string, expected: unknown | null, value: unknown, options?: { ex?: number }): Promise<boolean> {
        const db = getSupabase();
        const exp = options?.ex ? expiresAt(options.ex) : null;
        const { data, error } = await db.rpc('kv_compare_set', {
            p_key: key,
            p_expected: expected,
            p_value: value,
            p_expires_at: exp,
        });
        if (error) throw new Error(`kv.compareSet(${key}): ${error.message}`);
        return data === true;
    },

    async del(...keys: string[]): Promise<number> {
        if (!keys.length) return 0;
        const db = getSupabase();
        // Chunked so a bulk delete (server-reset, cleanup sweeps) can't build an
        // oversized .in() filter URL. DELETE itself has no row cap, but the
        // filter list rides the request line — keep it bounded like mget.
        let total = 0;
        for (const chunk of _chunkArray(keys, SUPABASE_IN_CHUNK)) {
            const { count, error } = await db.from('kv_store').delete({ count: 'exact' }).in('key', chunk);
            if (error) throw new Error(`kv.del: ${error.message}`);
            total += count ?? 0;
        }
        return total;
    },

    async delIfEqual(key: string, expected: unknown): Promise<boolean> {
        const db = getSupabase();
        // Retired Vercel/Supabase-REST backend — locks route to pgKv on
        // Railway/cPanel, so this is never on the real lock path. Filtering the
        // JSONB `value` column with a scalar .eq can be finicky in PostgREST, so
        // this fails SAFE: on ANY error it deletes nothing and returns false, so
        // the lock simply lingers to its short TTL rather than risking deleting a
        // different holder's lock. Never throws (a lock release must not error).
        const { count, error } = await db.from('kv_store').delete({ count: 'exact' }).eq('key', key).eq('value', expected as never);
        if (error) return false;
        return (count ?? 0) > 0;
    },

    async incr(key: string, options?: { ex?: number }): Promise<number> {
        const db = getSupabase();
        const exp = options?.ex ? expiresAt(options.ex) : null;
        const { data, error } = await db.rpc('kv_incr', { p_key: key, p_expires_at: exp });
        if (error) throw new Error(`kv.incr(${key}): ${error.message}`);
        return Number(data);
    },

    async keys(pattern: string): Promise<string[]> {
        const db = getSupabase();
        // Fetch key + expires_at and filter expiry client-side.
        // Avoid putting a timestamp inside .or() — the colons in ISO strings
        // confuse the PostgREST filter parser and cause consistent 500 errors.
        // Paginated: PostgREST truncates at max-rows (default 1000) without an
        // error, so a single-request scan silently drops matches past the cap.
        const rows = await _collectPaginated(async (from, to) => {
            const { data, error } = await db
                .from('kv_store').select('key, expires_at')
                .like('key', _toSqlPattern(pattern))
                .order('key')
                .range(from, to);
            if (error) throw new Error(`kv.keys(${pattern}): ${error.message}`);
            return (data ?? []) as { key: string; expires_at: string | null }[];
        });
        const now = Date.now();
        return rows
            .filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > now)
            .map((r) => r.key);
    },

    async mget<T extends unknown[] = unknown[]>(...keys: string[]): Promise<(T[number] | null)[]> {
        if (!keys.length) return [];
        const db = getSupabase();
        // Same pattern as keys(): fetch expires_at and filter client-side
        // to avoid the PostgREST timestamp colon parsing bug.
        // Chunked: a chunk of ≤ SUPABASE_IN_CHUNK keys can never exceed one
        // PostgREST page (so no silent truncation) and keeps the .in() filter
        // URL bounded. Input order and duplicate keys are preserved by the
        // final map-back over the caller's original key list.
        const map = new Map<string, unknown>();
        const now = Date.now();
        for (const chunk of _chunkArray(keys, SUPABASE_IN_CHUNK)) {
            const { data, error } = await db
                .from('kv_store').select('key, value, expires_at')
                .in('key', chunk);
            if (error) throw new Error(`kv.mget: ${error.message}`);
            for (const r of (data ?? []) as { key: string; value: unknown; expires_at: string | null }[]) {
                if (!r.expires_at || new Date(r.expires_at).getTime() > now) map.set(r.key, r.value);
            }
        }
        return keys.map((k) => (map.has(k) ? (map.get(k) as T[number]) : null));
    },

    async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
        return supabaseKv.get<T>(key);
    },

    async hkeys(key: string, options?: { nonEmptyStrings?: boolean }): Promise<string[]> {
        // REST backend has no keys-only projection — fall back to a full read.
        // Production runs pgKv, whose hkeys extracts the names in SQL; this
        // retired REST path stays correct on a large image hash, only slower.
        const all = await supabaseKv.hgetall<Record<string, unknown>>(key);
        if (!all || typeof all !== 'object') return [];
        return options?.nonEmptyStrings
            ? Object.entries(all).filter(([, value]) => typeof value === 'string' && value.length > 0).map(([field]) => field)
            : Object.keys(all);
    },

    async hset(key: string, fields: Record<string, unknown>): Promise<number> {
        const db = getSupabase();
        const { error } = await db.rpc('kv_hset', { p_key: key, p_fields: fields });
        if (error) {
            console.warn(`kv.hset RPC failed, using fallback: ${error.message}`);
            const existing = (await supabaseKv.get<Record<string, unknown>>(key)) ?? {};
            await supabaseKv.set(key, { ...existing, ...fields });
        }
        return Object.keys(fields).length;
    },

    async hdel(key: string, ...fields: string[]): Promise<number> {
        if (!fields.length) return 0;
        const db = getSupabase();
        const { error } = await db.rpc('kv_hdel', { p_key: key, p_fields: fields });
        if (error) {
            console.warn(`kv.hdel RPC failed, using fallback: ${error.message}`);
            const existing = (await supabaseKv.get<Record<string, unknown>>(key)) ?? {};
            for (const f of fields) delete existing[f];
            await supabaseKv.set(key, existing);
        }
        return fields.length;
    },
};

const guardedSupabaseKv = makeGuardedRestKv(supabaseKv, async request => {
    const { data, error } = await getSupabase().rpc('kv_guarded_operation', request);
    return { data, error };
}, _toSqlPattern, signalKeyWritten);

// ─── Shared helpers (in-memory QA backend) ──────────────────────────────────

function _patternToRegex(pattern: string): RegExp {
    return new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
}

/** JSONB-style structural equality (object key order is not significant). */
function _jsonValueEqual(a: unknown, b: unknown): boolean {
    const canonical = (value: unknown): string | null => {
        try {
            const visit = (node: unknown): unknown => {
                if (Array.isArray(node)) return node.map(visit);
                if (node && typeof node === 'object') {
                    const out: Record<string, unknown> = {};
                    for (const key of Object.keys(node as Record<string, unknown>).sort()) {
                        out[key] = visit((node as Record<string, unknown>)[key]);
                    }
                    return out;
                }
                return node;
            };
            const encoded = JSON.stringify(value);
            if (encoded === undefined) return null;
            return JSON.stringify(visit(JSON.parse(encoded)));
        } catch {
            return null;
        }
    };
    const left = canonical(a);
    return left !== null && left === canonical(b);
}

export interface KvLike {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, options?: { ex?: number; nx?: boolean }): Promise<'OK' | null>;
    /** Atomically replace a row only when its complete live JSON equals expected. */
    compareSet(key: string, expected: unknown | null, value: unknown, options?: { ex?: number }): Promise<boolean>;
    del(...keys: string[]): Promise<number>;
    /**
     * Atomically delete `key` only if its stored value still equals `expected`.
     * Returns true iff a row was deleted. This is the compare-and-delete a lease
     * lock needs on release (see api/_lock.ts): a plain get-then-del races the
     * case where the lock's TTL expired and a NEW holder re-acquired it between
     * the read and the delete — the old holder would then delete the new holder's
     * lock. A single conditional delete closes that window.
     *
     * Fails SAFE by construction: a backend that cannot match the complete JSON
     * value deletes nothing. Lock callers pass their owner string; publication
     * rollback callers may pass an immutable object row.
     */
    delIfEqual(key: string, expected: unknown): Promise<boolean>;
    // Atomic increment — returns the post-increment counter value. Backed by the
    // kv_incr RPC on Postgres/Supabase so the rate limiter can't be raced (a
    // read-then-set RMW let concurrent requests all read the same value and all
    // pass).
    incr(key: string, options?: { ex?: number }): Promise<number>;
    keys(pattern: string): Promise<string[]>;
    mget<T extends unknown[] = unknown[]>(...keys: string[]): Promise<(T[number] | null)[]>;
    /** Optional database-side projection for read-only views, never save authority. */
    mgetProjected?(keys: string[], projection: KvProjection): Promise<Array<Record<string, unknown> | null>>;
    hgetall<T = Record<string, unknown>>(key: string): Promise<T | null>;
    /**
     * KEYS-ONLY read of an object-valued key (hash field names, or the keys of
     * a plain JSON-object value). Exists because hgetall on the multi-megabyte
     * shared-image hashes transfers the whole blob just to list ids — hkeys
     * extracts the names where the data lives (SQL-side) and ships only
     * a few KB. Returns [] for a missing/empty/non-object value; THROWS on
     * transport failure (callers distinguish "empty" from "unavailable").
     */
    hkeys(key: string, options?: { nonEmptyStrings?: boolean }): Promise<string[]>;
    hset(key: string, fields: Record<string, unknown>): Promise<number>;
    hdel(key: string, ...fields: string[]): Promise<number>;
}

type MemoryKvEntry = { value: unknown; expiresAt: number | null };

/**
 * Process-local KV used only by the explicit story/release certification
 * harness. It mirrors the JSON isolation and TTL/NX/hash semantics that the
 * production adapters expose, while guaranteeing that a local QA run cannot
 * read or mutate staging/production storage.
 */
export function _makeMemoryKv(): KvLike {
    const entries = new Map<string, MemoryKvEntry>();
    const clone = <T>(value: T): T => structuredClone(value);
    const liveEntry = (key: string): MemoryKvEntry | null => {
        const entry = entries.get(key);
        if (!entry) return null;
        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
            entries.delete(key);
            return null;
        }
        return entry;
    };
    const write = (key: string, value: unknown, ex?: number): void => {
        entries.set(key, {
            value: clone(value),
            expiresAt: ex ? Date.now() + ex * 1000 : null,
        });
        signalKeyWritten(key);
    };

    return {
        async get<T = unknown>(key: string): Promise<T | null> {
            const entry = liveEntry(key);
            return entry ? clone(entry.value as T) : null;
        },
        async set(key, value, options) {
            if (options?.nx && liveEntry(key)) return null;
            write(key, value, options?.ex);
            return 'OK';
        },
        async compareSet(key, expected, value, options) {
            const entry = liveEntry(key);
            if (expected === null ? entry !== null : !entry || !_jsonValueEqual(entry.value, expected)) return false;
            write(key, value, options?.ex);
            return true;
        },
        async del(...keys) {
            let deleted = 0;
            for (const key of keys) {
                if (!entries.delete(key)) continue;
                deleted += 1;
                signalKeyWritten(key);
            }
            return deleted;
        },
        async delIfEqual(key, expected) {
            const entry = liveEntry(key);
            if (!entry || !_jsonValueEqual(entry.value, expected)) return false;
            entries.delete(key);
            signalKeyWritten(key);
            return true;
        },
        async incr(key, options) {
            const current = Number(liveEntry(key)?.value ?? 0);
            const next = current + 1;
            write(key, next, options?.ex);
            return next;
        },
        async keys(pattern) {
            const re = _patternToRegex(pattern);
            const keys: string[] = [];
            for (const key of entries.keys()) {
                if (liveEntry(key) && re.test(key)) keys.push(key);
            }
            return keys;
        },
        async mget<T extends unknown[] = unknown[]>(...keys: string[]): Promise<(T[number] | null)[]> {
            return keys.map((key) => {
                const entry = liveEntry(key);
                return entry ? clone(entry.value as T[number]) : null;
            });
        },
        async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
            const entry = liveEntry(key);
            return entry ? clone(entry.value as T) : null;
        },
        async hkeys(key, options) {
            const entry = liveEntry(key);
            if (!entry || !entry.value || typeof entry.value !== 'object' || Array.isArray(entry.value)) return [];
            const value = entry.value as Record<string, unknown>;
            return options?.nonEmptyStrings
                ? Object.entries(value).filter(([, fieldValue]) => typeof fieldValue === 'string' && fieldValue.length > 0).map(([field]) => field)
                : Object.keys(value);
        },
        async hset(key, fields) {
            const entry = liveEntry(key);
            const current = entry?.value && typeof entry.value === 'object' && !Array.isArray(entry.value)
                ? clone(entry.value as Record<string, unknown>)
                : {};
            let added = 0;
            for (const [field, value] of Object.entries(fields)) {
                if (!(field in current)) added += 1;
                current[field] = clone(value);
            }
            write(key, current);
            return added;
        },
        async hdel(key, ...fields) {
            const entry = liveEntry(key);
            if (!entry || !entry.value || typeof entry.value !== 'object' || Array.isArray(entry.value)) return 0;
            const current = clone(entry.value as Record<string, unknown>);
            let deleted = 0;
            for (const field of fields) {
                if (field in current) {
                    delete current[field];
                    deleted += 1;
                }
            }
            write(key, current);
            return deleted;
        },
    };
}

// ─── Export the right backend ─────────────────────────────────────────────────
//
// The base backend (Supabase / Postgres):
//   pgKv          if DATABASE_URL / SUPABASE_POSTGRES_URL is set
//   supabaseKv    otherwise
//
// Every key, including save:*, shared:images* and shared:imgfields*, lives in
// this one store. The retired cPanel disk overlay and its HTTP proxy, which
// used to hold those prefixes, were removed on 2026-10-02 after the 2026-07-17
// cutover (docs/RETIRE_CPANEL_RUNBOOK.md).

// On Vercel, always use the Supabase REST API regardless of which Postgres
// env vars are present. The Supabase Vercel integration auto-sets a pile of
// SUPABASE_POSTGRES_* vars that may not work from Vercel's network anyway.
// Set FORCE_PG_KV=1 to override and force the pg pool path.
/*
 * The backend is chosen on FIRST USE, not at module evaluation.
 *
 * It used to be chosen at import time, and that quietly dictated how every
 * storage-touching test had to be written. `SHINOBIX_QA_MEMORY_KV` selects the
 * in-memory backend, but ES imports are HOISTED — so a test that set the flag in
 * its own body had already lost: any static import of an app module that reaches
 * this file evaluated the selection first, the flag read as unset, and the suite
 * bound itself to the real Supabase client. It then died on its first call with
 *   "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
 * which points at credentials rather than at the import order that actually
 * caused it. api/_world-pvp-mercenary-freeze.test.ts sat red on that for a long
 * time, and the same trap was one static import away in ~27 other test files.
 *
 * Deferring the choice removes the ordering constraint entirely: the flag is read
 * when the first KV call happens, which is inside a test body or hook, long after
 * every import has settled.
 *
 * This is a Proxy rather than a hand-written delegate because `kv` is used as a
 * plain object in ways a fixed shim would break:
 *   - `mgetProjected` is OPTIONAL and only pgKv has it. api/_storage-projection.ts
 *     branches on `if (store.mgetProjected)`, so absence must read as undefined —
 *     a shim that always defined it would route Supabase/memory into a pg-only path.
 *   - tests assign and delete it (`kv.mgetProjected = ...`, `delete kv.mgetProjected`).
 *   - tests SPREAD it (`{ ...kv }`) and `Object.assign` it back, which needs
 *     ownKeys + getOwnPropertyDescriptor to report the backend's real shape.
 * The traps below cover exactly those. Descriptors are forced `configurable` since
 * the proxy target is empty, which is the invariant a spread would otherwise trip.
 *
 * Cost is a resolved-instance check plus a cached bound method per call — nothing
 * against a database round trip.
 */
const _onVercel = !!process.env.VERCEL;
let _resolvedBaseKv: KvLike | null = null;
const _boundBaseKvMembers = new Map<PropertyKey, unknown>();

function _resolveBaseKv(): KvLike {
    if (_resolvedBaseKv) return _resolvedBaseKv;
    const forcePg = process.env.FORCE_PG_KV === '1';
    const havePgUrl = !!(process.env.DATABASE_URL || process.env.SUPABASE_POSTGRES_URL);
    const qaMemoryKv = process.env.SHINOBIX_QA_MEMORY_KV === '1';
    if (qaMemoryKv && (process.env.NODE_ENV !== 'test' || _onVercel)) {
        throw new Error('[kv] SHINOBIX_QA_MEMORY_KV requires NODE_ENV=test and cannot run on Vercel.');
    }
    _resolvedBaseKv = qaMemoryKv
        ? _makeMemoryKv()
        : ((forcePg || (havePgUrl && !_onVercel)) ? pgKv : guardedSupabaseKv);
    if (qaMemoryKv) console.log('[kv] isolated in-memory QA backend active');
    return _resolvedBaseKv;
}

/** The resolved backend as a bag of properties, for the traps below. */
function _baseKvBacking(): Record<PropertyKey, unknown> {
    return _resolveBaseKv() as unknown as Record<PropertyKey, unknown>;
}

const _baseKv: KvLike = new Proxy({} as KvLike, {
    get(_target, prop) {
        const backend = _baseKvBacking();
        const value = backend[prop];
        if (typeof value !== 'function') return value;
        const cached = _boundBaseKvMembers.get(prop);
        if (cached) return cached;
        const bound = (value as (...args: unknown[]) => unknown).bind(backend);
        _boundBaseKvMembers.set(prop, bound);
        return bound;
    },
    set(_target, prop, value) {
        _boundBaseKvMembers.delete(prop);
        _baseKvBacking()[prop] = value;
        return true;
    },
    deleteProperty(_target, prop) {
        _boundBaseKvMembers.delete(prop);
        delete _baseKvBacking()[prop];
        return true;
    },
    defineProperty(_target, prop, descriptor) {
        // node:test's `t.mock.method(kv, 'mget')` installs its spy through
        // Object.defineProperty, not assignment. Without this trap the spy landed
        // on the (empty) proxy target instead of the backend, the real method kept
        // being called, and every "reads in ONE batch" performance test saw a call
        // count of 0. Restore goes through here too.
        _boundBaseKvMembers.delete(prop);
        return Reflect.defineProperty(_resolveBaseKv() as object, prop, descriptor);
    },
    has(_target, prop) {
        return Reflect.has(_resolveBaseKv() as object, prop);
    },
    ownKeys() {
        return Reflect.ownKeys(_resolveBaseKv() as object);
    },
    getOwnPropertyDescriptor(_target, prop) {
        const descriptor = Reflect.getOwnPropertyDescriptor(_resolveBaseKv() as object, prop);
        // The proxy target is empty, so a non-configurable report would violate
        // the invariant and throw on `{ ...kv }`.
        return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
});

/*
 * The reported saveStoreKind still reads the QA flag at load. That is
 * deliberate and is not the trap fixed above: it only reports which store
 * `save:*` resolves to; it does not choose a backend.
 */
const _qaMemoryKvAtLoad = process.env.SHINOBIX_QA_MEMORY_KV === '1';

export const kv = _baseKv;

/** Read-only capability check for the active supported base adapter. */
export async function storageLockFencingReady(): Promise<{ ok: boolean; backend: string }> {
    const backend = _resolveBaseKv();
    if (backend === pgKv) return { ok: true, backend: 'pg' };
    if (_qaMemoryKvAtLoad || process.env.SHINOBIX_QA_MEMORY_KV === '1') return { ok: true, backend: 'memory-qa' };
    try {
        const { data, error } = await getSupabase().rpc('kv_guarded_operation', { p_leases: [], p_operation: 'capability', p_args: {} });
        return { ok: !error && (data as { version?: number } | null)?.version === 1, backend: 'supabase-rest' };
    } catch { return { ok: false, backend: 'supabase-rest' }; }
}

// Which backend `save:*` keys resolve to, surfaced by /health?deep=1. Since the
// cPanel overlay retirement (2026-07-17; its code was removed 2026-10-02) every
// key lives in the base store, so production reports 'base-store'. Release
// health gates on this via EXPECTED_SAVE_STORE=base-store.
export const saveStoreKind: 'memory-qa' | 'base-store' = _qaMemoryKvAtLoad ? 'memory-qa' : 'base-store';

// The overlay's variables no longer select anything. Say so once at boot, so a
// stale deployment variable reads as config debt instead of as a working rollback.
const _retiredOverlayEnv = ['DISK_KV_DIR', 'KV_PROXY_URL', 'REQUIRE_DISK_OVERLAY'].filter((name) => process.env[name]);
if (_retiredOverlayEnv.length) {
    console.warn(`[kv] ignoring retired cPanel overlay setting(s): ${_retiredOverlayEnv.join(', ')}. The overlay was removed on 2026-10-02; every key is served from the base store.`);
}
