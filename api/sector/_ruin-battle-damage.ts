import type { KvLike } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { RUIN_RESTORATIONS } from '../../shared/sector-ruin-restorations.js';
import { buildingSharedKey, sectorBuilding } from '../../shared/sector-buildings.js';
import { applyRuinBattleDamage } from '../../shared/sector-building-state.js';

/** A verified world PvP battle that ended in `sector` damages every ruin there.
 * The PvP terminal saga replays, so each building records the battle id and
 * counts it once. Locks the building row (the shared resource), exact CAS write.
 * Returns the buildings actually damaged. Never throws on contention: the next
 * terminal replay retries a building it could not lock. */
export async function damageRuinsForWorldBattle(kv: Pick<KvLike, 'get' | 'compareSet'>, battleId: string, sector: number, now: number, battleAt = now): Promise<string[]> {
    if (!battleId || !Number.isSafeInteger(sector) || sector <= 0) return [];
    const damaged: string[] = [];
    for (const { buildingId } of RUIN_RESTORATIONS) {
        if (sectorBuilding(buildingId)?.sector !== sector) continue;
        const key = buildingSharedKey(buildingId);
        try {
            await withKvLock(key, async () => {
                const raw = await kv.get<unknown>(key);
                const next = applyRuinBattleDamage(raw, battleId, now, battleAt);
                if (next && await kv.compareSet(key, raw ?? null, next)) damaged.push(buildingId);
            }, { failClosed: true });
        } catch (error) {
            console.error('[ruins] battle damage deferred', buildingId, error);
        }
    }
    return damaged;
}
