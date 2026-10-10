import { WORLD_BOSS_ASHFALL_MS, worldBossEventPosition, worldBossThreatenedVillage } from '../../shared/world-boss-event.js';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import type { WorldBossEventRecord } from './_event.js';

const villageStateKey = (village: string) => `game:village-state:${village.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

/** Apply the timeout consequence once. Call while holding the event record lock. */
export async function applyWorldBossRetreatPenalty(event: WorldBossEventRecord, now = Date.now()): Promise<void> {
    if (event.status !== 'retreated' || event.hp <= 0 || event.retreatPenaltyApplied) return;
    const position = worldBossEventPosition(event, now);
    const village = event.retreatPenaltyVillage ?? event.targetVillage ?? worldBossThreatenedVillage(position?.currentSector ?? -1);
    const key = villageStateKey(village);
    await withKvLock(key, async () => {
        const state = (await kv.get<Record<string, unknown>>(key)) ?? {};
        const receipts = state.worldBossAshfallReceipts && typeof state.worldBossAshfallReceipts === 'object'
            ? state.worldBossAshfallReceipts as Record<string, number>
            : {};
        const receiptUntil = Math.max(0, Math.floor(Number(receipts[event.eventId]) || 0));
        const until = event.retreatPenaltyUntil || receiptUntil || (now + WORLD_BOSS_ASHFALL_MS);
        if (!receiptUntil) {
            const nextReceipts = { ...receipts, [event.eventId]: until };
            const keys = Object.keys(nextReceipts);
            for (const oldKey of keys.slice(0, Math.max(0, keys.length - 50))) delete nextReceipts[oldKey];
            state.worldBossAshfallReceipts = nextReceipts;
            state.worldBossAshfallUntil = Math.max(Math.floor(Number(state.worldBossAshfallUntil) || 0), until);
            if ((await kv.set(key, state)) === null) throw new Error('World boss village penalty write rejected.');
        }
        event.retreatPenaltyVillage = village;
        event.retreatPenaltyUntil = until;
        event.retreatPenaltyApplied = true;
    }, { failClosed: true });
}
