"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ECONOMY_TX_RECENT_LIMIT = exports.ECONOMY_TX_TTL_SECONDS = exports.ECONOMY_TX_RECENT_KEY = exports.ECONOMY_TX_PREFIX = void 0;
exports.makeEconomyTxId = makeEconomyTxId;
exports.economyTxKey = economyTxKey;
exports.reserveEconomyTx = reserveEconomyTx;
exports.markEconomyTx = markEconomyTx;
exports.completeEconomyTx = completeEconomyTx;
exports.failEconomyTx = failEconomyTx;
exports.readEconomyTxSnapshot = readEconomyTxSnapshot;
const node_crypto_1 = require("node:crypto");
exports.ECONOMY_TX_PREFIX = 'economy-tx:';
exports.ECONOMY_TX_RECENT_KEY = 'economy-tx:recent';
exports.ECONOMY_TX_TTL_SECONDS = 90 * 24 * 60 * 60;
exports.ECONOMY_TX_RECENT_LIMIT = 500;
function makeEconomyTxId(kind) {
    return `${kind}:${(0, node_crypto_1.randomUUID)().replace(/-/g, '')}`;
}
function economyTxKey(id) {
    return `${exports.ECONOMY_TX_PREFIX}${id}`;
}
async function getDefaultKv() {
    return (await import('./_storage.js')).kv;
}
function cleanRecord(input) {
    const now = Date.now();
    return {
        ...input,
        id: String(input.id),
        kind: String(input.kind),
        state: input.state ?? 'reserved',
        debitKey: String(input.debitKey),
        creditKey: String(input.creditKey),
        resource: String(input.resource),
        amount: Math.max(0, Math.floor(Number(input.amount) || 0)),
        createdAt: now,
        updatedAt: now,
    };
}
async function rememberRecent(id, store) {
    const recent = Array.isArray(await store.get(exports.ECONOMY_TX_RECENT_KEY))
        ? (await store.get(exports.ECONOMY_TX_RECENT_KEY))
        : [];
    const next = [id, ...recent.filter((x) => x !== id)].slice(0, exports.ECONOMY_TX_RECENT_LIMIT);
    await store.set(exports.ECONOMY_TX_RECENT_KEY, next, { ex: exports.ECONOMY_TX_TTL_SECONDS });
}
async function reserveEconomyTx(input, opts = {}) {
    const store = opts.kv ?? await getDefaultKv();
    const record = cleanRecord(input);
    const key = economyTxKey(record.id);
    const ok = await store.set(key, record, { nx: true, ex: exports.ECONOMY_TX_TTL_SECONDS });
    if (ok === null) {
        const existing = await store.get(key);
        if (existing)
            return existing;
    }
    await rememberRecent(record.id, store);
    return record;
}
async function markEconomyTx(id, state, patch = {}, opts = {}) {
    const store = opts.kv ?? await getDefaultKv();
    const key = economyTxKey(id);
    const current = await store.get(key);
    const now = Date.now();
    const next = {
        ...(current ?? {
            id,
            kind: String(patch.kind ?? 'unknown'),
            debitKey: String(patch.debitKey ?? ''),
            creditKey: String(patch.creditKey ?? ''),
            resource: String(patch.resource ?? ''),
            amount: Math.max(0, Math.floor(Number(patch.amount) || 0)),
            createdAt: now,
        }),
        ...patch,
        state,
        updatedAt: now,
    };
    await store.set(key, next, { ex: exports.ECONOMY_TX_TTL_SECONDS });
    await rememberRecent(id, store);
    return next;
}
function completeEconomyTx(id, patch = {}, opts = {}) {
    return markEconomyTx(id, 'complete', { ...patch, completedAt: Date.now() }, opts);
}
function failEconomyTx(id, error, patch = {}, opts = {}) {
    const message = error instanceof Error ? error.message : String(error);
    return markEconomyTx(id, 'needs-reconcile', { ...patch, error: message }, opts);
}
async function readEconomyTxSnapshot(limit = 100, opts = {}) {
    const store = opts.kv ?? await getDefaultKv();
    const ids = Array.isArray(await store.get(exports.ECONOMY_TX_RECENT_KEY))
        ? (await store.get(exports.ECONOMY_TX_RECENT_KEY))
        : [];
    const cappedIds = ids.slice(0, Math.max(1, Math.min(500, Math.floor(Number(limit) || 100))));
    const recent = (await Promise.all(cappedIds.map((id) => store.get(economyTxKey(id))))).filter(Boolean);
    return { recent, stuck: recent.filter((tx) => tx.state !== 'complete') };
}
