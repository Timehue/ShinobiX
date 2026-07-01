import type { KvLike } from './_storage.js';

type TokenStore = Pick<KvLike, 'get' | 'del'>;

/**
 * Consume a random single-use token whose value must be read before use.
 *
 * The delete rowcount is the actual consume gate: two racing callers can both
 * read the token, but only the caller whose delete removes a row may proceed.
 */
export async function consumeSingleUseToken<T>(store: TokenStore, key: string): Promise<T | null> {
    const token = await store.get<T>(key);
    if (!token) return null;
    const removed = await store.del(key);
    return removed > 0 ? token : null;
}
