import { kv } from './_storage.js';
import { readKvProjection, type KvProjection } from './_storage-projection.js';

/**
 * The save fields a location entry, step or room roster decides on: name
 * (display), village (war objectives and sides), level (admission) and the
 * three isIncapacitated reads. Strongholds and the golden war shrine used to
 * read whole saves, hundreds of KB each, on every tile; Postgres now extracts
 * these where the save lives.
 */
export const SAVE_PRESENCE_FACTS: KvProjection = {
    name: ['character', 'name'],
    village: ['character', 'village'],
    level: ['character', 'level'],
    hp: ['character', 'hp'],
    hospitalized: ['character', 'hospitalized'],
    hospitalizedUntil: ['character', 'hospitalizedUntil'],
};

export type SavePresenceFacts = { character?: Record<string, unknown> } | null;

/**
 * One projected read for every name, in order. A missing save is null. A save
 * whose character holds none of the fields falls back to the whole read, so
 * every check decides exactly as it did on the full save.
 */
export async function readSavePresenceFacts(names: readonly string[]): Promise<SavePresenceFacts[]> {
    if (!names.length) return [];
    const keys = names.map(name => `save:${name}`);
    const rows = await readKvProjection(kv, keys, SAVE_PRESENCE_FACTS);
    return Promise.all(rows.map((row, index) => {
        if (!row) return null;
        if (Object.keys(row).length > 0) return { character: row };
        return kv.get<{ character?: Record<string, unknown> }>(keys[index]);
    }));
}
