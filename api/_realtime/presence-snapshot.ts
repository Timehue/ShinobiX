/**
 * Persist live presence across a process restart.
 *
 * Presence lives in process memory (see online-store.ts), which is correct for a
 * single Railway container but means EVERY deploy blanks the online roster: players
 * vanish from each other's sectors, the online dot goes dark, and "N online" reads 0
 * until each client's next heartbeat lands. On a 100-200 player server, perceived
 * population is most of what makes the world feel alive, so a routine deploy briefly
 * looked like an empty game.
 *
 * This writes a tiny identity-only snapshot and restores it on boot. Deliberately
 * modest by design:
 *   • Identity + sector + timestamps only — no character blob, so the payload stays a
 *     few KB even at 200 players and the periodic write is negligible.
 *   • The stored value carries a TTL and every row is re-checked against the offline
 *     window on restore, so a stale snapshot resurrects nobody.
 *   • Never overwrites a live entry: a heartbeat that already reached the new process
 *     is fresher than any snapshot.
 *
 * Best-effort throughout. Presence is soft state — a failed snapshot or restore must
 * never block a boot or a shutdown, so every path swallows its errors.
 */
import { kv } from '../_storage.js';
import { MemoryOnlineStateStore, OFFLINE_AFTER_MS, onlineStore, type PresenceSnapshotRow } from './online-store.js';

const SNAPSHOT_KEY = 'presence:snapshot';
/** TTL slightly above the offline window so an abandoned snapshot expires on its own. */
const SNAPSHOT_TTL_SEC = Math.ceil((OFFLINE_AFTER_MS * 1.5) / 1000);
/**
 * Periodic cadence. A graceful shutdown snapshots explicitly, so this only covers a
 * HARD stop (OOM, SIGKILL, platform eviction). 30s keeps the worst-case loss under
 * one offline window while costing one small write per half minute.
 */
const SNAPSHOT_INTERVAL_MS = 30_000;

type SnapshotCapable = { snapshot(): PresenceSnapshotRow[]; restore(rows: readonly PresenceSnapshotRow[]): number };

/** The concrete in-memory store exposes snapshot/restore; other impls may not. */
function capableStore(): SnapshotCapable | null {
    return onlineStore instanceof MemoryOnlineStateStore ? (onlineStore as unknown as SnapshotCapable) : null;
}

export async function savePresenceSnapshot(): Promise<number> {
    const store = capableStore();
    if (!store) return 0;
    try {
        const rows = store.snapshot();
        // Nothing online: clear rather than storing an empty array, so a later boot
        // does not read a stale non-empty snapshot that this one should have replaced.
        if (rows.length === 0) {
            await kv.del(SNAPSHOT_KEY).catch(() => undefined);
            return 0;
        }
        await kv.set(SNAPSHOT_KEY, { at: Date.now(), rows }, { ex: SNAPSHOT_TTL_SEC });
        return rows.length;
    } catch {
        return 0; // soft state — never let a snapshot failure surface
    }
}

export async function restorePresenceSnapshot(): Promise<number> {
    const store = capableStore();
    if (!store) return 0;
    try {
        const stored = await kv.get<{ at?: number; rows?: PresenceSnapshotRow[] }>(SNAPSHOT_KEY);
        const rows = Array.isArray(stored?.rows) ? stored!.rows : [];
        if (rows.length === 0) return 0;
        return store.restore(rows);
    } catch {
        return 0;
    }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the periodic snapshot. Idempotent. */
export function startPresenceSnapshots(): void {
    if (timer !== null) return;
    timer = setInterval(() => { void savePresenceSnapshot(); }, SNAPSHOT_INTERVAL_MS);
    // Never hold the process open on this timer.
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
        (timer as { unref: () => void }).unref();
    }
}

export function stopPresenceSnapshots(): void {
    if (timer !== null) { clearInterval(timer); timer = null; }
}
