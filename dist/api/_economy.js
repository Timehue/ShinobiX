"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ECON_TXNS = exports.ECON_TXN_LIST_KEY = exports.ECON_CURRENCIES = void 0;
exports.econAggKey = econAggKey;
exports.applyTxnToAgg = applyTxnToAgg;
exports.duplicateTxnIds = duplicateTxnIds;
exports.recordEconomyTxn = recordEconomyTxn;
exports.readEconomySnapshot = readEconomySnapshot;
const _storage_js_1 = require("./_storage.js");
exports.ECON_CURRENCIES = [
    'ryo', 'fateShards', 'boneCharms', 'auraStones',
    'auraDust', 'honorSeals', 'mythicSeals', 'hollowShards',
];
exports.ECON_TXN_LIST_KEY = 'econ:txns';
exports.MAX_ECON_TXNS = 5000;
function econAggKey(c) { return `econ:agg:${c}`; }
function isEconCurrency(v) {
    return typeof v === 'string' && exports.ECON_CURRENCIES.includes(v);
}
// Pure: fold a delta into a running aggregate (+ → created, − → destroyed).
function applyTxnToAgg(agg, delta) {
    if (!Number.isFinite(delta) || delta === 0)
        return agg;
    return delta > 0
        ? { created: agg.created + delta, destroyed: agg.destroyed }
        : { created: agg.created, destroyed: agg.destroyed + (-delta) };
}
// Pure: txnIds that appear more than once in a recent-txn list (dup / replay).
function duplicateTxnIds(txns) {
    const counts = new Map();
    for (const t of txns)
        counts.set(t.txnId, (counts.get(t.txnId) ?? 0) + 1);
    return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}
// Record one currency delta. Best-effort, never throws into the reward path.
// No-op for a zero delta or an unknown currency. The aggregate update is a
// lock-free read-modify-write — at tens of players a rare lost update only
// slightly understates a trend counter; the capped txn list is the precise
// drill-down. The supply TRUTH for disputes is the list, not the counter.
async function recordEconomyTxn(txn, opts = {}) {
    const store = opts.kv ?? _storage_js_1.kv;
    try {
        const delta = Number(txn.delta);
        if (!Number.isFinite(delta) || delta === 0)
            return;
        if (!isEconCurrency(txn.currency))
            return;
        const full = {
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
        const agg = (await store.get(aggK)) ?? { created: 0, destroyed: 0 };
        await store.set(aggK, applyTxnToAgg(agg, full.delta));
        // Capped recent list (newest-first).
        const list = (await store.get(exports.ECON_TXN_LIST_KEY)) ?? [];
        await store.set(exports.ECON_TXN_LIST_KEY, [full, ...list].slice(0, exports.MAX_ECON_TXNS));
    }
    catch (e) {
        console.error('[economy] recordEconomyTxn failed:', e);
    }
}
// Read the current aggregates + a slice of recent txns for the admin panel.
async function readEconomySnapshot(recentLimit = 200, opts = {}) {
    const store = opts.kv ?? _storage_js_1.kv;
    const aggregates = {};
    try {
        for (const c of exports.ECON_CURRENCIES) {
            const agg = (await store.get(econAggKey(c))) ?? { created: 0, destroyed: 0 };
            if (agg.created === 0 && agg.destroyed === 0)
                continue;
            aggregates[c] = { created: agg.created, destroyed: agg.destroyed, net: agg.created - agg.destroyed };
        }
    }
    catch { /* best-effort */ }
    let recent = [];
    try {
        const list = (await store.get(exports.ECON_TXN_LIST_KEY)) ?? [];
        recent = list.slice(0, Math.max(1, Math.min(recentLimit, exports.MAX_ECON_TXNS)));
    }
    catch { /* best-effort */ }
    return { aggregates, recent, duplicateTxnIds: duplicateTxnIds(recent) };
}
