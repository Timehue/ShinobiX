import { kv } from '../_storage.js';
import { readKvProjection, type KvProjection } from '../_storage-projection.js';

import { sectorModelDisplayEnabled } from '../_release-flags.js';
import { isPlayerModel, readStarterWorldModel, type PlayerModel, type StarterWorldModel } from '../../shared/player-model-ref.js';

/** A cold presence start restores location and the equipped public art reference. */
export type SavedLocation = { currentSector?: number; currentTile?: number; worldPosition?: unknown; playerModel?: PlayerModel; starterWorldModel?: StarterWorldModel };

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
    const fields: KvProjection = sectorModelDisplayEnabled()
        ? {...SAVED_LOCATION, playerModel:['character','playerModel'], starterWorldModel:['character','starterWorldModel'],
            avatarImage:['character','avatarImage']} : SAVED_LOCATION;
    const [row] = await readKvProjection(kv, [`save:${saveName}`], fields);
    if (!row) return null;
    const {playerModel, starterWorldModel, avatarImage, ...location} = row;
    const starter = readStarterWorldModel(starterWorldModel, avatarImage);
    return {...location, ...(starter ? {starterWorldModel:starter} : {}),
        ...(isPlayerModel(playerModel) ? {playerModel:{assetId:playerModel.assetId,version:playerModel.version}} : {})};
}
