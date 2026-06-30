"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.runVillageWarDailyPass = runVillageWarDailyPass;
const _storage_js_1 = require("./_storage.js");
const _lock_js_1 = require("./_lock.js");
const _war_economy_js_1 = require("./_war-economy.js");
const _war_telemetry_js_1 = require("./_war-telemetry.js");
const _war_map_sectors_js_1 = require("./_war-map-sectors.js");
const _war_state_js_1 = require("./_war-state.js");
const _war_structures_js_1 = require("./_war-structures.js");
/** The existing village-treasury key (seal accrual target). Same slug as the
 *  war-state key and api/village/claim-daily-agenda.ts. */
function villageStateKey(village) {
    return `game:village-state:${(0, _war_state_js_1.villageWarSlug)(village)}`;
}
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function utcDateString(now) {
    return new Date(now).toISOString().slice(0, 10);
}
// Phase 1: no sector captures exist yet, so a village controls exactly its 8 home
// sectors. (Phase 4 replaces this with held-home + occupied-enemy once the
// sector-war engine tracks ownership.)
function sectorsControlledForVillage(village) {
    return (0, _war_map_sectors_js_1.homeSectorsForVillage)(village).length;
}
/** Run the daily pass across all villages. Default deps use the live kv + lock;
 *  tests inject an in-memory store + passthrough lock and `enabled: true`. */
async function runVillageWarDailyPass(deps = {}) {
    const enabled = deps.enabled ?? (process.env.ENABLE_VILLAGE_WAR === '1');
    if (!enabled)
        return { enabled: false, processed: 0, ran: 0, sealsAccrued: 0 };
    const store = deps.store ?? _storage_js_1.kv;
    const lock = deps.lock ?? ((key, fn) => (0, _lock_js_1.withKvLock)(key, fn, { failClosed: true }));
    const now = deps.now ?? Date.now();
    const today = utcDateString(now);
    let ran = 0;
    let sealsAccrued = 0;
    for (const village of _war_map_sectors_js_1.WAR_VILLAGES) {
        const key = (0, _war_state_js_1.villageWarKey)(village);
        const sectors = sectorsControlledForVillage(village);
        try {
            let ranThisVillage = false;
            await lock(key, async () => {
                const raw = await store.get(key);
                const record = (0, _war_state_js_1.normalizeVillageWarRecord)(village, raw ?? undefined);
                const { record: next, summary } = (0, _war_state_js_1.stepVillageWarDay)(record, {
                    sectorsControlled: sectors,
                    today,
                    now,
                    wrPerSector: (0, _war_structures_js_1.wrPerSector)(record), // Supply-Depot-boosted income
                });
                if (summary.ran) {
                    await store.set(key, next);
                    ran++;
                    ranThisVillage = true;
                    // Telemetry (best-effort, same store): the day's WR faucet, upkeep
                    // sink, and any dormancy transition. eventId is keyed per
                    // village/day so the idempotent pass can't double-count.
                    const slug = (0, _war_state_js_1.villageWarSlug)(village);
                    if (summary.wrAccrued > 0)
                        void (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: `wr-earn:${slug}:${today}`, village, kind: 'wr.earn', amount: summary.wrAccrued, ts: now }, { kv: store });
                    if (summary.maintenancePaid > 0)
                        void (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: `wr-maint:${slug}:${today}`, village, kind: 'wr.spend.maintenance', amount: summary.maintenancePaid, ts: now }, { kv: store });
                    if (!record.dormant && summary.dormant)
                        void (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: `dormancy-enter:${slug}:${today}`, village, kind: 'dormancy.enter', amount: 1, ts: now }, { kv: store });
                    if (record.dormant && !summary.dormant)
                        void (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: `dormancy-exit:${slug}:${today}`, village, kind: 'dormancy.exit', amount: 1, ts: now }, { kv: store });
                }
            });
            // Seal accrual → existing village treasury, once per fresh daily run
            // (gated on the war-record step having run, which is itself idempotent).
            if (ranThisVillage) {
                const seals = (0, _war_economy_js_1.sectorBenefitSeals)(sectors);
                if (seals > 0) {
                    const stateKey = villageStateKey(village);
                    await lock(stateKey, async () => {
                        const state = (await store.get(stateKey)) ?? {};
                        const treasury = (state.treasury ?? {});
                        await store.set(stateKey, {
                            ...state,
                            treasury: { ...treasury, honorSeals: num(treasury.honorSeals) + seals },
                        });
                        sealsAccrued += seals;
                        void (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: `seals-earn:${(0, _war_state_js_1.villageWarSlug)(village)}:${today}`, village, kind: 'seals.earn', amount: seals, ts: now }, { kv: store });
                    });
                }
            }
        }
        catch (err) {
            console.error(`[village-war] daily pass failed for ${village}:`, err.message);
        }
    }
    return { enabled: true, processed: _war_map_sectors_js_1.WAR_VILLAGES.length, ran, sealsAccrued };
}
