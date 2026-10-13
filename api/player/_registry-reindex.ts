import type { PublicPlayerIndexEntry } from './_public-index.js';

/*
 * Server-side refresh of one player's public registry entry (the shared
 * `player:registry` row every leaderboard reads), after a server write changed
 * a leaderboard field (writeVersionedPlayerSave).
 *
 * `player:registry` is ONE row holding every player, and a hash write rewrites
 * the whole row. The owner's own autosave refreshes it at most once a minute
 * (api/save/_registry-throttle.ts). Server grants can be far more frequent (a
 * stat point per AI fight), so this applies the same budget per player:
 *
 *  - urgent fields (village, level, PvP kills, account name: the village/ANBU
 *    rankings act on them at once) are written immediately, as before;
 *  - any other change is written at most once per REINDEX_MIN_INTERVAL_MS, and
 *    the latest pending entry is flushed at the end of the window, so the
 *    boards still converge even if the player has logged off.
 *
 * Process-local, like the rest of the single-instance runtime. A pending entry
 * lost to a restart is restored by the player's next write or session.
 */
export const REINDEX_MIN_INTERVAL_MS = 60_000;

type HsetStore = { hset(key: string, fields: Record<string, unknown>): Promise<unknown> };
type Slot = { lastAt: number; pending: PublicPlayerIndexEntry | null; timer: ReturnType<typeof setTimeout> | null };

const slots = new Map<string, Slot>();
const PRUNE_AT = 5_000;

function prune(now: number): void {
    if (slots.size < PRUNE_AT) return;
    for (const [name, slot] of slots) {
        if (!slot.timer && now - slot.lastAt >= REINDEX_MIN_INTERVAL_MS) slots.delete(name);
    }
}

export async function reindexPublicPlayer(
    store: HsetStore,
    registryKey: string,
    name: string,
    entry: PublicPlayerIndexEntry,
    opts: { urgent: boolean; now?: number },
): Promise<void> {
    const now = opts.now ?? Date.now();
    prune(now);
    // Never written yet: the first refresh is always immediate.
    const slot = slots.get(name) ?? { lastAt: Number.NEGATIVE_INFINITY, pending: null, timer: null };
    slots.set(name, slot);
    if (opts.urgent || now - slot.lastAt >= REINDEX_MIN_INTERVAL_MS) {
        if (slot.timer) { clearTimeout(slot.timer); slot.timer = null; }
        slot.pending = null;
        slot.lastAt = now;
        await store.hset(registryKey, { [name]: entry });
        return;
    }
    // Inside the window: keep only the newest entry and flush it once.
    slot.pending = entry;
    if (slot.timer) return;
    slot.timer = setTimeout(() => {
        slot.timer = null;
        const pending = slot.pending;
        slot.pending = null;
        if (!pending) return;
        slot.lastAt = Date.now();
        void store.hset(registryKey, { [name]: pending }).catch((error) => {
            console.warn('[registry-reindex] deferred leaderboard refresh failed:', (error as Error)?.message ?? error);
        });
    }, Math.max(1, slot.lastAt + REINDEX_MIN_INTERVAL_MS - now));
    (slot.timer as { unref?: () => void }).unref?.();
}

/** Test-only. */
export function __resetRegistryReindexForTest(): void {
    for (const slot of slots.values()) if (slot.timer) clearTimeout(slot.timer);
    slots.clear();
}
