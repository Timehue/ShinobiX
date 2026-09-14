import { kv as realKv, type KvLike } from '../_storage.js';
import { safeName } from '../_utils.js';

/*
 * The tile a player last STOOD ON inside a sector (F03).
 *
 * A travel lease settle persists the ARRIVAL tile onto the save, so a reload
 * used to put the player back on the road they came in by — not the spot
 * they had walked to since. Walking is a few hundred milliseconds a step and
 * the field heartbeat is every three seconds, so the save (a versioned,
 * lock-fenced document that settles regeneration on every write) is the wrong
 * place for it. This is a small dedicated key instead:
 *
 *   walked-tile:<slug>  →  { sector, tile, at }   (24 h TTL)
 *
 * Written only by the HTTP heartbeat, only when the tile changed, and at most
 * once per WALKED_TILE_MIN_INTERVAL_MS per player — a change inside the window
 * is carried as dirty and written by the next beat, so the spot a player
 * stopped on is durable within a beat or two of stopping. The travel-lease
 * settle records the arrival tile here too, so a later visit to the same
 * sector never resumes on a stale walk from an earlier one. The owner's save
 * read and the heartbeat's cold start prefer this tile over the arrival tile
 * whenever the sector matches; nothing else reads it.
 */

export const WALKED_TILE_TTL_SECONDS = 24 * 60 * 60;
export const WALKED_TILE_MIN_INTERVAL_MS = 5_000;

export type WalkedTile = { sector: number; tile: number; at: number };

export type WalkedTileStore = Pick<KvLike, 'get' | 'set' | 'del'>;

export function walkedTileKey(playerName: string): string {
    return `walked-tile:${safeName(playerName)}`;
}

export function isWalkedTile(value: unknown): value is WalkedTile {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const w = value as Partial<WalkedTile>;
    return Number.isInteger(w.sector) && (w.sector as number) >= 1
        && Number.isInteger(w.tile) && (w.tile as number) >= 0 && (w.tile as number) <= 143
        && Number.isFinite(w.at);
}

export async function readWalkedTile(store: Pick<KvLike, 'get'>, playerName: string): Promise<WalkedTile | null> {
    const value = await store.get<unknown>(walkedTileKey(playerName));
    return isWalkedTile(value) ? value : null;
}

/** The tile to resume on for `sector`: the walked tile when it is for that sector, else the arrival tile. */
export function resumeTileFor(walked: WalkedTile | null | undefined, sector: number, arrivalTile: unknown): number | undefined {
    if (walked && walked.sector === sector) return walked.tile;
    const arrival = Number(arrivalTile);
    return Number.isInteger(arrival) && arrival >= 0 && arrival <= 143 ? arrival : undefined;
}

// Per-process throttle state. Presence itself is per-process, so this needs no
// more durability than the heartbeat's own memory of the player.
type Throttle = { sector: number; tile: number; writtenAt: number; dirty: boolean };
const throttles = new Map<string, Throttle>();

export function resetWalkedTileThrottleForTests(): void {
    throttles.clear();
}

/**
 * Called on every heartbeat with the presence row's sector and tile. Writes
 * the key when the tile changed and the throttle window has passed; a change
 * inside the window is remembered and written by a later beat. Never throws
 * and never blocks the beat: the write is fire-and-forget.
 */
export function noteWalkedTile(
    store: WalkedTileStore,
    playerName: string,
    sector: number,
    tile: number | undefined,
    now: number = Date.now(),
): Promise<boolean> {
    const slug = safeName(playerName);
    if (!slug || !Number.isInteger(sector) || sector < 1 || tile === undefined || !Number.isInteger(tile)) return Promise.resolve(false);
    const prior = throttles.get(slug);
    const changed = !prior || prior.sector !== sector || prior.tile !== tile;
    if (!changed && !prior?.dirty) return Promise.resolve(false);
    if (prior && now - prior.writtenAt < WALKED_TILE_MIN_INTERVAL_MS) {
        throttles.set(slug, { sector, tile, writtenAt: prior.writtenAt, dirty: true });
        return Promise.resolve(false);
    }
    throttles.set(slug, { sector, tile, writtenAt: now, dirty: false });
    const row: WalkedTile = { sector, tile, at: now };
    return store.set(walkedTileKey(slug), row, { ex: WALKED_TILE_TTL_SECONDS })
        .then(() => true)
        .catch(() => {
            // A failed write is retried by the next beat that sees the tile.
            const current = throttles.get(slug);
            if (current && current.sector === sector && current.tile === tile) throttles.set(slug, { ...current, dirty: true });
            return false;
        });
}

/**
 * A settled arrival is the newest thing known about where the player stands.
 * Recorded unthrottled so a later visit to the same sector never resumes on
 * a stale walk; an arrival with no tile clears the key for the same reason.
 */
export async function recordArrivalTile(
    store: WalkedTileStore,
    playerName: string,
    sector: number,
    tile: number | undefined,
    now: number = Date.now(),
): Promise<void> {
    const slug = safeName(playerName);
    if (!slug) return;
    if (tile === undefined || !Number.isInteger(tile) || !Number.isInteger(sector) || sector < 1) {
        throttles.delete(slug);
        await store.del(walkedTileKey(slug));
        return;
    }
    throttles.set(slug, { sector, tile, writtenAt: now, dirty: false });
    await store.set(walkedTileKey(slug), { sector, tile, at: now } satisfies WalkedTile, { ex: WALKED_TILE_TTL_SECONDS });
}

/** Production store, for callers that do not inject one. */
export const walkedTileStore: WalkedTileStore = realKv;
