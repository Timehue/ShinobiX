import { readKvProjection, type KvProjection } from '../_storage-projection.js';
import type { KvLike } from '../_storage.js';
import { PUBLIC_INDEX_CHARACTER_FIELDS } from './_public-index.js';

export const PUBLIC_INDEX_SAVE_PROJECTION: KvProjection = Object.fromEntries(
    PUBLIC_INDEX_CHARACTER_FIELDS.map(field => [field, ['character', field]]),
);

/** Review still needs complete submitted bloodlines; unrelated game state does not. */
export const ADMIN_PLAYER_SAVE_PROJECTION: KvProjection = {
    name: ['character', 'name'], level: ['character', 'level'], village: ['character', 'village'],
    specialty: ['character', 'specialty'], savedBloodlines: ['savedBloodlines'],
};

export async function readPublicIndexCharacters(store: Pick<KvLike, 'mget' | 'mgetProjected'>, keys: string[]) {
    const characters = await readKvProjection(store, keys, PUBLIC_INDEX_SAVE_PROJECTION);
    // A legacy empty character and an absent character both project to {}.
    // Preserve the old distinction, with one bounded batch for ambiguous rows.
    const ambiguous = characters.flatMap((character, index) => character && Object.keys(character).length === 0 ? [index] : []);
    if (ambiguous.length) {
        const originals = await store.mget<Record<string, unknown>[]>(...ambiguous.map(index => keys[index]!));
        ambiguous.forEach((index, offset) => {
            characters[index] = (originals[offset]?.character ?? null) as Record<string, unknown> | null;
        });
    }
    return characters;
}
