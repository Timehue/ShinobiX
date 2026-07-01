import { kv } from './_storage.js';

// ─── Village-War economy telemetry (Phase 8) ──────────────────────────────────
//
// Makes the WAR economy *visible* so the §6 numbers can be re-fit from data
// instead of guessed (plan §8 / §12): the two village-pool resources — War
// Resources (WR) and treasury Honor Seals — each get a faucet-vs-sink trail, plus
// tax collected/burned/treasury, daily maintenance, and dormancy, all per village.
// This is the village-pool sibling of api/_economy.ts (which tracks the eight
// PLAYER currencies) — WR + treasury seals are village-scoped, not a player
// wallet, so they get their own sink with a per-village aggregate.
//
// Strictly additive + best-effort, exactly like recordEconomyTxn(): a logging
// hiccup NEVER fails the real war-economy write (every public fn swallows + logs
// its own errors). Meant to be called from inside the writer's existing
// withKvLock(...) right where the server computes the amount, so the logged
// number is server-authored — never a client figure. Inert until the war feature
// is enabled (the writers only run when ENABLE_VILLAGE_WAR=1).
//
// Two stores (mirroring _economy.ts):
//   war:eco:txns        — capped recent list (newest-first) for drill-down
//   war:eco:agg:<slug>  — per-village running { kind: summedAmount } counters
//                         (survive list rollover; the supply trend)

export type WarEcoKind =
    | 'wr.earn'              // WR accrued — held-sector income on the daily pass (faucet)
    | 'wr.spend.declare'     // WR spent declaring a (sector/village) war (sink)
    | 'wr.spend.maintenance' // WR upkeep charged on the daily pass (sink)
    | 'wr.spend.merc'        // WR spent hiring mercenaries (sink; wired when WR-mercs land)
    | 'seals.earn'           // treasury Honor Seals accrued from held sectors (faucet)
    | 'seals.spend.structure'// treasury seals spent upgrading a war structure (sink)
    | 'tax.collect'          // ryo taxed off a player (the per-player debit)
    | 'tax.burn'             // taxed ryo burned (real inflation sink)
    | 'tax.treasury'         // taxed ryo converted to treasury seals
    | 'dormancy.enter'       // village fell dormant (couldn't pay upkeep)
    | 'dormancy.exit'        // village recovered from dormancy
    | 'sector.capture';      // a sector flipped owner (count, amount = 1)

export const WAR_ECO_KINDS: readonly WarEcoKind[] = [
    'wr.earn', 'wr.spend.declare', 'wr.spend.maintenance', 'wr.spend.merc',
    'seals.earn', 'seals.spend.structure',
    'tax.collect', 'tax.burn', 'tax.treasury',
    'dormancy.enter', 'dormancy.exit', 'sector.capture',
];

// The WR sink kinds — summed into "WR out" for the faucet-vs-sink view.
export const WR_SINK_KINDS: readonly WarEcoKind[] = [
    'wr.spend.declare', 'wr.spend.maintenance', 'wr.spend.merc',
];
// The treasury-seal sink kinds — summed into "seals out".
export const SEAL_SINK_KINDS: readonly WarEcoKind[] = [
    'seals.spend.structure',
];

export interface WarEcoEvent {
    ts: number;
    eventId: string;     // idempotency id, e.g. `declare:<sector>:<day>` (dup detection)
    village: string;     // display name, e.g. 'Stormveil Village'
    kind: WarEcoKind;
    amount: number;      // server-computed magnitude (always >= 0; the kind carries the sign)
    meta?: string;       // optional context: a sector number, structure key, player slug…
}

// Per-village running totals: kind -> summed amount.
export type WarEcoAgg = Partial<Record<WarEcoKind, number>>;

export const WAR_ECO_TXN_LIST_KEY = 'war:eco:txns';
export const MAX_WAR_ECO_TXNS = 5000;

export function villageSlug(village: string): string {
    return String(village).trim().toLowerCase().replace(/\s+/g, '-');
}
export function warEcoAggKey(village: string): string {
    return `war:eco:agg:${villageSlug(village)}`;
}

function isWarEcoKind(v: unknown): v is WarEcoKind {
    return typeof v === 'string' && (WAR_ECO_KINDS as readonly string[]).includes(v);
}

// Pure: fold one event's amount into a per-village aggregate (additive per kind).
export function applyEventToAgg(agg: WarEcoAgg, kind: WarEcoKind, amount: number): WarEcoAgg {
    if (!Number.isFinite(amount) || amount <= 0) return agg;
    return { ...agg, [kind]: (agg[kind] ?? 0) + Math.round(amount) };
}

// Pure: derived view of a village's aggregate for the admin panel / tuning.
export interface WarEcoVillageView {
    wrIn: number;          // total WR faucet
    wrOut: number;         // total WR sink (declare + maintenance + merc)
    wrNet: number;         // wrIn - wrOut (positive = accumulating, negative = bleeding)
    sealsIn: number;       // total treasury-seal faucet
    sealsOut: number;      // total treasury-seal sink (structures)
    sealsNet: number;
    taxCollected: number;
    taxBurned: number;
    taxTreasury: number;
    maintenancePaid: number;
    dormancyEnters: number;
    sectorsCaptured: number;
    byKind: WarEcoAgg;
}

export function summarizeVillageAgg(agg: WarEcoAgg): WarEcoVillageView {
    const get = (k: WarEcoKind) => Math.max(0, Math.round(Number(agg[k] ?? 0)));
    const sum = (ks: readonly WarEcoKind[]) => ks.reduce((acc, k) => acc + get(k), 0);
    const wrIn = get('wr.earn');
    const wrOut = sum(WR_SINK_KINDS);
    const sealsIn = get('seals.earn');
    const sealsOut = sum(SEAL_SINK_KINDS);
    return {
        wrIn,
        wrOut,
        wrNet: wrIn - wrOut,
        sealsIn,
        sealsOut,
        sealsNet: sealsIn - sealsOut,
        taxCollected: get('tax.collect'),
        taxBurned: get('tax.burn'),
        taxTreasury: get('tax.treasury'),
        maintenancePaid: get('wr.spend.maintenance'),
        dormancyEnters: get('dormancy.enter'),
        sectorsCaptured: get('sector.capture'),
        byKind: { ...agg },
    };
}

// Pure: eventIds seen more than once in a recent list (replay / dup).
export function duplicateEventIds(events: WarEcoEvent[]): string[] {
    const counts = new Map<string, number>();
    for (const e of events) counts.set(e.eventId, (counts.get(e.eventId) ?? 0) + 1);
    return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}

// Minimal KV surface; defaults to the shared `kv`, while the daily pass's
// injected store and the test's in-memory store also satisfy it. Deliberately
// looser than the live kv's set() return type so any best-effort store fits.
type WarEcoKv = {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<unknown>;
};

// Record one war-economy event. Best-effort, never throws into the war write.
// No-op for a non-positive amount or an unknown kind. The aggregate update is a
// lock-free read-modify-write — at tens of players a rare lost update only
// slightly understates a trend counter; the capped txn list is the precise
// drill-down.
export async function recordWarEcoEvent(
    ev: { eventId: string; village: string; kind: string; amount: number; meta?: string; ts?: number },
    opts: { kv?: WarEcoKv } = {},
): Promise<void> {
    const store = opts.kv ?? kv;
    try {
        const amount = Number(ev.amount);
        if (!Number.isFinite(amount) || amount <= 0) return;
        if (!isWarEcoKind(ev.kind)) return;
        const village = String(ev.village ?? '').trim();
        if (!village) return;
        const full: WarEcoEvent = {
            ts: ev.ts ?? Date.now(),
            eventId: String(ev.eventId).slice(0, 120),
            village: village.slice(0, 48),
            kind: ev.kind,
            amount: Math.round(amount),
            ...(ev.meta ? { meta: String(ev.meta).slice(0, 64) } : {}),
        };
        // Per-village running aggregate.
        const aggK = warEcoAggKey(full.village);
        const agg = (await store.get<WarEcoAgg>(aggK)) ?? {};
        await store.set(aggK, applyEventToAgg(agg, full.kind, full.amount));
        // Capped recent list (newest-first).
        const list = (await store.get<WarEcoEvent[]>(WAR_ECO_TXN_LIST_KEY)) ?? [];
        await store.set(WAR_ECO_TXN_LIST_KEY, [full, ...list].slice(0, MAX_WAR_ECO_TXNS));
    } catch (e) {
        console.error('[war-telemetry] recordWarEcoEvent failed:', e);
    }
}

export interface WarEcoSnapshot {
    villages: Record<string, WarEcoVillageView>;
    recent: WarEcoEvent[];
    duplicateEventIds: string[];
}

// Read per-village derived views + a slice of recent events for the admin panel.
export async function readWarEcoSnapshot(
    villages: readonly string[],
    recentLimit = 200,
    opts: { kv?: WarEcoKv } = {},
): Promise<WarEcoSnapshot> {
    const store = opts.kv ?? kv;
    const out: Record<string, WarEcoVillageView> = {};
    try {
        for (const v of villages) {
            const agg = (await store.get<WarEcoAgg>(warEcoAggKey(v))) ?? {};
            if (Object.keys(agg).length === 0) continue;
            out[v] = summarizeVillageAgg(agg);
        }
    } catch { /* best-effort */ }
    let recent: WarEcoEvent[] = [];
    try {
        const list = (await store.get<WarEcoEvent[]>(WAR_ECO_TXN_LIST_KEY)) ?? [];
        recent = list.slice(0, Math.max(1, Math.min(recentLimit, MAX_WAR_ECO_TXNS)));
    } catch { /* best-effort */ }
    return { villages: out, recent, duplicateEventIds: duplicateEventIds(recent) };
}
