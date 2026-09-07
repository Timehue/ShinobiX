import type { KvLike } from './_storage.js';

/** Output field -> JSON path. Only server-owned read models choose these paths. */
export type KvProjection = Readonly<Record<string, readonly string[]>>;

export function projectKvValue(value: unknown, projection: KvProjection): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const fields: Array<[string, unknown]> = [];
    for (const [field, path] of Object.entries(projection)) {
        let selected: unknown = value;
        for (const part of path) {
            if (!selected || typeof selected !== 'object' || !Object.hasOwn(selected, part)) {
                selected = undefined;
                break;
            }
            selected = (selected as Record<string, unknown>)[part];
        }
        // Missing fields remain absent; explicit JSON null remains present.
        if (selected !== undefined) fields.push([field, selected]);
    }
    return Object.fromEntries(fields);
}

/** Never persist these partial records or put them in the full-value read cache. */
export async function readKvProjection(
    store: Pick<KvLike, 'mget' | 'mgetProjected'>,
    keys: string[],
    projection: KvProjection,
): Promise<Array<Record<string, unknown> | null>> {
    if (!keys.length) return [];
    if (store.mgetProjected) return store.mgetProjected(keys, projection);
    // Compatibility stores retain their existing routing, batching, and expiry
    // semantics. Projection happens after the read on those backends.
    const values = await store.mget(...keys);
    return values.map(value => projectKvValue(value, projection));
}
