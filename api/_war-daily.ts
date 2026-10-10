/*
 * Village War Map — the daily village pass (IO orchestration, Phase 1). §8.1
 *
 * Once per UTC day (03:00, api/cron/_scheduler.ts), for each of the 4 villages:
 *   1. WAR RECORD — under a lock on its war-state record: reset the per-war
 *      structures if the village is at peace, then accrue WR for the war sectors
 *      it holds, pay structure upkeep (or mothball), expire merc leases and stamp
 *      the day (`lastWarPassDate`);
 *   2. SEALS — credit the day's treasury Honor Seals;
 *   3. STORES — run its Village Stores day (api/_village-stores-daily.ts).
 *
 * Each step is exactly-once per village per UTC day ON ITS OWN, so running the
 * pass again the same day finishes whatever an earlier run left undone and pays
 * nothing twice:
 *   · the war record by its `lastWarPassDate` stamp (a re-run no-ops);
 *   · the seals by a journal (`war:daily-seals:<slug>`) sealed BEFORE the record
 *     is stamped, and a `treasury.sealsAccrualDate` marker written in the SAME
 *     write as the credit. They used to be credited after the stamp with nothing
 *     to retry from, so a failed write lost the day's seals for good;
 *   · the stores by their own day journal and markers. They used to run only in
 *     the run that stamped the record, so a failure there also lost the day.
 * A run reports `complete` once every village's day has landed; until then the
 * scheduler releases its lease and its catch-up tick re-runs the pass (a
 * contended lock or a storage blip used to skip a village for the whole day). A
 * complete day is recorded durably (VILLAGE_WAR_DAILY_MARKER_KEY), so a restart
 * spanning 03:00 UTC catches the day up instead of skipping it.
 *
 * A failed territory scan pays nothing and stamps nothing: the whole pass is
 * retried. It used to pay every village the 8-sector baseline and stamp the day.
 *
 * SERVER-GATED and default on. The canonical Sector Map kill switch makes the
 * pass a no-op without changing legacy War Hall behavior.
 *
 * The pure math lives in stepVillageWarDay (api/_war-state.ts); this is the thin
 * IO wrapper. Underscore-prefixed → a helper, not a route.
 */

import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { sectorBenefitSeals, WR_POOL_CAP } from './_war-economy.js';
import { recordWarEcoEvent } from './_war-telemetry.js';
import { WAR_VILLAGES } from './_war-map-sectors.js';
import { loadHeldSectorCounts, type HeldSectorCounts, type HeldSectorStore } from './_war-held-sectors.js';
import {
    normalizeVillageWarRecord,
    stepVillageWarDay,
    villageWarKey,
    villageWarSlug,
    type VillageWarRecord,
} from './_war-state.js';
import { resetPerWarStructures, wrPerSector } from './_war-structures.js';
import { activeVillageWarEnemiesOf } from './world-state.js';
import { listActiveSectorWars } from './_sector-war-store.js';
import { settleDueSectorWars } from './_sector-war-settle.js';
import { villageWarMapEnabled, villageStoresEnabled } from './_release-flags.js';
import { runVillageStoresStep, runClanStoresDailyPass, type StoresWarLike, type ClanWarLike } from './_village-stores-daily.js';
import { loadAllClanWars, clanWarKey } from './clan/war/_storage.js';

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

/** The UTC hour the daily pass is scheduled for (api/cron/_scheduler.ts fires it
 *  then). The catch-up never runs a day before this hour. */
export const VILLAGE_WAR_DAILY_UTC_HOUR = 3;

/** Durable proof that a whole day's pass landed: `{ date: 'YYYY-MM-DD', at }`.
 *  Written only by a COMPLETE run; the catch-up tick reads it. */
export const VILLAGE_WAR_DAILY_MARKER_KEY = 'war:daily-pass:done';

/** A village's sealed seal accrual for one day (see the header). */
export interface DailySealsJournal {
    date: string;
    seals: number;
    at: number;
}

export function dailySealsJournalKey(village: string): string {
    return `war:daily-seals:${villageWarSlug(village)}`;
}

/** The treasury field stamped in the SAME write as a day's seal credit. It lives
 *  under `treasury` because api/_village-state-validate.ts rebuilds the treasury
 *  from the STORED row, so a village-state blob can neither forge nor clear it
 *  (the same protection `treasury.storesDate` relies on). */
export const SEALS_ACCRUAL_DATE_FIELD = 'sealsAccrualDate';

function isDailySealsJournal(raw: unknown): raw is DailySealsJournal {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const j = raw as Record<string, unknown>;
    return typeof j.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.date)
        && Number.isFinite(Number(j.seals)) && Number(j.seals) > 0;
}

// Sectors a village CURRENTLY controls, read from the authoritative
// `world:territory:<sector>.ownerVillage` rows (api/_war-held-sectors.ts) — held
// home war sectors PLUS any enemy war sectors it occupies, which is what makes
// conquest pay and losing ground bite. It is the same count the War Map shows.
function sectorsControlledForVillage(village: string, counts: HeldSectorCounts): number {
    return Math.max(0, Math.floor(counts[village] ?? 0));
}

// Minimal injectable surfaces so the pass is unit-testable with an in-memory store.
type WarStore = {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<unknown>;
    // Optional — a drained seals journal is cleared with `set(key, null)` when absent.
    del?(...keys: string[]): Promise<unknown>;
    // Optional territory-scan surface (HeldSectorStore). Loose on purpose so the
    // live `kv` satisfies it structurally; a test store may omit both.
    keys?(pattern: string): Promise<string[]>;
    mget?(...keys: string[]): Promise<unknown[]>;
};
type LockRunner = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

export interface VillageWarDailyResult {
    enabled: boolean;
    processed: number;
    /** Villages whose war record this run stepped (their day's WR + upkeep). */
    ran: number;
    /** Treasury seals this run credited (today's, or an earlier run's leftover). */
    sealsAccrued: number;
    /** 72h wars whose verdicts this pass stamped (flips + defended holds). */
    sectorWarsSettled: number;
    /** Villages whose day did not fully land in this run (war record, seals or
     *  stores). The next run finishes them; nothing already applied repeats. */
    failed: string[];
    /** Every village's day has landed (or the pass is switched off). Anything
     *  else is retried by the scheduler's catch-up tick. */
    complete: boolean;
}

async function defaultIsAtWar(village: string): Promise<boolean> {
    if ((await activeVillageWarEnemiesOf(village)).length > 0) return true;
    return (await listActiveSectorWars()).some((c) => c.attackerVillage === village || c.defenderVillage === village);
}

/** Run the daily pass across all villages. Default deps use the live kv + lock;
 *  tests inject an in-memory store + passthrough lock and `enabled: true`. */
export async function runVillageWarDailyPass(
    deps: {
        store?: WarStore;
        lock?: LockRunner;
        now?: number;
        enabled?: boolean;
        isAtWar?: (village: string) => Promise<boolean>;
        /** Override the live held-sector counts (tests inject a fixed table). */
        heldSectors?: HeldSectorCounts;
        /** Settle due 72h wars. Injectable so tests stay off live storage. */
        sweepSectorWars?: (now: number) => Promise<unknown[]>;
        /** Village Stores (Provisions + Materials). Defaults to the kill switch. */
        storesEnabled?: boolean;
        /** Active sector wars for the stores burn (tests inject; default = live store). */
        listSectorWars?: (now: number) => Promise<StoresWarLike[]>;
        /** Active clan wars for the clan provisions mirror (tests inject). */
        listClanWars?: () => Promise<ClanWarLike[]>;
        /** Override the unfed herald + Kage notice (tests). */
        notifyUnfed?: Parameters<typeof runVillageStoresStep>[0]['notifyUnfed'];
    } = {},
): Promise<VillageWarDailyResult> {
    const enabled = deps.enabled ?? villageWarMapEnabled();
    if (!enabled) return { enabled: false, processed: 0, ran: 0, sealsAccrued: 0, sectorWarsSettled: 0, failed: [], complete: true };

    const store: WarStore = deps.store ?? kv;
    const lock: LockRunner = deps.lock ?? ((key, fn) => withKvLock(key, fn, { failClosed: true }));
    // Whether a village is currently at war — an active village war OR a sector
    // contest it attacks/defends. At peace, its per-war structures reset. Injectable
    // so the pass stays unit-testable without the live war stores.
    const isAtWar = deps.isAtWar ?? defaultIsAtWar;
    // FAIL CLOSED: a village whose war status cannot be read counts as AT WAR, so
    // its per-war structures are kept. This used to answer "at peace" on any read
    // error and zero a defending village's paid Ramparts and Watchtower in the
    // middle of its war. Keeping them costs one more day of their upkeep at most;
    // the next day's pass resets them if the village really is at peace.
    const atWarFailClosed = async (village: string): Promise<boolean> => {
        try {
            return await isAtWar(village);
        } catch (err) {
            console.error(`[village-war] at-war check failed for ${village}; keeping its per-war structures:`, (err as Error).message);
            return true;
        }
    };
    const now = deps.now ?? Date.now();
    const today = utcDateString(now);
    // Settle any 72h wars that are due BEFORE the territory scan below, so a
    // sector the attacker already won pays its new owner, not the old one. The
    // scheduler's 5-minute tick settles them as they end; this catches any it
    // missed. Its own try/catch means a settle failure never costs income.
    let sectorWarsSettled = 0;
    try {
        sectorWarsSettled = (await (deps.sweepSectorWars ?? settleDueSectorWars)(now)).length;
    } catch (err) {
        console.error('[village-war] sector-war settlement sweep failed:', (err as Error).message);
    }
    // One territory scan for the whole pass — the WR + seal faucet both scale with
    // it, and it is the same count the War Map shows. A FAILED scan pays nothing
    // and stamps nothing: the day is retried. It used to be paid as the 8-sector
    // baseline and stamped, so a storage blip at 03:00 rewrote the day's income.
    let heldSectors: HeldSectorCounts;
    try {
        heldSectors = deps.heldSectors
            ?? await loadHeldSectorCounts(
                typeof store.keys === 'function' && typeof store.mget === 'function'
                    ? (store as HeldSectorStore)
                    : undefined,
                { now },
            );
    } catch (err) {
        console.error('[village-war] territory scan failed; the day is retried, not paid:', (err as Error).message);
        return { enabled: true, processed: 0, ran: 0, sealsAccrued: 0, sectorWarsSettled, failed: [...WAR_VILLAGES], complete: false };
    }

    // Village Stores: the active sector wars every village's ration burn keys off.
    // null = the scan failed: the stores day is retried rather than run as if no
    // war were active, which would skip every war's ration burn for the day.
    const storesEnabled = deps.storesEnabled ?? villageStoresEnabled();
    let storesWars: StoresWarLike[] | null = [];
    if (storesEnabled) {
        try {
            storesWars = await (deps.listSectorWars ?? (async (t: number) => listActiveSectorWars(t)))(now);
        } catch (err) {
            console.error('[village-war] stores: sector-war scan failed; the stores day is retried:', (err as Error).message);
            storesWars = null;
        }
    }

    const clearJournal = async (journalKey: string): Promise<void> => {
        if (typeof store.del === 'function') await store.del(journalKey);
        else await store.set(journalKey, null);
    };
    // Credit a village's sealed seal journal, exactly once. Only a day its war
    // record has actually stamped is credited; a journal whose stamp never landed
    // is left for the day's step to overwrite (that day paid no WR either). The
    // credit and `treasury.sealsAccrualDate` land in ONE write, so a retry after
    // any failure finds the marker and pays nothing twice. The pass runs under
    // the scheduler's job lease, so these reads never come from the process cache.
    const creditSealsJournal = async (village: string): Promise<number> => {
        const journalKey = dailySealsJournalKey(village);
        if ((await store.get<unknown>(journalKey)) == null) return 0;
        const stateKey = villageStateKey(village);
        let credited = 0;
        let creditedDate = '';
        await lock(stateKey, async () => {
            const journal = await store.get<unknown>(journalKey);
            if (journal == null) return;
            // Nothing in an unreadable journal can be paid; never let it block the day.
            if (!isDailySealsJournal(journal)) { await clearJournal(journalKey); return; }
            const record = normalizeVillageWarRecord(village, (await store.get<Partial<VillageWarRecord>>(villageWarKey(village))) ?? undefined);
            if (record.lastWarPassDate < journal.date) return;
            const state = (await store.get<Record<string, unknown>>(stateKey)) ?? {};
            const treasury = (state.treasury ?? {}) as Record<string, unknown>;
            if (String(treasury[SEALS_ACCRUAL_DATE_FIELD] ?? '') < journal.date) {
                const seals = Math.floor(Number(journal.seals));
                await store.set(stateKey, {
                    ...state,
                    treasury: { ...treasury, honorSeals: num(treasury.honorSeals) + seals, [SEALS_ACCRUAL_DATE_FIELD]: journal.date },
                });
                credited = seals;
                creditedDate = journal.date;
            }
            await clearJournal(journalKey);
        });
        if (credited > 0) {
            void recordWarEcoEvent({ eventId: `seals-earn:${villageWarSlug(village)}:${creditedDate}`, village, kind: 'seals.earn', amount: credited, ts: now }, { kv: store });
        }
        return credited;
    };

    let ran = 0;
    let sealsAccrued = 0;
    const failed: string[] = [];
    for (const village of WAR_VILLAGES) {
        const key = villageWarKey(village);
        const slug = villageWarSlug(village);
        const sectors = sectorsControlledForVillage(village, heldSectors);
        try {
            // An earlier run's seals that never landed are credited FIRST, before
            // today's step writes its own journal over them.
            sealsAccrued += await creditSealsJournal(village);

            // 1. WAR RECORD — once per day by its `lastWarPassDate` stamp.
            await lock(key, async () => {
                const raw = await store.get<Partial<VillageWarRecord>>(key);
                const record = normalizeVillageWarRecord(village, raw ?? undefined);
                if (record.lastWarPassDate === today) return; // an earlier run stepped today
                // Per-war fortifications (Ramparts/Watchtower) reset to 0 once the
                // village is at peace — they never carry into the next war (§7 split).
                // They reset BEFORE the day's upkeep is computed: charging their
                // upkeep first could mothball the village, suspending EVERY
                // structure's bonus, over structures that were about to stop
                // existing. Only the run that steps the day resets them, so a
                // same-day retry never wipes fortifications bought since then.
                const base = (await atWarFailClosed(village)) ? record : resetPerWarStructures(record);
                const { record: next, summary } = stepVillageWarDay(base, {
                    sectorsControlled: sectors,
                    today,
                    now,
                    wrPerSector: wrPerSector(base), // Supply-Depot-boosted income
                });
                // Seal the day's seal accrual BEFORE the stamp lands: once it has,
                // this run or any later one credits exactly this amount, once.
                const seals = sectorBenefitSeals(sectors);
                if (seals > 0) {
                    const journal: DailySealsJournal = { date: today, seals, at: now };
                    await store.set(dailySealsJournalKey(village), journal);
                }
                await store.set(key, next);
                ran++;
                // Telemetry (best-effort, same store): the day's WR faucet, upkeep
                // sink, and any dormancy transition. eventId is keyed per
                // village/day so the idempotent pass can't double-count. The faucet
                // logs what the capped pool actually took, not the gross accrual.
                const wrCredited = Math.max(0, Math.min(WR_POOL_CAP, base.warResources + summary.wrAccrued) - base.warResources);
                if (wrCredited > 0) void recordWarEcoEvent({ eventId: `wr-earn:${slug}:${today}`, village, kind: 'wr.earn', amount: wrCredited, ts: now }, { kv: store });
                if (summary.maintenancePaid > 0) void recordWarEcoEvent({ eventId: `wr-maint:${slug}:${today}`, village, kind: 'wr.spend.maintenance', amount: summary.maintenancePaid, ts: now }, { kv: store });
                if (!record.dormant && summary.dormant) void recordWarEcoEvent({ eventId: `dormancy-enter:${slug}:${today}`, village, kind: 'dormancy.enter', amount: 1, ts: now }, { kv: store });
                if (record.dormant && !summary.dormant) void recordWarEcoEvent({ eventId: `dormancy-exit:${slug}:${today}`, village, kind: 'dormancy.exit', amount: 1, ts: now }, { kv: store });
            });

            // 2. SEALS — today's journal, sealed just above or by an earlier run.
            sealsAccrued += await creditSealsJournal(village);

            // 3. STORES — spoil → war/merc/garrison burn → depot conversion, plus
            // the home-loss burn and the unfed flags. The stores day is
            // exactly-once on its own (api/_village-stores-daily.ts), so it runs on
            // every pass of a day the war record has stamped, not only in the run
            // that stamped it: a failed stores day used to be lost with no retry.
            if (storesEnabled) {
                if (storesWars === null) {
                    failed.push(village);
                    continue;
                }
                const s = await runVillageStoresStep({ village, today, now, wars: storesWars, store, lock, notifyUnfed: deps.notifyUnfed });
                if (s.wrConverted > 0) void recordWarEcoEvent({ eventId: `stores-convert:${slug}:${today}`, village, kind: 'wr.earn', amount: s.wrConverted, ts: now, meta: 'supply-depot' }, { kv: store });
            }
        } catch (err) {
            console.error(`[village-war] daily pass failed for ${village}; the next run finishes it:`, (err as Error).message);
            failed.push(village);
        }
    }
    // Clan provisions mirror: every active clan war eats 30 rations/day per clan.
    // Exactly-once per clan per day by its own receipts, so a retry is safe.
    let clanStoresOk = true;
    if (storesEnabled) {
        try {
            const wars = await (deps.listClanWars ?? (async () => loadAllClanWars() as Promise<ClanWarLike[]>))();
            await runClanStoresDailyPass({ today, now, wars, warKeyOf: (w) => clanWarKey(w.clans[0], w.clans[1]), store, lock });
        } catch (err) {
            console.error('[village-war] clan stores pass failed:', (err as Error).message);
            clanStoresOk = false;
        }
    }
    const complete = failed.length === 0 && clanStoresOk;
    if (complete) {
        // Best-effort: a lost marker only costs the catch-up one redundant no-op run.
        try {
            await store.set(VILLAGE_WAR_DAILY_MARKER_KEY, { date: today, at: now });
        } catch (err) {
            console.error('[village-war] could not record the finished day:', (err as Error).message);
        }
    }
    return { enabled: true, processed: WAR_VILLAGES.length, ran, sealsAccrued, sectorWarsSettled, failed, complete };
}

/** True from 03:00 UTC on — the catch-up never runs a day's pass early. */
export function villageWarDailyPassDue(now: number): boolean {
    return new Date(now).getUTCHours() >= VILLAGE_WAR_DAILY_UTC_HOUR;
}

/** Whether a COMPLETE run has been recorded for `day`. A failed read answers
 *  false: re-running a finished day is a no-op, while skipping an unfinished one
 *  is exactly the loss this exists to prevent. */
export async function villageWarDailyPassDoneFor(day: string, store: Pick<WarStore, 'get'> = kv): Promise<boolean> {
    try {
        const marker = await store.get<{ date?: unknown }>(VILLAGE_WAR_DAILY_MARKER_KEY);
        return String(marker?.date ?? '') === day;
    } catch {
        return false;
    }
}

export type VillageWarCatchUpOutcome =
    | { status: 'not-due' }
    | { status: 'done' }
    | { status: 'busy' }
    | { status: 'ran'; result: VillageWarDailyResult };

/**
 * The scheduler's catch-up and retry tick for today's pass (api/cron/_scheduler.ts
 * runs it shortly after boot and then every few minutes).
 *
 * The 03:00 UTC timer used to be the ONLY way the pass ran. A restart spanning
 * 03:00 skipped the day outright, and a village that failed (a contended lock, a
 * storage blip) stayed unpaid until the next day, because the day's lease was
 * held for 20 hours either way. Now, once it is past 03:00 UTC and today is not
 * recorded complete, this runs the pass again. Every step of the pass is
 * exactly-once per village per day, so a re-run only finishes what is missing.
 *
 * `runPass` is the scheduler's LEASED pass, called with this tick's clock; it
 * answers null when another process holds the lease (it is running the pass).
 */
export async function runVillageWarDailyCatchUp(deps: {
    runPass: (now: number) => Promise<VillageWarDailyResult | null>;
    now?: number;
    store?: Pick<WarStore, 'get'>;
}): Promise<VillageWarCatchUpOutcome> {
    const now = deps.now ?? Date.now();
    if (!villageWarDailyPassDue(now)) return { status: 'not-due' };
    if (await villageWarDailyPassDoneFor(utcDateString(now), deps.store)) return { status: 'done' };
    const result = await deps.runPass(now);
    return result ? { status: 'ran', result } : { status: 'busy' };
}
