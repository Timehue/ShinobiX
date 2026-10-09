import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { cleanSectorPoolRow, sectorPoolKey, sectorPoolCap, SECTOR_POOL_LOCK, SECTOR_POOL_TTL_SECONDS, type SectorPoolOwner } from './_sector-pool.js';

/** The debit and reservation receipt share a pool-row write. Lock order is save ->
 * pool, matching Explore. A lost response can recover the same slot by tx id. */
export async function reserveResourcePool(sector: number, village: string, now: number, owner: SectorPoolOwner, txId: string) {
    const key = sectorPoolKey(sector, now);
    return withKvLock(key, async () => {
        const row = cleanSectorPoolRow(await kv.get(key));
        if (row.resourceReservations?.[txId]) return true;
        if (row.explores >= sectorPoolCap('explores', owner.ownerVillage, village)) return false;
        await kv.set(key, { ...row, explores: row.explores + 1,
            resourceReservations: { ...row.resourceReservations, [txId]: 'reserved' } }, { ex: SECTOR_POOL_TTL_SECONDS });
        return true;
    }, SECTOR_POOL_LOCK);
}
export async function finishResourcePool(sector: number, now: number, txId: string, committed: boolean) {
    const key = sectorPoolKey(sector, now);
    await withKvLock(key, async () => {
        const row = cleanSectorPoolRow(await kv.get(key)), prior = row.resourceReservations?.[txId];
        if (!prior || prior === 'committed') return;
        const reservations = { ...row.resourceReservations };
        if (committed) reservations[txId] = 'committed'; else delete reservations[txId];
        await kv.set(key, { ...row, explores: row.explores - (committed ? 0 : 1), resourceReservations: reservations }, { ex: SECTOR_POOL_TTL_SECONDS });
    }, SECTOR_POOL_LOCK);
}
