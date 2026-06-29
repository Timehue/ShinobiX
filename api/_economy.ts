import { kv } from './_storage.js';

// ─── Economy telemetry + transaction trail ────────────────────────────────────
//
// Makes the soft-economy *visible*: every server-authoritative currency change
// logs its SERVER-computed delta (faucet +, sink −) so inflation / faucet-vs-sink
// balance can be measured instead of guessed, and a dupe can be detected and
// unwound after the fact. Design: docs/economy-telemetry-plan.md.
//
// Strictly additive + best-effort: a logging hiccup NEVER fails the real reward
// write (every public fn swallows + logs its own errors). Two stores:
//   econ:txns          — capped recent list (newest-first) for drill-down
//   econ:agg:<currency>— running { created, destroyed } counters (survive rollover)
//
// recordEconomyTxn() is meant to be called from inside the writer's existing
// withKvLock(save), right where the delta is computed, so the logged number is
// the server-authored one — never a client figure.

export type EconCurrency =
    | 'ryo' | 'fateShards' | 'boneCharms' | 'auraStones'
    | 'auraDust' | 'honorSeals' | 'mythicSeals' | 'hollowShards';

export const ECON_CURRENCIES: readonly EconCurrency[] = [
    'ryo', 'fateShards', 'boneCharms', 'auraStones',
    'auraDust', 'honorSeals', 'mythicSeals', 'hollowShards',
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

export const ECON_TXN_LIST_KEY = 'econ:txns';
export const MAX_ECON_TXNS = 5000;
export function econAggKey(c: EconCurrency): string { return `econ:agg:${c}`; }

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

// Pure: txnIds that appear more than once in a recent-txn list (dup / replay).
export function duplicateTxnIds(txns: EconTxn[]): string[] {
    const counts = new Map<string, number>();
    for (const t of txns) counts.set(t.txnId, (counts.get(t.txnId) ?? 0) + 1);
    return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}

// Minimal KV surface; defaults to the shared `kv`, tests inject an in-memory one.
type EconKv = Pick<typeof kv, 'get' | 'set'>;

// Record one currency delta. Best-effort, never throws into the reward path.
// No-op for a zero delta or an unknown currency. The aggregate update is a
// lock-free read-modify-write — at tens of players a rare lost update only
// slightly understates a trend counter; the capped txn list is the precise
// drill-down. The supply TRUTH for disputes is the list, not the counter.
export async function recordEconomyTxn(
    txn: { txnId: string; player: string; currency: string; delta: number; source: string; balanceAfter?: number; ts?: number },
    opts: { kv?: EconKv } = {},
): Promise<void> {
    const store = opts.kv ?? kv;
    try {
        const delta = Number(txn.delta);
        if (!Number.isFinite(delta) || delta === 0) return;
        if (!isEconCurrency(txn.currency)) return;
        const full: EconTxn = {
            ts: txn.ts ?? Date.now(),
            txnId: String(txn.txnId).slice(0, 120),
            player: String(txn.player).slice(0, 64),
            currency: txn.currency,
            delta: Math.round(delta),
            source: String(txn.source).slice(0, 48),
            ...(Number.isFinite(Number(txn.balanceAfter)) ? { balanceAfter: Math.round(Number(txn.balanceAfter)) } : {}),
        };
        // Running aggregate.
        const aggK = econAggKey(full.currency);
        const agg = (await store.get<EconAgg>(aggK)) ?? { created: 0, destroyed: 0 };
        await store.set(aggK, applyTxnToAgg(agg, full.delta));
        // Capped recent list (newest-first).
        const list = (await store.get<EconTxn[]>(ECON_TXN_LIST_KEY)) ?? [];
        await store.set(ECON_TXN_LIST_KEY, [full, ...list].slice(0, MAX_ECON_TXNS));
    } catch (e) {
        console.error('[economy] recordEconomyTxn failed:', e);
    }
}

export interface EconSnapshot {
    aggregates: Record<string, EconAgg & { net: number }>;
    recent: EconTxn[];
    duplicateTxnIds: string[];
}

// Read the current aggregates + a slice of recent txns for the admin panel.
export async function readEconomySnapshot(recentLimit = 200, opts: { kv?: EconKv } = {}): Promise<EconSnapshot> {
    const store = opts.kv ?? kv;
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
    return { aggregates, recent, duplicateTxnIds: duplicateTxnIds(recent) };
}
