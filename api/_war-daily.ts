/*
 * Village War Map — the daily village pass (IO orchestration, Phase 1). §8.1
 *
 * Once per UTC day, for each of the 4 villages, under a lock on its war-state
 * record: accrue WR for the sectors it holds, pay structure upkeep (or mothball),
 * expire merc leases, stamp the day. Idempotent (the pure step no-ops on a re-run
 * the same day), so a double-fire is harmless.
 *
 * SERVER-GATED, default OFF: returns immediately unless ENABLE_VILLAGE_WAR=1.
 * (Feature flags are client-side; a cron pass needs a server-side gate, mirroring
 * the DISABLE_SNAPSHOT_CRON convention.) Nothing player-visible runs until that
 * env is set on the single always-on instance.
 *
 * The pure math lives in stepVillageWarDay (api/_war-state.ts); this is the thin
 * IO wrapper. Underscore-prefixed → a helper, not a route.
 */

import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { sectorBenefitSeals } from './_war-economy.js';
import { recordWarEcoEvent } from './_war-telemetry.js';
import { WAR_VILLAGES, homeSectorsForVillage } from './_war-map-sectors.js';
import {
    normalizeVillageWarRecord,
    stepVillageWarDay,
    villageWarKey,
    villageWarSlug,
    type VillageWarRecord,
} from './_war-state.js';
import { wrPerSector } from './_war-structures.js';

/** The existing village-treasury key (seal accrual target). Same slug as the
 *  war-state key and api/village/claim-daily-agenda.ts. */
function villageStateKey(village: string): string {
    return `game:village-state:${villageWarSlug(village)}`;
}
function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function utcDateString(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
}

// Phase 1: no sector captures exist yet, so a village controls exactly its 8 home
// sectors. (Phase 4 replaces this with held-home + occupied-enemy once the
// sector-war engine tracks ownership.)
function sectorsControlledForVillage(village: string): number {
    return homeSectorsForVillage(village).length;
}

// Minimal injectable surfaces so the pass is unit-testable with an in-memory store.
type WarStore = { get<T = unknown>(key: string): Promise<T | null>; set(key: string, value: unknown): Promise<unknown> };
type LockRunner = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

export interface VillageWarDailyResult {
    enabled: boolean;
    processed: number;
    ran: number;
    sealsAccrued: number;
}

/** Run the daily pass across all villages. Default deps use the live kv + lock;
 *  tests inject an in-memory store + passthrough lock and `enabled: true`. */
export async function runVillageWarDailyPass(
    deps: { store?: WarStore; lock?: LockRunner; now?: number; enabled?: boolean } = {},
): Promise<VillageWarDailyResult> {
    const enabled = deps.enabled ?? (process.env.ENABLE_VILLAGE_WAR === '1');
    if (!enabled) return { enabled: false, processed: 0, ran: 0, sealsAccrued: 0 };

    const store: WarStore = deps.store ?? kv;
    const lock: LockRunner = deps.lock ?? ((key, fn) => withKvLock(key, fn, { failClosed: true }));
    const now = deps.now ?? Date.now();
    const today = utcDateString(now);

    let ran = 0;
    let sealsAccrued = 0;
    for (const village of WAR_VILLAGES) {
        const key = villageWarKey(village);
        const sectors = sectorsControlledForVillage(village);
        try {
            let ranThisVillage = false;
            await lock(key, async () => {
                const raw = await store.get<Partial<VillageWarRecord>>(key);
                const record = normalizeVillageWarRecord(village, raw ?? undefined);
                const { record: next, summary } = stepVillageWarDay(record, {
                    sectorsControlled: sectors,
                    today,
                    now,
                    wrPerSector: wrPerSector(record), // Supply-Depot-boosted income
                });
                if (summary.ran) {
                    await store.set(key, next);
                    ran++;
                    ranThisVillage = true;
                    // Telemetry (best-effort, same store): the day's WR faucet, upkeep
                    // sink, and any dormancy transition. eventId is keyed per
                    // village/day so the idempotent pass can't double-count.
                    const slug = villageWarSlug(village);
                    if (summary.wrAccrued > 0) void recordWarEcoEvent({ eventId: `wr-earn:${slug}:${today}`, village, kind: 'wr.earn', amount: summary.wrAccrued, ts: now }, { kv: store });
                    if (summary.maintenancePaid > 0) void recordWarEcoEvent({ eventId: `wr-maint:${slug}:${today}`, village, kind: 'wr.spend.maintenance', amount: summary.maintenancePaid, ts: now }, { kv: store });
                    if (!record.dormant && summary.dormant) void recordWarEcoEvent({ eventId: `dormancy-enter:${slug}:${today}`, village, kind: 'dormancy.enter', amount: 1, ts: now }, { kv: store });
                    if (record.dormant && !summary.dormant) void recordWarEcoEvent({ eventId: `dormancy-exit:${slug}:${today}`, village, kind: 'dormancy.exit', amount: 1, ts: now }, { kv: store });
                }
            });

            // Seal accrual → existing village treasury, once per fresh daily run
            // (gated on the war-record step having run, which is itself idempotent).
            if (ranThisVillage) {
                const seals = sectorBenefitSeals(sectors);
                if (seals > 0) {
                    const stateKey = villageStateKey(village);
                    await lock(stateKey, async () => {
                        const state = (await store.get<Record<string, unknown>>(stateKey)) ?? {};
                        const treasury = (state.treasury ?? {}) as Record<string, unknown>;
                        await store.set(stateKey, {
                            ...state,
                            treasury: { ...treasury, honorSeals: num(treasury.honorSeals) + seals },
                        });
                        sealsAccrued += seals;
                        void recordWarEcoEvent({ eventId: `seals-earn:${villageWarSlug(village)}:${today}`, village, kind: 'seals.earn', amount: seals, ts: now }, { kv: store });
                    });
                }
            }
        } catch (err) {
            console.error(`[village-war] daily pass failed for ${village}:`, (err as Error).message);
        }
    }
    return { enabled: true, processed: WAR_VILLAGES.length, ran, sealsAccrued };
}
