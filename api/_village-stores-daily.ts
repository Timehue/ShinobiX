/*
 * Village Stores — the IO half of the daily pass (called from
 * api/_war-daily.ts inside the village-war-daily transaction, once per village
 * per UTC day, after WR/seal accrual). Pure math lives in api/_village-stores.ts.
 *
 * Per village:
 *   1. Lock the village-state row (treasury: provisions / materialPoints), then
 *      the war record (WR pool, merc leases, ledger). Run stepVillageStoresDay.
 *   2. HOME-sector loss: diff the home sectors held at the previous pass against
 *      the live `world:territory:<sector>` owners; every home sector that flipped
 *      away burns 25% of provisions ONCE (receipt `home-loss:<sector>:<day>` on the
 *      war record). The sector-war settle path is not touched — the daily pass
 *      is the single detector, so a flip by settle OR by a village-war capture
 *      is billed exactly once.
 *   3. Stamp each active war this village fights in: `fed` / `unfedVillages` /
 *      `garrisonFeed[village].covered` (under the war's own lock).
 *   4. Unfed war → World Herald 'high' (once per war per day, receipt-keyed) +
 *      a `village-unfed` offline notice to the seated Kage.
 *
 * Also hosts the CLAN mirror: every active clan war burns 30 provisions/day from
 * each clan's `treasury.provisions`; an unfed clan gets `storesFed[clan] = false`
 * on the war row (clans have no per-war structure bonus to halve).
 *
 * Every store/lock is injectable so the pass unit-tests against a memStore.
 */

import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { announce } from './_announce.js';
import { pushOfflineNotice } from './player/_offline-notices.js';
import { safeName } from './_utils.js';
import { WR_POOL_CAP } from './_war-economy.js';
import { effectiveLevel } from './_war-structures.js';
import { homeSectorsForVillage } from './_war-map-sectors.js';
import { normalizeVillageWarRecord, villageWarKey, villageWarSlug, activeMercLeases, type VillageWarRecord } from './_war-state.js';
import { sectorWarKey, normalizeGarrisonFeed, type SectorWarSession } from './_sector-war.js';
import {
    appendStoresLedger,
    homeLossBurn,
    readStores,
    stepVillageStoresDay,
    WAR_RATIONS_PER_DAY,
    type StoresLedgerEntry,
} from './_village-stores.js';

export type StoresStore = {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<unknown>;
    /** Optional — the journal is cleared with `set(key, null)` when absent. */
    del?(key: string): Promise<unknown>;
};
export type StoresLock = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

export type StoresWarLike = Pick<SectorWarSession, 'id' | 'sector' | 'attackerVillage' | 'defenderVillage' | 'garrisonFeed'>;

function villageStateKey(village: string): string {
    return `game:village-state:${villageWarSlug(village)}`;
}
function kageKey(village: string): string {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}

// ── Day journal (exactly-once across the two-key commit) ────────────────────
/*
 * The stores day debits the VILLAGE-STATE row (provisions + materials) and
 * credits the WAR RECORD (converted War Resources, the home-loss receipts, the
 * home-sector baseline, the ledger, the merc skips). Those are two different KV
 * keys, so the write cannot be atomic — and the pass is gated once per UTC day
 * by api/_war-daily.ts, so a failure between the two writes used to consume the
 * day: up to 400 converted WR destroyed, and `storesHomeHeld` never persisted,
 * which made the NEXT day re-detect the same home-sector flip and burn another
 * 25% of provisions for a loss already billed.
 *
 * Ordering (chosen for the failure modes, not for speed):
 *   1. JOURNAL — seal the whole computed day under `war:stores-day:<slug>`
 *      BEFORE any balance moves. Nothing has been paid or credited yet, so a
 *      failure here is a clean no-op: the day is simply skipped and tomorrow
 *      re-detects the same flip and bills it (once).
 *   2. STATE (the DEBIT) — apply the sealed spend and stamp
 *      `treasury.storesDate`. Debit before credit, so the only reachable
 *      partial state is "paid, not yet credited", never "credited, not paid"
 *      (which would MINT War Resources).
 *   3. WAR RECORD (the CREDIT) — apply the sealed WR gain, receipts, home
 *      baseline, ledger and merc skips, stamped with `stores-day:<date>` in
 *      `storesReceipts`.
 *   4. Drop the journal.
 *
 * Both target writes are SELF-MARKING and re-applied by DELTA, so replaying
 * them is exactly-once and never clobbers a concurrent donation:
 *   · state  — skipped when `treasury.storesDate` already equals the day.
 *   · war    — skipped when `storesReceipts['stores-day:<date>']` is set.
 * Neither marker is client-forgeable: the village-state validator rebuilds
 * `treasury` from the STORED blob and only copies the known currency keys off
 * the incoming one, and the war record is server-only.
 *
 * Every later run of the pass drains a parked journal first, so an interrupted
 * day either fully replays or is a clean no-op — and a day already committed in
 * full is a no-op too (the pass is now idempotent per UTC day on its own, not
 * just because api/_war-daily.ts gates it).
 */
const STORES_DAY_RECEIPT_PREFIX = 'stores-day:';

export function storesDayJournalKey(village: string): string {
    return `war:stores-day:${villageWarSlug(village)}`;
}
export function storesDayReceiptId(date: string): string {
    return `${STORES_DAY_RECEIPT_PREFIX}${date}`;
}

/** The sealed outcome of one village's stores day, written before any balance
 *  moves so a partial commit can be replayed from the exact same numbers. */
export interface StoresDayJournal {
    date: string;
    at: number;
    /** Provisions the day consumed (spoilage + home-loss burn + every ration). */
    provisionsSpent: number;
    /** Material points the Supply Depot converted. */
    materialsSpent: number;
    /** War Resources the conversion produced. */
    wrGained: number;
    /** Home sectors held at this pass — the next day's diff baseline. */
    homeHeld: number[];
    /** Home-loss receipts minted this day (receiptId → epoch ms). */
    receipts: Record<string, number>;
    ledger: StoresLedgerEntry[];
    /** `tierId:player` of every band the day could not feed. */
    mercSkips: string[];
    wars: Array<{ id: string; fed: boolean; garrisonCovered: boolean }>;
    result: {
        provisions: number;
        materialPoints: number;
        wrConverted: number;
        spoiled: number;
        homeLost: number[];
        mercsSkipped: number;
    };
}

function isStoresDayJournal(raw: unknown): raw is StoresDayJournal {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const j = raw as Record<string, unknown>;
    return typeof j.date === 'string' && !!j.date && Array.isArray(j.homeHeld) && !!j.result;
}

/** The stores receipt ledger gains a row per day (plus any home-loss burns), so
 *  it is trimmed to the newest STORES_RECEIPT_CAP — far more than the one day
 *  any receipt is actually consulted for, and bounded for good. */
export const STORES_RECEIPT_CAP = 90;

function pruneStoresReceipts(receipts: Record<string, number>): Record<string, number> {
    const entries = Object.entries(receipts);
    if (entries.length <= STORES_RECEIPT_CAP) return receipts;
    return Object.fromEntries(entries.sort((a, b) => a[1] - b[1]).slice(-STORES_RECEIPT_CAP));
}

async function dropStoresDayJournal(store: StoresStore, key: string): Promise<void> {
    if (typeof store.del === 'function') await store.del(key);
    else await store.set(key, null);
}

/** Apply a sealed day to the two target keys. Each write is skipped when its
 *  own marker says it already landed, so this is safe to re-run any number of
 *  times. Caller holds both locks. */
async function commitStoresDay(
    journal: StoresDayJournal,
    ctx: { village: string; store: StoresStore; stateKey: string; warKey: string },
): Promise<void> {
    const { village, store, stateKey, warKey } = ctx;
    const receiptId = storesDayReceiptId(journal.date);

    // (2) DEBIT — by delta, so a donation that landed since is preserved.
    const state = (await store.get<Record<string, unknown>>(stateKey)) ?? {};
    const treasury = (state.treasury ?? {}) as Record<string, unknown>;
    if (treasury.storesDate !== journal.date) {
        const cur = readStores(treasury);
        await store.set(stateKey, {
            ...state,
            treasury: {
                ...treasury,
                provisions: Math.max(0, cur.provisions - Math.max(0, journal.provisionsSpent)),
                materialPoints: Math.max(0, cur.materialPoints - Math.max(0, journal.materialsSpent)),
                storesDate: journal.date,
            },
        });
    }

    // (3) CREDIT — same shape: delta on WR, absolute on the receipted fields.
    const record = normalizeVillageWarRecord(village, (await store.get<Partial<VillageWarRecord>>(warKey)) ?? undefined);
    if (!record.storesReceipts?.[receiptId]) {
        const skips = new Set(journal.mercSkips);
        const next: VillageWarRecord = {
            ...record,
            warResources: Math.max(0, Math.min(WR_POOL_CAP, record.warResources + Math.max(0, journal.wrGained))),
            mercLeases: record.mercLeases.map((l) => (
                skips.has(`${l.tierId}:${l.player}`) ? { ...l, skipNextAutoDeploy: true } : l
            )),
            storesLedger: appendStoresLedger(record.storesLedger, journal.ledger),
            storesReceipts: pruneStoresReceipts({ ...(record.storesReceipts ?? {}), ...journal.receipts, [receiptId]: journal.at }),
            storesHomeHeld: journal.homeHeld,
        };
        await store.set(warKey, next);
    }

    // (4) The day is fully applied — the journal has nothing left to replay.
    await dropStoresDayJournal(store, storesDayJournalKey(village));
}

export interface VillageStoresStepResult {
    provisions: number;
    materialPoints: number;
    wrConverted: number;
    spoiled: number;
    homeLost: number[];
    unfedWars: string[];
    mercsSkipped: number;
}

/** One village's stores day. Caller guarantees it runs once per village per day
 *  (it rides the idempotent war-record step in api/_war-daily.ts). */
export async function runVillageStoresStep(args: {
    village: string;
    today: string;
    now: number;
    wars: readonly StoresWarLike[];
    store?: StoresStore;
    lock?: StoresLock;
    /** Override the herald / Kage notice (tests). Defaults to the live announce + inbox. */
    notifyUnfed?: (args: { village: string; war: StoresWarLike; kage: string; today: string; now: number }) => Promise<void>;
}): Promise<VillageStoresStepResult> {
    const store: StoresStore = args.store ?? kv;
    const lock: StoresLock = args.lock ?? ((key, fn) => withKvLock(key, fn, { failClosed: true }));
    const { village, today, now } = args;
    const stateKey = villageStateKey(village);
    const warKey = villageWarKey(village);
    const myWars = args.wars.filter((w) => w.attackerVillage === village || w.defenderVillage === village);

    // Live home-sector ownership (the rows the WR faucet reads).
    const home = homeSectorsForVillage(village);
    const heldNow: number[] = [];
    for (const s of home) {
        const row = await store.get<{ ownerVillage?: unknown }>(`world:territory:${s}`);
        // Unseeded rows read as home-held (matches the daily-pass baseline).
        if (!row || row.ownerVillage === undefined || String(row.ownerVillage) === village) heldNow.push(s);
    }

    const journalKey = storesDayJournalKey(village);
    const commitCtx = { village, store, stateKey, warKey };

    const journal = await lock(stateKey, async () => lock(warKey, async (): Promise<StoresDayJournal | null> => {
        // Drain a parked journal FIRST: an interrupted earlier day is finished
        // (WR recovered, `storesHomeHeld` persisted so today's diff is right and
        // the flip is not billed twice), and today's own journal is re-applied.
        const parked = await store.get<unknown>(journalKey);
        if (isStoresDayJournal(parked)) {
            await commitStoresDay(parked, commitCtx);
            if (parked.date === today) return parked;
        }

        const state = (await store.get<Record<string, unknown>>(stateKey)) ?? {};
        const treasury = (state.treasury ?? {}) as Record<string, unknown>;
        const record = normalizeVillageWarRecord(village, (await store.get<Partial<VillageWarRecord>>(warKey)) ?? undefined);
        // Already fully committed today (journal dropped) — a clean no-op.
        if (treasury.storesDate === today && record.storesReceipts?.[storesDayReceiptId(today)]) return null;

        const stores = readStores(treasury);
        const ledger: StoresLedgerEntry[] = [];
        const receipts: Record<string, number> = {};

        // (d) Home-sector loss — 25% burn per lost home sector, exactly once.
        let provisions = stores.provisions;
        const prevHeld = record.storesHomeHeld ?? [...home];
        const homeLost: number[] = [];
        for (const s of prevHeld) {
            if (heldNow.includes(s)) continue;
            const receiptId = `home-loss:${s}:${today}`;
            if (record.storesReceipts?.[receiptId]) continue;
            const burn = homeLossBurn(provisions);
            provisions -= burn;
            receipts[receiptId] = now;
            homeLost.push(s);
            if (burn > 0) ledger.push({ at: now, kind: 'home-loss', amount: burn, ref: `sector:${s}` });
        }

        const live = activeMercLeases(record, now);
        const day = stepVillageStoresDay({
            provisions,
            materialPoints: stores.materialPoints,
            warResources: record.warResources,
            wrPoolCap: WR_POOL_CAP,
            depotLevel: effectiveLevel(record, 'supplyDepot'),
            // Legacy-tolerant: a pre-split row still carries the single trio.
            wars: myWars.map((w) => ({ id: w.id, garrisonFed: normalizeGarrisonFeed(w as unknown as Record<string, unknown>)?.[village]?.on === true })),
            mercs: live.map((l) => ({ tierId: l.tierId, player: l.player, size: l.count })),
            now,
        });

        const mercSkips = day.mercs.filter((m) => !m.fed).map((m) => `${m.tierId}:${m.player}`);
        const sealed: StoresDayJournal = {
            date: today,
            at: now,
            provisionsSpent: Math.max(0, stores.provisions - day.provisions),
            materialsSpent: Math.max(0, stores.materialPoints - day.materialPoints),
            wrGained: day.wrConverted,
            homeHeld: heldNow,
            receipts,
            ledger: [...ledger, ...day.ledger],
            mercSkips,
            wars: day.wars,
            result: {
                provisions: day.provisions,
                materialPoints: day.materialPoints,
                wrConverted: day.wrConverted,
                spoiled: day.spoiled,
                homeLost,
                mercsSkipped: new Set(mercSkips).size,
            },
        };
        // (1) Seal the day BEFORE any balance moves, then (2) debit, (3) credit.
        await store.set(journalKey, sealed);
        await commitStoresDay(sealed, commitCtx);
        return sealed;
    }));

    if (!journal) {
        // The day was already applied in full — report the live balances and
        // touch nothing (no re-stamp, no second herald).
        const state = (await store.get<Record<string, unknown>>(stateKey)) ?? {};
        const stores = readStores((state.treasury ?? {}) as Record<string, unknown>);
        return { ...stores, wrConverted: 0, spoiled: 0, homeLost: [], unfedWars: [], mercsSkipped: 0 };
    }

    // (b) stamp each war this village fights in, under the war's own lock.
    const unfedWars: string[] = [];
    for (const w of myWars) {
        const verdict = journal.wars.find((x) => x.id === w.id);
        if (!verdict) continue;
        await lock(sectorWarKey(w.id), async () => {
            const raw = await store.get<Record<string, unknown>>(sectorWarKey(w.id));
            if (!raw) return;
            const sameDay = raw.storesDate === today;
            const prevUnfed = sameDay && Array.isArray(raw.unfedVillages) ? (raw.unfedVillages as string[]).filter((v) => v !== village) : [];
            const unfedVillages = verdict.fed ? prevUnfed : [...prevUnfed, village];
            const next: Record<string, unknown> = {
                ...raw,
                storesDate: today,
                unfedVillages,
                fed: unfedVillages.length === 0,
            };
            // Stamp coverage on THIS village's entry only (legacy trio folded in).
            const feed = normalizeGarrisonFeed(raw);
            if (feed?.[village]?.on) {
                next.garrisonFeed = { ...feed, [village]: { ...feed[village], covered: verdict.garrisonCovered } };
                delete next.garrisonFed; delete next.garrisonFedBy; delete next.garrisonCovered;
            }
            await store.set(sectorWarKey(w.id), next);
        });
        if (!verdict.fed) unfedWars.push(w.id);
    }

    // (e) herald + Kage notice, once per war per day.
    if (unfedWars.length) {
        const kageRec = await store.get<{ seatedKage?: string }>(kageKey(village)).catch(() => null);
        const kage = safeName(String(kageRec?.seatedKage ?? ''));
        const notify = args.notifyUnfed ?? defaultNotifyUnfed;
        for (const id of unfedWars) {
            const war = myWars.find((w) => w.id === id)!;
            try { await notify({ village, war, kage, today, now }); } catch { /* best-effort */ }
        }
    }

    return { ...journal.result, unfedWars };
}

async function defaultNotifyUnfed(a: { village: string; war: StoresWarLike; kage: string; today: string; now: number }): Promise<void> {
    await announce({
        type: 'village_unfed',
        importance: 'high',
        title: `${a.village} marches hungry`,
        message: `${a.village}'s provisions could not feed its war for Sector ${a.war.sector} today (${WAR_RATIONS_PER_DAY} rations short). Its fortifications fight at half strength until the Town Hall is restocked.`,
        village: a.village,
        meta: { sector: a.war.sector, contestId: a.war.id },
    }, { receiptId: `village-unfed:${a.war.id}:${villageWarSlug(a.village)}:${a.today}` });
    if (a.kage) {
        await pushOfflineNotice(a.kage, { kind: 'village-unfed', by: a.village, village: a.village, sector: a.war.sector, at: a.now });
    }
}

// ── Clan mirror ─────────────────────────────────────────────────────────────

export const CLAN_WAR_RATIONS_PER_DAY = WAR_RATIONS_PER_DAY;

export type ClanWarLike = { id: string; clans: [string, string]; endedAt?: number };

function clanSaveKey(clan: string): string {
    return `save:clan-${clan.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

/** Per-(war, clan, UTC day) receipt, stamped on the clan record in the SAME
 *  write as the debit. Two clans are charged under two separate locks before the
 *  war row is stamped, so a failure between them used to leave clan A paying for
 *  a day that was never recorded — and tomorrow charging it again. The receipt
 *  makes each clan's debit exactly-once regardless of what happens to the row.
 *
 *  It lives under `treasury.*` deliberately: api/_clan-save-validate.ts rebuilds
 *  `treasury` from the STORED blob and only copies the known currency keys off
 *  the incoming one, so a client save can neither forge nor clear it. */
const CLAN_STORES_RECEIPTS_FIELD = 'storesReceipts';
export const CLAN_STORES_RECEIPT_CAP = 20;

export type ClanStoresReceipt = { at: number; fed: boolean };

export function clanStoresReceiptId(warId: string, clan: string, today: string): string {
    return `${warId}:${clan}:${today}`;
}

export function parseClanStoresReceipts(raw: unknown): Record<string, ClanStoresReceipt> {
    const out: Record<string, ClanStoresReceipt> = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!k || !v || typeof v !== 'object' || Array.isArray(v)) continue;
        const e = v as Record<string, unknown>;
        const at = Math.floor(Number(e.at) || 0);
        if (at <= 0) continue;
        out[k] = { at, fed: e.fed === true };
    }
    return out;
}

/** Keep the newest CLAN_STORES_RECEIPT_CAP receipts (oldest dropped). */
function pruneClanStoresReceipts(receipts: Record<string, ClanStoresReceipt>): Record<string, ClanStoresReceipt> {
    const entries = Object.entries(receipts).sort((a, b) => a[1].at - b[1].at).slice(-CLAN_STORES_RECEIPT_CAP);
    return Object.fromEntries(entries);
}

/** Burn 30 provisions per active clan war from each clan's treasury; stamp
 *  `storesFed[clan]` + `storesDate` on the war row. Exactly-once per clan per
 *  UTC day via the per-(war, clan, day) receipt above — a war row stamp that
 *  never lands can no longer double-charge a clan that already paid. */
export async function runClanStoresDailyPass(args: {
    today: string;
    now: number;
    wars: readonly ClanWarLike[];
    warKeyOf: (war: ClanWarLike) => string;
    store?: StoresStore;
    lock?: StoresLock;
}): Promise<{ processed: number; unfed: string[] }> {
    const store: StoresStore = args.store ?? kv;
    const lock: StoresLock = args.lock ?? ((key, fn) => withKvLock(key, fn, { failClosed: true }));
    let processed = 0;
    const unfed: string[] = [];
    for (const war of args.wars) {
        if (war.endedAt) continue;
        const warKey = args.warKeyOf(war);
        try {
            await lock(warKey, async () => {
                const row = (await store.get<Record<string, unknown>>(warKey)) ?? null;
                if (!row || row.endedAt) return;
                if (row.storesDate === args.today) return;
                const fed: Record<string, boolean> = {};
                for (const clan of war.clans) {
                    const key = clanSaveKey(clan);
                    const receiptId = clanStoresReceiptId(war.id, clan, args.today);
                    fed[clan] = await lock(key, async () => {
                        const rec = (await store.get<Record<string, unknown>>(key)) ?? null;
                        if (!rec) return false;
                        const treasury = (rec.treasury ?? {}) as Record<string, unknown>;
                        const receipts = parseClanStoresReceipts(treasury[CLAN_STORES_RECEIPTS_FIELD]);
                        // Already charged for this war today — replay the sealed
                        // verdict instead of debiting a second time.
                        const prior = receipts[receiptId];
                        if (prior) return prior.fed;
                        const have = Math.max(0, Math.floor(Number(treasury.provisions) || 0));
                        const canFeed = have >= CLAN_WAR_RATIONS_PER_DAY;
                        // The debit and its receipt land in ONE write.
                        await store.set(key, {
                            ...rec,
                            treasury: {
                                ...treasury,
                                ...(canFeed ? { provisions: have - CLAN_WAR_RATIONS_PER_DAY } : {}),
                                [CLAN_STORES_RECEIPTS_FIELD]: pruneClanStoresReceipts({
                                    ...receipts,
                                    [receiptId]: { at: args.now, fed: canFeed },
                                }),
                            },
                        });
                        return canFeed;
                    });
                    if (!fed[clan]) unfed.push(`${war.id}:${clan}`);
                }
                await store.set(warKey, { ...row, storesDate: args.today, storesFed: fed });
                processed++;
            });
        } catch (err) {
            console.error(`[village-stores] clan war ${war.id} stores pass failed:`, (err as Error).message);
        }
    }
    return { processed, unfed };
}
