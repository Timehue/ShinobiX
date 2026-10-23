import { kv } from './_storage.js';
import { withTelemetryLock } from './_telemetry-lock.js';
import { withoutKvLeaseContext } from './_kv-lock-context.js';
import { runBackgroundWork } from './_background-work.js';
import { BLACK_MARKET_COST } from './festival/_black-market.js';
import { BLACK_MARKET_DIAL_DAYS, BLACK_MARKET_DIAL_LOOP_THRESHOLD, blackMarketLoopProduct } from './_black-market-loop.js';

// ─── Economy telemetry + transaction trail ────────────────────────────────────
//
// Makes the soft-economy *visible*: every server-authoritative currency change
// logs its SERVER-computed delta (faucet +, sink −) so inflation / faucet-vs-sink
// balance can be measured instead of guessed, and a dupe can be detected and
// unwound after the fact. Design: docs/economy-telemetry-plan.md.
//
// Strictly additive + best-effort: a logging hiccup NEVER fails the real reward
// write (every public fn swallows + logs its own errors). Stores, all plain KV
// rows in the existing kv_store table (no schema change):
//   econ:txns                  — capped recent list (newest-first) of the
//                                low-frequency, high-value txns, for drill-down
//   econ:agg:<currency>        — running { created, destroyed } faucet/sink
//                                counters (player-to-player transfers excluded)
//   econ:day:<date>:<currency> — { [source]: { c, d, n } } for one UTC day
//   econ:pday:<date>:<player>  — { [currency]: { [source]: { c, d, n } } }, the
//                                per-player day the 8.4 alarms and percentiles read
//   econ:pidx:<date>           — the players with an econ:pday row that day
//   econ:exchange-res:<date>   — Sunscar Exchange resource-lot sale samples
// The reset wipes econ:*, so every baseline restarts with the reset build.
//
// Call recordEconomyTxn() AFTER the writer's save commits (or from its
// mutatePlayerSave afterCommit), with the server-computed delta, and only when
// the request was fresh: a call inside the mutation callback logs deltas that a
// lost compare-and-set never committed, and a replay would log one claim twice.
// Use a txnId derived from the request or receipt so duplicateTxnIds stays
// meaningful.
//
// Write amplification (2026-10 rebalance, BTEI-09). Every txn used to take one
// global lock and rewrite a 5,000-entry list (~0.8 MB). Now each currency has
// its own lock guarding its aggregate and day row, each player-day row has its
// own, the list is 1,000 entries, and the high-frequency sources below skip the
// list entirely, so the per-player rows carry them instead.

export type EconCurrency =
    | 'ryo' | 'fateShards' | 'boneCharms' | 'auraStones'
    | 'auraDust' | 'honorSeals' | 'mythicSeals' | 'hollowShards'
    | 'chroniclePoints';

export const ECON_CURRENCIES: readonly EconCurrency[] = [
    'ryo', 'fateShards', 'boneCharms', 'auraStones',
    'auraDust', 'honorSeals', 'mythicSeals', 'hollowShards',
    'chroniclePoints',
];

export interface EconTxn {
    ts: number;
    txnId: string;       // idempotency id, e.g. `mission:<id>:<day>` (dup detection)
    player: string;      // safeName slug
    currency: EconCurrency;
    delta: number;       // + faucet, − sink/burn (server-computed)
    source: string;      // 'mission.claim' | 'trade.burn' | 'bank.interest' | …
    balanceAfter?: number;
}

export interface EconAgg { created: number; destroyed: number; }
/** One source's totals for a day: created, destroyed and txn count. */
export interface EconSourceCount { c: number; d: number; n: number; }
export type EconDayRow = Record<string, EconSourceCount>;
export type EconPlayerDayRow = Partial<Record<EconCurrency, Record<string, EconSourceCount>>>;

export const ECON_TXN_LIST_KEY = 'econ:txns';
export const MAX_ECON_TXNS = 1000;
export const ECON_DAY_TTL_SECONDS = 400 * 86_400;
export const ECON_PLAYER_DAY_TTL_SECONDS = 45 * 86_400;
export const MAX_ECON_PLAYER_INDEX = 10_000;
export function econAggKey(c: EconCurrency): string { return `econ:agg:${c}`; }
export function econDayKey(date: string, c: EconCurrency): string { return `econ:day:${date}:${c}`; }
export function econPlayerDayKey(date: string, player: string): string { return `econ:pday:${date}:${player}`; }
export function econPlayerIndexKey(date: string): string { return `econ:pidx:${date}`; }

/** UTC calendar day of a timestamp, `YYYY-MM-DD`. */
export function econUtcDay(ts: number): string { return new Date(ts).toISOString().slice(0, 10); }

/**
 * Sources frequent enough that listing them would flush the recent list within
 * the hour at launch load. They update the aggregates, the day row and the
 * player-day row, but not econ:txns. Decided here in one place so a writer
 * cannot forget; a caller may still force either way with `opts.list`.
 */
export const ECON_HIGH_FREQUENCY_SOURCE_PREFIXES: readonly string[] = [
    'pvp.', 'aifight.', 'ai-fight.', 'pve.', 'explore.', 'world.', 'wanderer.', 'mission.', 'hunt.',
];
export function isHighFrequencyEconSource(source: string): boolean {
    return ECON_HIGH_FREQUENCY_SOURCE_PREFIXES.some((prefix) => source.startsWith(prefix));
}

/**
 * Player-to-player transfer legs. The currency changes hands rather than
 * entering or leaving the economy, so they stay out of econ:agg's created and
 * destroyed totals (one 100-FS lot at 140k would otherwise add 14M to both).
 * The day and player rows keep them for volume; the Exchange fee is recorded
 * separately as the real sink, `exchange.fee`.
 */
export const ECON_TRANSFER_SOURCES: ReadonlySet<string> = new Set(['sunscar.exchange']);
export function isTransferEconSource(source: string): boolean { return ECON_TRANSFER_SOURCES.has(source); }

function isEconCurrency(v: unknown): v is EconCurrency {
    return typeof v === 'string' && (ECON_CURRENCIES as readonly string[]).includes(v);
}

// Pure: fold a delta into a running aggregate (+ → created, − → destroyed).
export function applyTxnToAgg(agg: EconAgg, delta: number): EconAgg {
    if (!Number.isFinite(delta) || delta === 0) return agg;
    return delta > 0
        ? { created: agg.created + delta, destroyed: agg.destroyed }
        : { created: agg.created, destroyed: agg.destroyed + (-delta) };
}

// Pure: fold a delta into a per-source counter row.
export function foldSourceCount(row: Record<string, EconSourceCount>, source: string, delta: number): Record<string, EconSourceCount> {
    if (!Number.isFinite(delta) || delta === 0) return row;
    const prior = row[source] ?? { c: 0, d: 0, n: 0 };
    return {
        ...row,
        [source]: {
            c: prior.c + (delta > 0 ? delta : 0),
            d: prior.d + (delta < 0 ? -delta : 0),
            n: prior.n + 1,
        },
    };
}

// Pure: txnIds that appear more than once in a recent-txn list (dup / replay).
export function duplicateTxnIds(txns: EconTxn[]): string[] {
    const counts = new Map<string, number>();
    for (const t of txns) counts.set(t.txnId, (counts.get(t.txnId) ?? 0) + 1);
    return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}

// Minimal KV surface; defaults to the shared `kv`, tests inject an in-memory one.
// `mget` is optional: readers batch with it when the store has it.
type EconKv = Pick<typeof kv, 'get' | 'set'> & { mget?: typeof kv.mget };

type EconTxnInput = { txnId: string; player: string; currency: string; delta: number; source: string; balanceAfter?: number; ts?: number };

// Record one currency delta. Best-effort, never throws into the reward path.
// No-op for a zero delta or an unknown currency. These admin projections take
// their own telemetry locks and remain tracked until shutdown drains them. They
// never inherit the currency writer's lease or poison its later authority work.
export function recordEconomyTxn(
    txn: EconTxnInput,
    opts: { kv?: EconKv; list?: boolean } = {},
): Promise<void> {
    return withoutKvLeaseContext(() => runBackgroundWork(() => recordEconomyTxnCore(txn, opts)))
        .then(() => undefined);
}

/** Each store is updated under its own lock and its own failure boundary, so a
 *  contended or failed row never costs the others their update. */
async function telemetryStep(what: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn();
    } catch (e) {
        console.error(`[economy] recordEconomyTxn ${what} failed:`, e);
    }
}

function playerKeyPart(player: string): string {
    return player.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
}

/** The stored form of a txn, or null for a zero delta or an unknown currency. */
function normalizeTxn(txn: EconTxnInput): EconTxn | null {
    const delta = Math.round(Number(txn.delta));
    if (!Number.isFinite(delta) || delta === 0) return null;
    if (!isEconCurrency(txn.currency)) return null;
    const ts = Number(txn.ts);
    return {
        ts: txn.ts !== undefined && Number.isFinite(ts) && Math.abs(ts) < 8.64e15 ? ts : Date.now(),
        txnId: String(txn.txnId).slice(0, 120),
        player: String(txn.player).slice(0, 64),
        currency: txn.currency,
        delta,
        source: String(txn.source).slice(0, 48),
        ...(Number.isFinite(Number(txn.balanceAfter)) ? { balanceAfter: Math.round(Number(txn.balanceAfter)) } : {}),
    };
}

async function recordEconomyTxnCore(txn: EconTxnInput, opts: { kv?: EconKv; list?: boolean }): Promise<void> {
    const store = opts.kv ?? kv;
    let normalized: EconTxn | null;
    try {
        normalized = normalizeTxn(txn);
    } catch (e) {
        console.error('[economy] recordEconomyTxn failed:', e);
        return;
    }
    if (!normalized) return;
    const full = normalized;
    const date = econUtcDay(full.ts);
    const transfer = isTransferEconSource(full.source);

    // One lock per currency guards both its aggregate and its day row, on the
    // listed and unlisted paths alike, so neither can lose the other's update.
    await telemetryStep('aggregate', () => withTelemetryLock(econAggKey(full.currency), store, async () => {
        if (!transfer) {
            const aggK = econAggKey(full.currency);
            const agg = (await store.get<EconAgg>(aggK)) ?? { created: 0, destroyed: 0 };
            await store.set(aggK, applyTxnToAgg(agg, full.delta));
        }
        const dayK = econDayKey(date, full.currency);
        const row = (await store.get<EconDayRow>(dayK)) ?? {};
        await store.set(dayK, foldSourceCount(row, full.source, full.delta), { ex: ECON_DAY_TTL_SECONDS });
    }));

    const slug = playerKeyPart(full.player);
    if (slug) {
        await telemetryStep('player day', () => withTelemetryLock(econPlayerDayKey(date, slug), store, async () => {
            const pdayK = econPlayerDayKey(date, slug);
            const prior = await store.get<EconPlayerDayRow>(pdayK);
            const row: EconPlayerDayRow = prior ?? {};
            const next: EconPlayerDayRow = { ...row, [full.currency]: foldSourceCount(row[full.currency] ?? {}, full.source, full.delta) };
            await store.set(pdayK, next, { ex: ECON_PLAYER_DAY_TTL_SECONDS });
            if (prior) return;
            // First txn of the day for this player: index the row so the readout
            // can find it without a key scan.
            await withTelemetryLock(econPlayerIndexKey(date), store, async () => {
                const idxK = econPlayerIndexKey(date);
                const index = (await store.get<string[]>(idxK)) ?? [];
                if (index.includes(slug) || index.length >= MAX_ECON_PLAYER_INDEX) return;
                await store.set(idxK, [...index, slug], { ex: ECON_PLAYER_DAY_TTL_SECONDS });
            });
        }));
    }

    if (opts.list ?? !isHighFrequencyEconSource(full.source)) {
        await telemetryStep('recent list', () => withTelemetryLock(ECON_TXN_LIST_KEY, store, async () => {
            const list = (await store.get<EconTxn[]>(ECON_TXN_LIST_KEY)) ?? [];
            await store.set(ECON_TXN_LIST_KEY, [full, ...list].slice(0, MAX_ECON_TXNS));
        }));
    }
}

// ─── Readers (admin snapshot) ─────────────────────────────────────────────────

async function readMany<T>(store: EconKv, keys: string[]): Promise<Array<T | null>> {
    if (keys.length === 0) return [];
    if (typeof store.mget === 'function') {
        const out: Array<T | null> = [];
        for (let i = 0; i < keys.length; i += 100) {
            out.push(...(await store.mget<T[]>(...keys.slice(i, i + 100))) as Array<T | null>);
        }
        return out;
    }
    const out: Array<T | null> = [];
    for (const key of keys) out.push(await store.get<T>(key));
    return out;
}

/** The `count` UTC days ending at `now`, oldest first. */
export function econRecentDays(now: number, count: number): string[] {
    const days: string[] = [];
    for (let i = count - 1; i >= 0; i--) days.push(econUtcDay(now - i * 86_400_000));
    return days;
}

/** Every currency's per-source counters for one UTC day. */
export async function readEconomyDay(date: string, opts: { kv?: EconKv } = {}): Promise<Partial<Record<EconCurrency, EconDayRow>>> {
    const store = opts.kv ?? kv;
    const rows = await readMany<EconDayRow>(store, ECON_CURRENCIES.map((c) => econDayKey(date, c)));
    const out: Partial<Record<EconCurrency, EconDayRow>> = {};
    ECON_CURRENCIES.forEach((c, i) => { if (rows[i] && Object.keys(rows[i]!).length) out[c] = rows[i]!; });
    return out;
}

/** Every indexed player's day row, per date. */
export async function readPlayerEconomyDays(dates: string[], opts: { kv?: EconKv } = {}): Promise<Record<string, Record<string, EconPlayerDayRow>>> {
    const store = opts.kv ?? kv;
    const out: Record<string, Record<string, EconPlayerDayRow>> = {};
    const indexes = await readMany<string[]>(store, dates.map(econPlayerIndexKey));
    for (const [i, date] of dates.entries()) {
        const slugs = Array.isArray(indexes[i]) ? indexes[i]! : [];
        const rows = await readMany<EconPlayerDayRow>(store, slugs.map((slug) => econPlayerDayKey(date, slug)));
        out[date] = {};
        slugs.forEach((slug, j) => { if (rows[j]) out[date][slug] = rows[j]!; });
    }
    return out;
}

/** Framework 8.4 exploit alarm: twice the hardcore model's ryo day, or the FS ceiling. */
export const ECON_EXPLOIT_RYO_PER_DAY = 250_000;
export const ECON_EXPLOIT_FS_PER_DAY = 52;
/** Sources whose ryo is the PvP purse (framework 8.2 revert criterion). */
export const ECON_PVP_PURSE_SOURCE_PREFIX = 'pvp.';

export type EconPercentiles = { n: number; p50: number; p90: number; p99: number; max: number };

function nearestRank(sorted: number[], p: number): number {
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

export function econPercentiles(values: number[]): EconPercentiles | null {
    const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    return { n: sorted.length, p50: nearestRank(sorted, 0.5), p90: nearestRank(sorted, 0.9), p99: nearestRank(sorted, 0.99), max: sorted[sorted.length - 1] };
}

/** Faucet total for one currency in a player's day: created by non-transfer sources. */
function faucetCreated(row: EconPlayerDayRow, currency: EconCurrency, sourcePrefix = ''): number {
    let total = 0;
    for (const [source, count] of Object.entries(row[currency] ?? {})) {
        if (isTransferEconSource(source) || !source.startsWith(sourcePrefix)) continue;
        total += Number(count?.c) || 0;
    }
    return total;
}

export type PlayerEconomyDaySummary = {
    date: string;
    activePlayers: number;
    pvpPurse: EconPercentiles | null;
    exploitAlarms: Array<{ player: string; ryo: number; fateShards: number }>;
    sourcePlayers: Record<string, number>;
};
export type PlayerEconomySummary = {
    days: PlayerEconomyDaySummary[];
    window: {
        activePlayers: number;
        fateShardsEarned: EconPercentiles | null;
        sinkPlayers: Record<string, { players: number; share: number }>;
    };
};

/**
 * The per-player readout framework 8.4 asks for, from econ:pday rows: the PvP
 * purse per player per day (p50/p90/p99), the exploit alarm, distinct players
 * per source, Fate Shards earned per player over the window, and how many of
 * the window's active players touched each sink. Report only: nothing here
 * blocks or reverts anything on its own.
 */
export function summarizePlayerEconomy(days: Record<string, Record<string, EconPlayerDayRow>>): PlayerEconomySummary {
    const dates = Object.keys(days).sort();
    const windowPlayers = new Set<string>();
    const fsByPlayer = new Map<string, number>();
    const sinkPlayers = new Map<string, Set<string>>();
    const summaries: PlayerEconomyDaySummary[] = [];
    for (const date of dates) {
        const players = days[date] ?? {};
        const purse: number[] = [];
        const alarms: PlayerEconomyDaySummary['exploitAlarms'] = [];
        const sourcePlayers = new Map<string, Set<string>>();
        for (const [player, row] of Object.entries(players)) {
            windowPlayers.add(player);
            const ryo = faucetCreated(row, 'ryo');
            const fs = faucetCreated(row, 'fateShards');
            const pvp = faucetCreated(row, 'ryo', ECON_PVP_PURSE_SOURCE_PREFIX);
            if (pvp > 0) purse.push(pvp);
            if (ryo > ECON_EXPLOIT_RYO_PER_DAY || fs > ECON_EXPLOIT_FS_PER_DAY) alarms.push({ player, ryo, fateShards: fs });
            fsByPlayer.set(player, (fsByPlayer.get(player) ?? 0) + fs);
            for (const bySource of Object.values(row)) {
                for (const [source, count] of Object.entries(bySource ?? {})) {
                    if (!sourcePlayers.has(source)) sourcePlayers.set(source, new Set());
                    sourcePlayers.get(source)!.add(player);
                    if ((Number(count?.d) || 0) > 0 && !isTransferEconSource(source)) {
                        if (!sinkPlayers.has(source)) sinkPlayers.set(source, new Set());
                        sinkPlayers.get(source)!.add(player);
                    }
                }
            }
        }
        summaries.push({
            date,
            activePlayers: Object.keys(players).length,
            pvpPurse: econPercentiles(purse),
            exploitAlarms: alarms.sort((a, b) => b.ryo - a.ryo || b.fateShards - a.fateShards),
            sourcePlayers: Object.fromEntries([...sourcePlayers.entries()].map(([source, set]) => [source, set.size])),
        });
    }
    const active = windowPlayers.size;
    return {
        days: summaries,
        window: {
            activePlayers: active,
            fateShardsEarned: econPercentiles([...windowPlayers].map((player) => fsByPlayer.get(player) ?? 0)),
            sinkPlayers: Object.fromEntries([...sinkPlayers.entries()].map(([source, set]) => [source, { players: set.size, share: active ? set.size / active : 0 }])),
        },
    };
}

// ─── Sunscar Exchange resource prices (BTEI-07, the FS thermometer) ───────────
//
// Every sold Fate Shard, Bone Charm or Aura Stone lot records one sample. The
// ryo-priced ones feed a median per resource; the black-market dial (#40) and
// the global "FS median moves > 25% in a week" revert read it. Two colluding
// accounts that do not share a connection can still wash-trade, so the
// estimator is built to resist one pair:
//   - a sample weighs min(quantity, 10), so a 9,999-unit lot counts as 10;
//   - no pair may carry more than 20% of a window's weight (with fewer than
//     five pairs, every pair is held to the smallest pair's weight);
//   - a lot priced under max(fixed floor, 25% of the trailing-30-day median)
//     is left out of the median and listed as gift-priced, together with any
//     lot that paid no fee. That is detection only; nothing is refused.
// Fewer than 5 sales or 3 distinct pairs in a window reports null, and a null
// never trips the dial or a revert.

export const EXCHANGE_TRACKED_RESOURCES = ['fateShards', 'boneCharms', 'auraStones'] as const;
export type ExchangeTrackedResource = typeof EXCHANGE_TRACKED_RESOURCES[number];
export type ExchangeResourceSample = {
    id: string;
    r: ExchangeTrackedResource;
    cur: 'ryo' | 'fateShards';
    /** Unit price, floor(price / quantity). */
    p: number;
    q: number;
    /** The two traders, sorted and joined with '|'. */
    pair: string;
    fee: number;
    ts: number;
};

export const EXCHANGE_SAMPLE_TTL_SECONDS = 45 * 86_400;
export const EXCHANGE_SAMPLE_DAILY_CAP = 500;
export const EXCHANGE_SAMPLE_PAIR_DAILY_CAP = 10;
export const EXCHANGE_SAMPLE_MAX_WEIGHT = 10;
export const EXCHANGE_PAIR_SHARE_CAP = 0.2;
export const EXCHANGE_MEDIAN_MIN_SALES = 5;
export const EXCHANGE_MEDIAN_MIN_PAIRS = 3;
export const EXCHANGE_REPORT_DAYS = 14;
export const EXCHANGE_WINDOW_DAYS = 7;
export const EXCHANGE_FLOOR_REFERENCE_DAYS = 30;
/** Unit prices below these are gift-priced whatever the market says. */
export const EXCHANGE_GIFT_FLOOR_RYO: Readonly<Record<ExchangeTrackedResource, number>> = { fateShards: 5_000, boneCharms: 150, auraStones: 1_000 };
export const EXCHANGE_GIFT_FLOOR_MEDIAN_SHARE = 0.25;
/** The revert criterion: the trailing FS median moving more than this in a week. */
export const EXCHANGE_FS_WEEKLY_MOVE_ALARM = 0.25;
export function econExchangeSampleKey(date: string): string { return `econ:exchange-res:${date}`; }

function isTrackedResource(id: unknown): id is ExchangeTrackedResource {
    return typeof id === 'string' && (EXCHANGE_TRACKED_RESOURCES as readonly string[]).includes(id);
}

export type ExchangeSaleInput = {
    id: string;
    seller: string;
    buyer?: string;
    asset: { kind: string; id: string };
    quantity: number;
    price: number;
    currency: string;
    fee: number;
    completedAt?: number;
};

/** The sample a sold listing records, or null for anything but a tracked resource lot. */
export function exchangeResourceSample(sale: ExchangeSaleInput): ExchangeResourceSample | null {
    if (sale.asset?.kind !== 'resource' || !isTrackedResource(sale.asset.id)) return null;
    if (!sale.buyer || (sale.currency !== 'ryo' && sale.currency !== 'fateShards')) return null;
    const q = Math.floor(Number(sale.quantity));
    const price = Math.floor(Number(sale.price));
    if (!Number.isSafeInteger(q) || q < 1 || !Number.isSafeInteger(price) || price < 1) return null;
    return {
        id: String(sale.id).slice(0, 64),
        r: sale.asset.id,
        cur: sale.currency,
        p: Math.floor(price / q),
        q,
        pair: [sale.seller, sale.buyer].map((name) => String(name).slice(0, 64)).sort().join('|'),
        fee: Math.max(0, Math.floor(Number(sale.fee) || 0)),
        ts: Number(sale.completedAt) || Date.now(),
    };
}

/** Pure: append a sample unless it is a repeat, the day is full, or its pair is. */
export function addExchangeSample(samples: ExchangeResourceSample[], sample: ExchangeResourceSample): ExchangeResourceSample[] {
    if (samples.some((s) => s.id === sample.id)) return samples;
    if (samples.length >= EXCHANGE_SAMPLE_DAILY_CAP) return samples;
    if (samples.filter((s) => s.pair === sample.pair).length >= EXCHANGE_SAMPLE_PAIR_DAILY_CAP) return samples;
    return [...samples, sample];
}

/** Record one sold Exchange lot. Best-effort; a no-op for non-resource lots. */
export function recordExchangeResourceSale(sale: ExchangeSaleInput, opts: { kv?: EconKv } = {}): Promise<void> {
    return withoutKvLeaseContext(() => runBackgroundWork(async () => {
        const store = opts.kv ?? kv;
        try {
            const sample = exchangeResourceSample(sale);
            if (!sample) return;
            const key = econExchangeSampleKey(econUtcDay(sample.ts));
            await withTelemetryLock(key, store, async () => {
                const samples = (await store.get<ExchangeResourceSample[]>(key)) ?? [];
                const next = addExchangeSample(Array.isArray(samples) ? samples : [], sample);
                if (next !== samples) await store.set(key, next, { ex: EXCHANGE_SAMPLE_TTL_SECONDS });
            });
        } catch (e) {
            console.error('[economy] recordExchangeResourceSale failed:', e);
        }
    })).then(() => undefined);
}

/** Pure: the weighted median of unit prices (the lower median at an exact half). */
export function weightedMedian(points: Array<{ p: number; w: number }>): number | null {
    const usable = points.filter((pt) => Number.isFinite(pt.p) && pt.w > 0).sort((a, b) => a.p - b.p);
    const total = usable.reduce((sum, pt) => sum + pt.w, 0);
    if (total <= 0) return null;
    let cumulative = 0;
    for (const pt of usable) {
        cumulative += pt.w;
        if (cumulative >= total / 2 - 1e-9) return pt.p;
    }
    return usable[usable.length - 1].p;
}

/** Per-pair weight ceiling: no pair above 20% of the capped total, and never
 *  below the smallest pair's own weight (so thin markets fall back to equal
 *  weight per pair rather than to nothing). */
function pairWeightCap(pairWeights: number[]): number {
    const total = pairWeights.reduce((sum, w) => sum + w, 0);
    let cap = EXCHANGE_PAIR_SHARE_CAP * total;
    for (let i = 0; i < 200; i++) {
        const next = EXCHANGE_PAIR_SHARE_CAP * pairWeights.reduce((sum, w) => sum + Math.min(w, cap), 0);
        if (Math.abs(next - cap) < 1e-9) break;
        cap = next;
    }
    return Math.max(cap, Math.min(...pairWeights));
}

export type ExchangeWindowStat = {
    median: number | null;
    /** Ryo-priced sales at or above the floor. */
    sales: number;
    volume: number;
    distinctPairs: number;
    /** The largest pair's share of the window's raw weight. */
    topPairShare: number | null;
    floor: number;
    belowFloor: number;
    reason?: 'insufficient-data';
};

/** Pure: the capped-weight median for one resource over a set of samples. */
export function exchangeWindowStat(samples: ExchangeResourceSample[], resource: ExchangeTrackedResource, floor: number): ExchangeWindowStat {
    const priced = samples.filter((s) => s.r === resource && s.cur === 'ryo');
    const kept = priced.filter((s) => s.p >= floor);
    const pairWeights = new Map<string, number>();
    for (const s of kept) pairWeights.set(s.pair, (pairWeights.get(s.pair) ?? 0) + Math.min(s.q, EXCHANGE_SAMPLE_MAX_WEIGHT));
    const rawTotal = [...pairWeights.values()].reduce((sum, w) => sum + w, 0);
    const stat: ExchangeWindowStat = {
        median: null,
        sales: kept.length,
        volume: kept.reduce((sum, s) => sum + s.q, 0),
        distinctPairs: pairWeights.size,
        topPairShare: rawTotal > 0 ? Math.max(...pairWeights.values()) / rawTotal : null,
        floor,
        belowFloor: priced.length - kept.length,
    };
    if (kept.length < EXCHANGE_MEDIAN_MIN_SALES || pairWeights.size < EXCHANGE_MEDIAN_MIN_PAIRS) {
        return { ...stat, reason: 'insufficient-data' };
    }
    const cap = pairWeightCap([...pairWeights.values()]);
    const points = kept.map((s) => {
        const pairWeight = pairWeights.get(s.pair)!;
        const factor = pairWeight > cap ? cap / pairWeight : 1;
        return { p: s.p, w: Math.min(s.q, EXCHANGE_SAMPLE_MAX_WEIGHT) * factor };
    });
    return { ...stat, median: weightedMedian(points) };
}

export type ExchangeSeriesDay = {
    date: string;
    daily: Record<ExchangeTrackedResource, ExchangeWindowStat>;
    trailing7: Record<ExchangeTrackedResource, ExchangeWindowStat>;
    /** The black-market loop product on the trailing-7 medians (null without an FS median). */
    loopProduct: number | null;
    loopAssumed: string[];
};
export type ExchangeResourceReport = {
    today: string;
    series: ExchangeSeriesDay[];
    blackMarketDial: { cost: number; threshold: number; consecutiveDays: number; requiredDays: number; trip: boolean };
    fsMedianWeekMove: number | null;
    fsMedianWeekMoveAlarm: boolean;
    giftPricedSales: Array<ExchangeResourceSample & { date: string }>;
};

/**
 * Pure: the 14-day readout from samples keyed by UTC day. Each day carries its
 * own medians and the trailing-7-day medians the dial and revert criteria use;
 * the floor for a window is max(fixed floor, 25% of its trailing-30-day median).
 */
export function summarizeExchangeResources(samplesByDay: Record<string, ExchangeResourceSample[]>, today: string, cost: number = BLACK_MARKET_COST): ExchangeResourceReport {
    const end = Date.parse(`${today}T00:00:00Z`);
    const daysBack = (from: number, count: number) => econRecentDays(from, count);
    const samplesOver = (dates: string[]) => dates.flatMap((date) => Array.isArray(samplesByDay[date]) ? samplesByDay[date] : []);
    const series: ExchangeSeriesDay[] = [];
    const giftPriced: ExchangeResourceReport['giftPricedSales'] = [];
    for (const date of daysBack(end, EXCHANGE_REPORT_DAYS)) {
        const at = Date.parse(`${date}T00:00:00Z`);
        const reference = samplesOver(daysBack(at, EXCHANGE_FLOOR_REFERENCE_DAYS));
        const windowSamples = samplesOver(daysBack(at, EXCHANGE_WINDOW_DAYS));
        const daySamples = samplesOver([date]);
        const daily = {} as Record<ExchangeTrackedResource, ExchangeWindowStat>;
        const trailing7 = {} as Record<ExchangeTrackedResource, ExchangeWindowStat>;
        for (const r of EXCHANGE_TRACKED_RESOURCES) {
            const fixed = EXCHANGE_GIFT_FLOOR_RYO[r];
            const referenceMedian = exchangeWindowStat(reference, r, fixed).median;
            const floor = Math.max(fixed, referenceMedian === null ? 0 : Math.floor(referenceMedian * EXCHANGE_GIFT_FLOOR_MEDIAN_SHARE));
            daily[r] = exchangeWindowStat(daySamples, r, floor);
            trailing7[r] = exchangeWindowStat(windowSamples, r, floor);
            for (const s of daySamples) {
                if (s.r === r && ((s.cur === 'ryo' && s.p < floor) || s.fee === 0)) giftPriced.push({ ...s, date });
            }
        }
        const loop = blackMarketLoopProduct({
            fateShards: trailing7.fateShards.median,
            boneCharms: trailing7.boneCharms.median,
            auraStones: trailing7.auraStones.median,
        }, cost);
        series.push({ date, daily, trailing7, loopProduct: loop?.product ?? null, loopAssumed: loop?.assumed ?? [] });
    }
    let consecutiveDays = 0;
    for (let i = series.length - 1; i >= 0; i--) {
        const product = series[i].loopProduct;
        if (product === null || product < BLACK_MARKET_DIAL_LOOP_THRESHOLD) break;
        consecutiveDays++;
    }
    const nowMedian = series[series.length - 1]?.trailing7.fateShards.median ?? null;
    const weekAgoMedian = series[series.length - 1 - 7]?.trailing7.fateShards.median ?? null;
    const fsMedianWeekMove = nowMedian !== null && weekAgoMedian !== null && weekAgoMedian > 0 ? (nowMedian - weekAgoMedian) / weekAgoMedian : null;
    return {
        today,
        series,
        blackMarketDial: {
            cost,
            threshold: BLACK_MARKET_DIAL_LOOP_THRESHOLD,
            consecutiveDays,
            requiredDays: BLACK_MARKET_DIAL_DAYS,
            trip: consecutiveDays >= BLACK_MARKET_DIAL_DAYS,
        },
        fsMedianWeekMove,
        fsMedianWeekMoveAlarm: fsMedianWeekMove !== null && Math.abs(fsMedianWeekMove) > EXCHANGE_FS_WEEKLY_MOVE_ALARM,
        giftPricedSales: giftPriced.sort((a, b) => b.q - a.q || b.ts - a.ts).slice(0, 50),
    };
}

export async function readExchangeResourceReport(opts: { kv?: EconKv; now?: number } = {}): Promise<ExchangeResourceReport> {
    const store = opts.kv ?? kv;
    const now = opts.now ?? Date.now();
    const dates = econRecentDays(now, EXCHANGE_REPORT_DAYS + EXCHANGE_FLOOR_REFERENCE_DAYS - 1);
    const rows = await readMany<ExchangeResourceSample[]>(store, dates.map(econExchangeSampleKey));
    const samplesByDay: Record<string, ExchangeResourceSample[]> = {};
    dates.forEach((date, i) => { if (Array.isArray(rows[i])) samplesByDay[date] = rows[i]!; });
    return summarizeExchangeResources(samplesByDay, econUtcDay(now));
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

/** The trailing window the per-player readout covers. */
export const ECON_PLAYER_SUMMARY_DAYS = 7;

export interface EconSnapshot {
    aggregates: Record<string, EconAgg & { net: number }>;
    recent: EconTxn[];
    duplicateTxnIds: string[];
    /** Today's per-source counters for every currency (UTC). */
    today: Partial<Record<EconCurrency, EconDayRow>>;
    players: PlayerEconomySummary | null;
    exchange: ExchangeResourceReport | null;
}

// Read the current aggregates + a slice of recent txns for the admin panel,
// with today's source counters, the per-player readout and the Exchange report.
export async function readEconomySnapshot(recentLimit = 200, opts: { kv?: EconKv; now?: number } = {}): Promise<EconSnapshot> {
    const store = opts.kv ?? kv;
    const now = opts.now ?? Date.now();
    const aggregates: Record<string, EconAgg & { net: number }> = {};
    try {
        for (const c of ECON_CURRENCIES) {
            const agg = (await store.get<EconAgg>(econAggKey(c))) ?? { created: 0, destroyed: 0 };
            if (agg.created === 0 && agg.destroyed === 0) continue;
            aggregates[c] = { created: agg.created, destroyed: agg.destroyed, net: agg.created - agg.destroyed };
        }
    } catch { /* best-effort */ }
    let recent: EconTxn[] = [];
    try {
        const list = (await store.get<EconTxn[]>(ECON_TXN_LIST_KEY)) ?? [];
        recent = list.slice(0, Math.max(1, Math.min(recentLimit, MAX_ECON_TXNS)));
    } catch { /* best-effort */ }
    let today: EconSnapshot['today'] = {};
    try { today = await readEconomyDay(econUtcDay(now), { kv: store }); } catch { /* best-effort */ }
    let players: PlayerEconomySummary | null = null;
    try { players = summarizePlayerEconomy(await readPlayerEconomyDays(econRecentDays(now, ECON_PLAYER_SUMMARY_DAYS), { kv: store })); } catch { /* best-effort */ }
    let exchange: ExchangeResourceReport | null = null;
    try { exchange = await readExchangeResourceReport({ kv: store, now }); } catch { /* best-effort */ }
    return { aggregates, recent, duplicateTxnIds: duplicateTxnIds(recent), today, players, exchange };
}
