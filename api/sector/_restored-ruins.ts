import type { KvLike } from '../_storage.js';
import { RUIN_RESTORATIONS } from '../../shared/sector-ruin-restorations.js';
import { buildingSharedKey, sectorBuilding } from '../../shared/sector-buildings.js';
import { readSharedBuilding } from '../../shared/sector-building-state.js';

export type RestoredRuin = { id: string; sector: number; intactUntil: number };

/** Ruins standing restored right now, for every sector at once. The public world
 * snapshot carries this so neighbouring sectors paint restorations before a
 * player walks into them. Ten point reads; callers cache the result. */
export async function readRestoredRuins(kv: Pick<KvLike, 'get'>, now: number): Promise<RestoredRuin[]> {
    const rows = await Promise.all(RUIN_RESTORATIONS.map(async ({ buildingId }) => {
        const building = sectorBuilding(buildingId);
        if (!building) return undefined;
        const shared = readSharedBuilding(await kv.get(buildingSharedKey(buildingId)), { now });
        return shared.stage === 3 && shared.intactUntil ? { id: buildingId, sector: building.sector, intactUntil: shared.intactUntil } : undefined;
    }));
    return rows.filter((row): row is RestoredRuin => !!row);
}
