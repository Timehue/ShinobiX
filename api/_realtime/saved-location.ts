import { kv } from '../_storage.js';
import { readKvProjection, type KvProjection } from '../_storage-projection.js';

/** The only save fields a cold presence start reads: where the player last stood. */
export type SavedLocation = { currentSector?: number; currentTile?: number; worldPosition?: unknown };

const SAVED_LOCATION: KvProjection = {
    currentSector: ['currentSector'],
    currentTile: ['currentTile'],
    worldPosition: ['worldPosition'],
};

/**
 * Read where a player last stood, without the rest of their save.
 *
 * The cold-start heartbeat and the socket's first presence used to `kv.get`
 * the whole save (80-200 KB, never cached: `save:` is a no-cache prefix) to
 * use these three top-level fields, and every login runs both. The projection
 * returns the same values from the same stored row: a missing row is null, and
 * a field the row lacks stays absent, exactly as `saved?.field` saw it.
 *
 * `saveName` is the exact key suffix the caller already used; it is not
 * re-normalized here, so the row read is unchanged.
 */
export async function readSavedLocation(saveName: string): Promise<SavedLocation | null> {
    const [row] = await readKvProjection(kv, [`save:${saveName}`], SAVED_LOCATION);
    return (row ?? null) as SavedLocation | null;
}
