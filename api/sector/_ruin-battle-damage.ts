import type { KvLike } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { RUIN_RESTORATIONS } from '../../shared/sector-ruin-restorations.js';
import { buildingSharedKey, sectorBuilding } from '../../shared/sector-buildings.js';
import { applyRuinBattleDamage } from '../../shared/sector-building-state.js';

/** A verified world PvP battle that ended in `sector` damages every ruin there.
 * The PvP terminal saga replays. A permanent per-building receipt records even
 * a no-op (bare ruin or daily cap), atomically with the observed building row.
 * Locks the building row (the shared resource), exact CAS write.
 * Returns the buildings actually damaged. Never throws on contention: the next
 * terminal replay retries a building it could not lock. */
export async function damageRuinsForWorldBattle(kv: Pick<KvLike, 'get' | 'compareSetMany'>, battleId: string, sector: number, now: number, battleAt = now): Promise<string[]> {
    if (!battleId || !Number.isSafeInteger(sector) || sector <= 0) return [];
    const compareSetMany = kv.compareSetMany?.bind(kv);
    if (!compareSetMany) {
        console.error('[ruins] atomic battle damage unavailable');
        return [];
    }
    const damaged: string[] = [];
    for (const { buildingId } of RUIN_RESTORATIONS) {
        if (sectorBuilding(buildingId)?.sector !== sector) continue;
        const key = buildingSharedKey(buildingId);
        const receiptKey = `${key}:battle:${encodeURIComponent(battleId)}`;
        try {
            await withKvLock(key, async () => {
                if (await kv.get(receiptKey) !== null) return;
                const raw = await kv.get<unknown>(key);
                const next = applyRuinBattleDamage(raw, battleId, now, battleAt);
                // No expiry: an old terminal replay must never hit later repairs.
                // Assert the no-op's snapshot too: a concurrent repair must cause
                // the entire transaction to fail, leaving this battle retryable.
                const committed = await compareSetMany([
                    next ? { op: 'cas', key, expected: raw ?? null, value: next }
                        : { op: 'assert', key, expected: raw ?? null },
                    { op: 'cas', key: receiptKey, expected: null, value: { battleAt } },
                ]);
                if (committed && next) damaged.push(buildingId);
            }, { failClosed: true });
        } catch (error) {
            console.error('[ruins] battle damage deferred', buildingId, error);
        }
    }
    return damaged;
}
