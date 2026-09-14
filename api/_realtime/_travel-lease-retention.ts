import type { KvLike } from '../_storage.js';
import { parseTravelLease } from './travel-lease.js';

/** Preserve legacy obligations without changing their value or reviving one
 * that another request settled. Read-only unless apply is explicitly true. */
export async function retainTravelLeases(store: Pick<KvLike, 'keys' | 'get' | 'compareSet'>, apply = false) {
    const summary = { apply, scanned: 0, valid: 0, retained: 0, changedDuringScan: 0, invalid: 0 };
    for (const key of await store.keys('world:travel-lease:*')) {
        summary.scanned++;
        const raw = await store.get(key);
        if (raw === null) { summary.changedDuringScan++; continue; }
        if (!parseTravelLease(raw)) { summary.invalid++; continue; }
        summary.valid++;
        if (!apply) continue;
        if (await store.compareSet(key, raw, raw)) summary.retained++;
        else summary.changedDuringScan++;
    }
    return summary;
}
