import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { cleanWorldExploreAuthorityReceipt, worldExploreAuthorityKey, WORLD_EXPLORE_RECEIPT_TTL_SECONDS, type WorldExploreAuthorityReceipt } from './_explore-authority.js';

/** A delayed discovery write must never erase proof that its chest was paid. */
export async function storeWorldExploreAuthority(receipt: WorldExploreAuthorityReceipt): Promise<WorldExploreAuthorityReceipt> {
    const key = worldExploreAuthorityKey(receipt.playerName, receipt.requestId);
    return withKvLock(key, async () => {
        const current = cleanWorldExploreAuthorityReceipt(await kv.get(key));
        if (current?.outcome?.openedLoot) return current;
        await kv.set(key, receipt, { ex: WORLD_EXPLORE_RECEIPT_TTL_SECONDS });
        return receipt;
    }, { failClosed: true });
}
